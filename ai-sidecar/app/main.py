"""
Cognitive Copilot — AI Sidecar
==============================

Python FastAPI service that owns the heavy ML work the Node backend cannot do:

* /ocr/handwriting   — TrOCR (microsoft/trocr-base-handwritten)
* /ocr/academic-pdf  — Nougat (facebook/nougat-small) → markdown + LaTeX
* /ocr/layout        — Unstructured.io layout-aware parser
* /eval/score        — lightweight WER/CER + keyword-overlap scoring

Model weights are loaded lazily on first request (keeps cold-start fast and
avoids downloading ~3 GB of weights on boot when the sidecar may not be used).
"""

from __future__ import annotations

import io
import logging
import tempfile
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("ai-sidecar")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Cognitive Copilot Sidecar", version="1.0.0")

_trocr = None  # tuple[processor, model]
_nougat = None


# ─── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "service": "ai-sidecar"}


# ─── Handwriting OCR (TrOCR) ────────────────────────────────────────────────

def _load_trocr():
    global _trocr
    if _trocr is None:
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        processor = TrOCRProcessor.from_pretrained("microsoft/trocr-base-handwritten")
        model = VisionEncoderDecoderModel.from_pretrained("microsoft/trocr-base-handwritten")
        model.eval()
        _trocr = (processor, model)
        logger.info("trocr loaded")
    return _trocr


@app.post("/ocr/handwriting")
async def ocr_handwriting(file: UploadFile = File(...)):
    """Run TrOCR on a single image. Returns plain-text transcription."""
    from PIL import Image

    try:
        raw = await file.read()
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid image: {err}")

    processor, model = _load_trocr()
    started = time.time()
    pixel_values = processor(images=image, return_tensors="pt").pixel_values
    generated_ids = model.generate(pixel_values, max_new_tokens=256)
    text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    return {"text": text, "engine": "trocr", "elapsedMs": int((time.time() - started) * 1000)}


# ─── Academic PDF OCR (Nougat) ──────────────────────────────────────────────

def _load_nougat():
    """
    Nougat exposes a CLI by default; we wrap its Python API so we can return
    per-page markdown. Held behind a feature flag so local dev without the
    ~1.4 GB weight download still starts quickly.
    """
    global _nougat
    if _nougat is None:
        try:
            from nougat import NougatModel  # type: ignore

            _nougat = NougatModel.from_pretrained("facebook/nougat-small")
            _nougat.eval()
            logger.info("nougat loaded")
        except Exception as err:  # noqa: BLE001
            logger.exception("nougat load failed")
            raise HTTPException(status_code=503, detail=f"nougat unavailable: {err}")
    return _nougat


@app.post("/ocr/academic-pdf")
async def ocr_academic_pdf(file: UploadFile = File(...)):
    """
    Run Nougat on each page of an academic PDF. Falls back to a best-effort
    page split if per-page mode is unavailable in the installed Nougat.
    """
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        import pypdfium2 as pdfium

        model = _load_nougat()
        pdf = pdfium.PdfDocument(str(tmp_path))
        pages_md: List[str] = []
        started = time.time()
        for page in pdf:
            image = page.render(scale=2.0).to_pil().convert("RGB")
            try:
                md = model.predict(image)
            except AttributeError:
                # Newer Nougat API: predict_batch([image])
                md = model.predict_batch([image])[0]
            pages_md.append(md if isinstance(md, str) else str(md))

        text = "\n\n".join(pages_md)
        return {
            "text": text,
            "pages": pages_md,
            "engine": "nougat",
            "elapsedMs": int((time.time() - started) * 1000),
        }
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass


# ─── Layout-aware OCR (Unstructured) ───────────────────────────────────────

@app.post("/ocr/layout")
async def ocr_layout(file: UploadFile = File(...)):
    """
    Unstructured.io parses a PDF into labelled elements (Title, NarrativeText,
    ListItem, Table...). Useful for downstream chunking by logical section.
    """
    from unstructured.partition.pdf import partition_pdf  # type: ignore

    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        started = time.time()
        elements = partition_pdf(filename=str(tmp_path), strategy="fast")
        return {
            "elements": [
                {"type": type(e).__name__, "text": getattr(e, "text", "") or ""}
                for e in elements
            ],
            "engine": "unstructured",
            "elapsedMs": int((time.time() - started) * 1000),
        }
    finally:
        tmp_path.unlink(missing_ok=True)


# ─── Eval scoring ───────────────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    prediction: str
    reference: str


@app.post("/eval/wer")
def eval_wer(payload: ScoreRequest):
    """Return CER + WER between prediction and reference using jiwer."""
    import jiwer

    cer = jiwer.cer(payload.reference, payload.prediction)
    wer = jiwer.wer(payload.reference, payload.prediction)
    return {"cer": float(cer), "wer": float(wer)}


class KeywordOverlapRequest(BaseModel):
    prediction: str
    reference_keywords: List[str]


@app.post("/eval/keyword-overlap")
def eval_keyword_overlap(payload: KeywordOverlapRequest):
    pred_lower = payload.prediction.lower()
    hits = [k for k in payload.reference_keywords if k.lower() in pred_lower]
    overlap = len(hits) / max(1, len(payload.reference_keywords))
    return {"overlap": overlap, "matched": hits}
