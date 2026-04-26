from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import threading
import time
from pathlib import Path
from typing import Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

OcrQuality = Literal["fast", "accurate"]

_easyocr_reader_lock = threading.Lock()
_easyocr_reader = None


def _get_easyocr_reader():
    """Lazy singleton — constructing Reader per page was crushing ingest (memory + startup time)."""
    global _easyocr_reader
    if _easyocr_reader is not None:
        return _easyocr_reader
    with _easyocr_reader_lock:
        if _easyocr_reader is None:
            import easyocr  # type: ignore

            _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _easyocr_reader

# ── Prompts ───────────────────────────────────────────────────────────────────

_IMAGE_PROMPT = (
    "This is a university class schedule. "
    "List every course code you can see. "
    "Course codes are made of 2-6 capital letters followed by 3-4 digits, "
    "for example: CSE3200, EEE2101, MATH1101, PHY1101. "
    "Return the codes as a comma-separated list ONLY. "
    "If you see no course codes, reply with the single word: NONE"
)

_TEXT_PROMPT = (
    "From the text below, extract all university course codes. "
    "A course code is 2-6 capital letters followed by 3-4 digits (e.g. CSE3200, EEE2101). "
    "Return ONLY a comma-separated list of codes. If none, return NONE.\n\nText:\n{text}"
)


# ── Code parsing ──────────────────────────────────────────────────────────────

def _parse_codes(text: str) -> list[str]:
    """Pull valid course codes out of any text / LLM response."""
    if not text or text.strip().upper() == "NONE":
        return []
    tokens = re.findall(r"[A-Z]{2,6}[\-\s]?\d{3,4}[A-Z]?", text.upper())
    seen: dict[str, None] = {}
    for tok in tokens:
        clean = re.sub(r"[\s\-]", "", tok)
        if re.match(r"^[A-Z]{2,6}\d{3,4}[A-Z]?$", clean):
            seen[clean] = None
    return list(seen.keys())


# Keep this name exported for any module that imports it directly
extract_codes = _parse_codes


# ── AI helpers ────────────────────────────────────────────────────────────────

async def _llava(image_bytes: bytes) -> list[str]:
    """Ask the llava vision model to identify course codes in the image."""
    model = settings.OLLAMA_VISION_MODEL
    if not model:
        return []
    b64 = base64.b64encode(image_bytes).decode()
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/generate",
                json={"model": model, "prompt": _IMAGE_PROMPT, "images": [b64], "stream": False},
            )
            r.raise_for_status()
            resp = r.json().get("response", "").strip()
            logger.info("llava → %s", resp[:200])
            return _parse_codes(resp)
    except Exception as exc:
        logger.error("llava failed: %s", exc)
        return []


def _easyocr_text(image_bytes: bytes) -> str:
    """Extract raw text from image using easyocr (pure Python, no Tesseract needed)."""
    try:
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # Scale up small images so easyocr has enough resolution
        w, h = img.size
        if max(w, h) < 1200:
            scale = 1200 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        reader = _get_easyocr_reader()
        results = reader.readtext(np.array(img), detail=0, paragraph=False)
        text = " ".join(results)
        logger.info("easyocr → %d chars: %s", len(text), text[:200])
        return text
    except Exception as exc:
        logger.error("easyocr failed: %s", exc)
        return ""


async def _llm_from_text(text: str) -> list[str]:
    """Ask llama3.2 to find course codes in extracted OCR text."""
    if not text.strip():
        return []
    snippet = text[:3000]
    prompt = _TEXT_PROMPT.format(text=snippet)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/generate",
                json={"model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            resp = r.json().get("response", "").strip()
            logger.info("llama3.2 codes-from-text → %s", resp[:200])
            return _parse_codes(resp)
    except Exception as exc:
        logger.error("llama3.2 failed: %s", exc)
        return []


async def _sidecar_handwriting(image_bytes: bytes, filename: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            files = {"file": (filename, image_bytes, "application/octet-stream")}
            r = await client.post(f"{settings.AI_SIDECAR_URL}/ocr/handwriting", files=files)
            r.raise_for_status()
            text_value = (r.json() or {}).get("text", "")
            logger.info("sidecar handwriting → %d chars", len(text_value))
            return text_value
    except Exception as exc:
        logger.warning("sidecar handwriting failed: %s", exc)
        return ""


async def _sidecar_pdf(data: bytes, filename: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=240.0) as client:
            files = {"file": (filename, data, "application/pdf")}
            r = await client.post(f"{settings.AI_SIDECAR_URL}/ocr/academic-pdf", files=files)
            r.raise_for_status()
            payload = r.json() or {}
            pages = payload.get("pages") or []
            if pages:
                text_value = "\n\n".join(str(p) for p in pages)
            else:
                text_value = str(payload.get("text", ""))
            logger.info("sidecar academic-pdf → %d chars", len(text_value))
            return text_value
    except Exception as exc:
        logger.warning("sidecar academic-pdf failed: %s", exc)
        return ""


def _pdf_raster_easyocr(data: bytes, max_pages: int = 30) -> str:
    """Rasterize PDF pages and OCR with easyocr (scanned PDF fallback)."""
    try:
        import pdfplumber  # type: ignore

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:max_pages]:
                try:
                    pil = page.to_image(resolution=180).original.convert("RGB")
                    buf = io.BytesIO()
                    pil.save(buf, format="PNG")
                    t = _easyocr_text(buf.getvalue())
                    if t.strip():
                        parts.append(t.strip())
                except Exception as exc:
                    logger.debug("pdf page raster OCR skip: %s", exc)
                    continue
        return "\n\n".join(parts)
    except Exception as exc:
        logger.warning("pdf raster OCR failed: %s", exc)
        return ""


# ── Text file extractors ──────────────────────────────────────────────────────

def _pdf_text(data: bytes) -> str:
    """Prefer PyMuPDF text layer (often better on slide exports), then pdfplumber."""
    best = ""
    try:
        import fitz  # type: ignore  # pymupdf

        doc = fitz.open(stream=data, filetype="pdf")
        try:
            parts = [doc.load_page(i).get_text() or "" for i in range(doc.page_count)]
            best = "\n".join(parts)
        finally:
            doc.close()
    except Exception as exc:
        logger.debug("pymupdf text extract skipped: %s", exc)
    try:
        import pdfplumber  # type: ignore

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pl = "\n".join(p.extract_text() or "" for p in pdf.pages)
        if len(pl.strip()) > len(best.strip()):
            best = pl
    except Exception as exc:
        logger.warning("pdfplumber failed: %s", exc)
    return best


def _docx_text(data: bytes) -> str:
    try:
        from docx import Document  # type: ignore
        return "\n".join(p.text for p in Document(io.BytesIO(data)).paragraphs)
    except Exception as exc:
        logger.warning("python-docx failed: %s", exc)
        return ""


# ── Public API ────────────────────────────────────────────────────────────────

async def extract_text_from_file(
    data: bytes,
    filename: str,
    quality: OcrQuality = "fast",
) -> dict:
    """
    Returns {"text": str, "codes": list[str], "engine": str}.

    Images  → llava (vision) + easyocr→llama3.2 run in parallel, results merged.
    PDFs    → pdfplumber text → llama3.2 code extraction.
    DOCX    → python-docx text → llama3.2 code extraction.
    """
    ext = Path(filename).suffix.lower()
    t0 = time.monotonic()
    text = ""
    codes: list[str] = []
    engine = "none"

    try:
        # ── PDF ──────────────────────────────────────────────────────────────
        if ext == ".pdf":
            # Slide PDFs often have sparse text layers; raster OCR fills the gap below this threshold.
            min_chars_for_text = 50
            used_sidecar_fallback = False
            text = await _sidecar_pdf(data, filename) if quality == "accurate" else ""
            if not text.strip():
                text = await asyncio.to_thread(_pdf_text, data)
            if quality == "fast" and len(text.strip()) < min_chars_for_text:
                side = await _sidecar_pdf(data, filename)
                if len(side.strip()) > len(text.strip()):
                    text = side
                    used_sidecar_fallback = True
            if len(text.strip()) < min_chars_for_text:
                raster = await asyncio.to_thread(_pdf_raster_easyocr, data)
                if len(raster.strip()) > len(text.strip()):
                    text = raster
                    engine = "pdf-raster-easyocr+llama3.2"
            regex_codes = _parse_codes(text)
            llm_codes = await _llm_from_text(text)
            merged = []
            seen: set[str] = set()
            for code in regex_codes + llm_codes:
                if code not in seen:
                    seen.add(code)
                    merged.append(code)
            codes = merged
            if engine == "none":
                if quality == "accurate":
                    engine = "pdf-accurate+llama3.2"
                elif used_sidecar_fallback:
                    engine = "pdfplumber+sidecar+llama3.2"
                else:
                    engine = "pdfplumber+llama3.2"

        # ── Plain text (notes, exports) ─────────────────────────────────────
        elif ext == ".txt":
            text = data.decode("utf-8", errors="replace")
            codes = _parse_codes(text)
            engine = "utf-8-text"

        # ── DOCX ─────────────────────────────────────────────────────────────
        elif ext == ".docx":
            text = await asyncio.to_thread(_docx_text, data)
            regex_codes = _parse_codes(text)
            llm_codes = await _llm_from_text(text)
            merged = []
            seen: set[str] = set()
            for code in regex_codes + llm_codes:
                if code not in seen:
                    seen.add(code)
                    merged.append(code)
            codes = merged
            engine = "docx+llama3.2"

        elif ext == ".doc":
            raise ValueError("Legacy .doc not supported — convert to .docx first.")

        # ── Image ─────────────────────────────────────────────────────────────
        else:
            # Run llava and easyocr in parallel to save time
            if quality == "accurate":
                sidecar_text_task = _sidecar_handwriting(data, filename)
                llava_result, sidecar_text, ocr_text = await asyncio.gather(
                    _llava(data),
                    sidecar_text_task,
                    asyncio.to_thread(_easyocr_text, data),
                    return_exceptions=True,
                )
            else:
                llava_result, ocr_text = await asyncio.gather(
                    _llava(data),
                    asyncio.to_thread(_easyocr_text, data),
                    return_exceptions=True,
                )
                sidecar_text = ""

            llava_codes: list[str] = llava_result if not isinstance(llava_result, Exception) else []
            easy_text: str = ocr_text if not isinstance(ocr_text, Exception) else ""
            side_text: str = sidecar_text if not isinstance(sidecar_text, Exception) else ""
            raw_text: str = side_text if len(side_text) > len(easy_text) else easy_text

            # Regex fallback keeps scan useful even if Ollama is unavailable.
            regex_codes = _parse_codes(raw_text)

            # LLM cleans up the easyocr text to find codes regex might miss
            llm_codes = await _llm_from_text(raw_text)

            # Merge: llava first (visual understanding), then regex, then LLM-cleaned text
            seen: dict[str, None] = {}
            for c in llava_codes + regex_codes + llm_codes:
                seen[c] = None
            codes = list(seen.keys())
            text = raw_text

            parts = []
            if llava_codes:
                parts.append(f"llava({len(llava_codes)})")
            if regex_codes:
                parts.append(f"regex({len(regex_codes)})")
            if llm_codes:
                parts.append(f"easyocr+llama3.2({len(llm_codes)})")
            if side_text:
                parts.append("sidecar")
            engine = " + ".join(parts) if parts else "none"

    except ValueError:
        raise
    except Exception as exc:
        logger.error("OCR pipeline error: %s", exc)

    finally:
        logger.info("OCR %.2fs | %s | codes=%s", time.monotonic() - t0, engine, codes)

    return {"text": text, "codes": codes, "engine": engine}
