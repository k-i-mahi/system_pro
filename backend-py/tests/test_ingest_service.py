from __future__ import annotations

from app.services.ingest_service import _chunk_text


def test_chunk_text_returns_empty_for_blank() -> None:
    assert _chunk_text("   ") == []


def test_chunk_text_splits_large_input() -> None:
    text_value = "\n".join([f"Paragraph {i} " + ("A" * 600) for i in range(20)])
    chunks = _chunk_text(text_value, target_tokens=200, overlap_tokens=40)
    assert len(chunks) > 1
    assert chunks[0].chunk_index == 0
    assert chunks[-1].chunk_index == len(chunks) - 1
    assert all(c.content.strip() for c in chunks)
