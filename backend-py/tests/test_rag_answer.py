from __future__ import annotations

from app.services.rag.answer import (
    _enforce_dvfs_component_grounding,
    _enforce_inline_citations,
    _extract_dvfs_components,
)
from app.services.rag.retriever import RetrievedChunk


def _chunk(id_value: str, content: str) -> RetrievedChunk:
    return RetrievedChunk(
        id=id_value,
        material_id="m1",
        material_title="Low Power Computing",
        chunk_index=0,
        content=content,
        page=4,
        heading="DVFS",
        cosine_distance=0.1,
        bm25_rank=1,
        vector_rank=1,
        fused_score=0.9,
    )


def test_extract_dvfs_components_from_bullets_and_labels() -> None:
    chunks = [
        _chunk(
            "c1",
            """
            Components of DVFS include:
            - Hardware: Processors, voltage regulators, control circuits
            - Software: Operating systems and power management algorithms
            """,
        )
    ]

    components = _extract_dvfs_components(chunks)
    names = [name for name, _ in components]

    assert "Hardware" in names
    assert "Software" in names


def test_enforce_dvfs_components_appends_grounded_section_when_missing() -> None:
    chunks = [
        _chunk(
            "c2",
            """
            Components of DVFS include:
            1. Voltage Regulator: adjusts voltage levels.
            2. Clock/Frequency Controller: scales processor frequency.
            """,
        )
    ]

    answer = "DVFS improves power efficiency. [1]"
    corrected = _enforce_dvfs_component_grounding(answer, "What are the components of DVFS?", chunks)

    assert "Components of DVFS (Verified From Material)" in corrected
    assert "Voltage Regulator" in corrected
    assert "Clock/Frequency Controller" in corrected


def test_extract_dvfs_components_ignores_conditions_and_tradeoffs() -> None:
    chunks = [
        _chunk(
            "c3",
            """
            Components of DVFS include:
            - Hardware: Processors, voltage regulators, control circuits
            - Software: Operating systems and power management algorithms

            Under Light Load: lower frequency and voltage.
            Under Heavy Load: raise frequency and voltage.
            Complexity in Implementation: scheduler overhead.
            """,
        )
    ]

    components = _extract_dvfs_components(chunks)
    names = [name for name, _ in components]

    assert "Hardware" in names
    assert "Software" in names
    assert "Under Light Load" not in names
    assert "Under Heavy Load" not in names
    assert "Complexity in Implementation" not in names


def test_enforce_dvfs_components_replaces_unverified_component_section() -> None:
    chunks = [
        _chunk(
            "c4",
            """
            Components of DVFS include:
            - Hardware: Processors, voltage regulators, control circuits
            - Software: Operating systems and power management algorithms
            """,
        )
    ]

    answer = """
    **Techniques for Low Power Computing**
    - Clock Gating [1]

    **Components of DVFS**
    - Processor [1]
    """
    corrected = _enforce_dvfs_component_grounding(
        answer,
        "tell me techniques for low power computing and components of dvfs",
        chunks,
    )

    assert "- Processor [1]" not in corrected
    assert "Components of DVFS (Verified From Material)" in corrected
    assert "- Hardware [1]" in corrected
    assert "- Software [1]" in corrected


def test_enforce_dvfs_components_removes_inline_glitch_line() -> None:
    chunks = [
        _chunk(
            "c5",
            """
            Components of DVFS include:
            1. Voltage Regulator: adjusts voltage levels.
            2. Clock Control Unit: scales processor clock frequency.
            3. Processor / CPU: executes workload at selected performance state.
            """,
        )
    ]

    answer = """
    **Techniques for Low Power Computing**
    - Clock Gating [1]

    **Components of DVFS** - Hardware [2]
    """
    corrected = _enforce_dvfs_component_grounding(
        answer,
        "tell me about techniques for low power computing and components of dvfs",
        chunks,
    )

    assert "**Components of DVFS** - Hardware [2]" not in corrected
    assert "Components of DVFS (Verified From Material)" in corrected
    assert "- Voltage Regulator [1]" in corrected
    assert "- Clock Control Unit [1]" in corrected
    assert "- Processor / CPU [1]" in corrected


def test_enforce_inline_citations_adds_indices_for_uncited_bullets() -> None:
    chunks = [
        _chunk("c6", "DVFS adjusts voltage and frequency based on workload demand."),
        _chunk("c7", "Clock gating disables the clock signal in idle modules to reduce dynamic power."),
    ]

    answer = """
    - DVFS adjusts voltage and frequency based on workload
    - Clock gating disables the clock for idle units
    """
    corrected = _enforce_inline_citations(answer, chunks)

    assert "- DVFS adjusts voltage and frequency based on workload [1]" in corrected
    assert "- Clock gating disables the clock for idle units [2]" in corrected


def test_enforce_inline_citations_keeps_existing_citations_unchanged() -> None:
    chunks = [_chunk("c8", "Power gating cuts off supply to unused blocks.")]

    answer = "- Power gating cuts off supply to unused blocks [1]"
    corrected = _enforce_inline_citations(answer, chunks)

    assert corrected.count("[1]") == 1
