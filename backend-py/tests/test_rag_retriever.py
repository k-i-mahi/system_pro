from __future__ import annotations

from app.services.rag.retriever import (
    RetrievedChunk,
    _bm25_query_variants,
    _content_fingerprint,
    _lexical_overlap_score,
    _normalize_query,
    _query_terms,
    _rerank_and_select,
)


def test_query_normalization_and_terms() -> None:
    q = "How do I compute FFT in CSE-3200?"
    normalized = _normalize_query(q)
    assert normalized == "how do i compute fft in cse 3200"
    terms = _query_terms(q)
    assert "fft" in terms
    assert "cse" in terms


def test_lexical_overlap_scoring() -> None:
    terms = ["fft", "cooley", "tukey"]
    score = _lexical_overlap_score(terms, "The Cooley-Tukey FFT algorithm runs in O(n log n).")
    assert score > 0.5


def test_rerank_deduplicates_and_balances_materials() -> None:
    chunks = [
        RetrievedChunk(
            id="1",
            material_id="m1",
            material_title="Signals",
            chunk_index=0,
            content="FFT uses divide and conquer with Cooley Tukey.",
            page=1,
            heading="FFT",
            cosine_distance=0.1,
            bm25_rank=1,
            vector_rank=1,
            fused_score=0.9,
        ),
        RetrievedChunk(
            id="2",
            material_id="m1",
            material_title="Signals",
            chunk_index=1,
            content="FFT uses divide and conquer with Cooley Tukey.",
            page=2,
            heading="FFT",
            cosine_distance=0.11,
            bm25_rank=2,
            vector_rank=2,
            fused_score=0.85,
        ),
        RetrievedChunk(
            id="3",
            material_id="m2",
            material_title="DSP Notes",
            chunk_index=2,
            content="The discrete Fourier transform can be computed by FFT in O(n log n).",
            page=3,
            heading="Fourier",
            cosine_distance=0.12,
            bm25_rank=3,
            vector_rank=3,
            fused_score=0.8,
        ),
    ]

    selected = _rerank_and_select(chunks, "Explain FFT and Cooley Tukey algorithm", 2)
    ids = {c.id for c in selected}
    assert "1" in ids
    # Duplicate text should be dropped in favor of diverse chunk.
    assert "2" not in ids
    assert len(selected) == 2


def test_content_fingerprint_stable() -> None:
    a = _content_fingerprint("FFT   is fast.\nCooley Tukey")
    b = _content_fingerprint("fft is fast. cooley tukey")
    assert a == b


def test_rerank_keeps_short_definition_chunk() -> None:
    """Chunks shorter than the old 40-char floor should survive when they match the query."""
    chunks = [
        RetrievedChunk(
            id="1",
            material_id="m1",
            material_title="Glossary",
            chunk_index=0,
            content="FFT is fast Fourier transform.",
            page=1,
            heading="Terms",
            cosine_distance=0.05,
            bm25_rank=1,
            vector_rank=1,
            fused_score=0.95,
        ),
        RetrievedChunk(
            id="2",
            material_id="m1",
            material_title="Glossary",
            chunk_index=1,
            content="x" * 200,
            page=2,
            heading="Other",
            cosine_distance=0.2,
            bm25_rank=2,
            vector_rank=5,
            fused_score=0.4,
        ),
    ]
    selected = _rerank_and_select(chunks, "What does FFT stand for?", 2)
    assert any("FFT is fast" in (c.content or "") for c in selected)


def test_bm25_query_variants_include_expansion_for_dvfs() -> None:
    variants = _bm25_query_variants("Explain DVFS techniques")

    assert len(variants) >= 2
    assert any("dynamic" in v.lower() and "frequency" in v.lower() for v in variants)


def test_query_terms_expand_hmca_alias() -> None:
    terms = _query_terms("What is HMCA in low power computing?")

    assert "hmca" in terms
    assert "heterogeneous" in terms
    assert "architecture" in terms
