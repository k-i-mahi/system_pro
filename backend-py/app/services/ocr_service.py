from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import time
from pathlib import Path
from typing import Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

OcrQuality = Literal["fast", "accurate"]

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
        import easyocr  # type: ignore
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # Scale up small images so easyocr has enough resolution
        w, h = img.size
        if max(w, h) < 1200:
            scale = 1200 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
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
    prompt = _TEXT_PROMPT.format(text=text[:3000])
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/generate",
                json={"model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            resp = r.json().get("response", "").strip()
            logger.info("llama3.2 → %s", resp[:200])
            return _parse_codes(resp)
    except Exception as exc:
        logger.error("llama3.2 failed: %s", exc)
        return []


# ── Text file extractors ──────────────────────────────────────────────────────

def _pdf_text(data: bytes) -> str:
    try:
        import pdfplumber  # type: ignore
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as exc:
        logger.warning("pdfplumber failed: %s", exc)
        return ""


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
            text = await asyncio.to_thread(_pdf_text, data)
            regex_codes = _parse_codes(text)
            llm_codes = await _llm_from_text(text)
            merged = []
            seen: set[str] = set()
            for code in regex_codes + llm_codes:
                if code not in seen:
                    seen.add(code)
                    merged.append(code)
            codes = merged
            engine = "pdfplumber+llama3.2"

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
            llava_result, ocr_text = await asyncio.gather(
                _llava(data),
                asyncio.to_thread(_easyocr_text, data),
                return_exceptions=True,
            )

            llava_codes: list[str] = llava_result if not isinstance(llava_result, Exception) else []
            raw_text: str = ocr_text if not isinstance(ocr_text, Exception) else ""

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
            engine = " + ".join(parts) if parts else "none"

    except ValueError:
        raise
    except Exception as exc:
        logger.error("OCR pipeline error: %s", exc)

    finally:
        logger.info("OCR %.2fs | %s | codes=%s", time.monotonic() - t0, engine, codes)

    return {"text": text, "codes": codes, "engine": engine}
