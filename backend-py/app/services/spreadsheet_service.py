from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ParsedMarkRow:
    row: int
    roll_number: str
    ct_score1: Optional[float] = None
    ct_score2: Optional[float] = None
    ct_score3: Optional[float] = None
    lab_score: Optional[float] = None


@dataclass
class ParseError:
    row: int
    roll_number: Optional[str] = None
    reason: str = ""


@dataclass
class ParseResult:
    records: list[ParsedMarkRow] = field(default_factory=list)
    errors: list[ParseError] = field(default_factory=list)


_ROLL_NAMES = {"rollnumber", "roll_number", "roll", "studentid", "student_id", "id"}
_SCORE_MAP: dict[str, str] = {
    "ct1": "ct_score1", "ctscore1": "ct_score1", "ct_score_1": "ct_score1",
    "ct2": "ct_score2", "ctscore2": "ct_score2", "ct_score_2": "ct_score2",
    "ct3": "ct_score3", "ctscore3": "ct_score3", "ct_score_3": "ct_score3",
    "lab": "lab_score", "labscore": "lab_score", "lab_score": "lab_score",
}


def _norm(h: str) -> str:
    return re.sub(r"[\s\-]+", "_", h.strip().lower())


def _parse_rows(rows: list[dict]) -> ParseResult:
    if not rows:
        return ParseResult(errors=[ParseError(row=0, reason="Spreadsheet is empty")])

    headers = list(rows[0].keys())
    header_map = {_norm(h): h for h in headers}

    roll_key = next((k for k in _ROLL_NAMES if k in header_map), None)
    if not roll_key:
        return ParseResult(errors=[ParseError(row=0, reason="No roll number column found. Expected: rollNumber, roll, studentId")])
    roll_header = header_map[roll_key]

    score_mapping = [(header_map[k], v) for k, v in _SCORE_MAP.items() if k in header_map]
    if not score_mapping:
        return ParseResult(errors=[ParseError(row=0, reason="No score columns found. Expected: CT1, CT2, CT3, Lab")])

    records: list[ParsedMarkRow] = []
    errors: list[ParseError] = []
    seen: set[str] = set()

    for i, row_data in enumerate(rows):
        row_num = i + 2
        roll_value = str(row_data.get(roll_header, "")).strip()

        if not roll_value:
            errors.append(ParseError(row=row_num, reason="Missing roll number"))
            continue

        if roll_value in seen:
            errors.append(ParseError(row=row_num, roll_number=roll_value, reason="Duplicate roll number (later entry used)"))
            prev = next((j for j, r in enumerate(records) if r.roll_number == roll_value), None)
            if prev is not None:
                records.pop(prev)
        seen.add(roll_value)

        record = ParsedMarkRow(row=row_num, roll_number=roll_value)
        has_valid = False

        for orig_header, field_name in score_mapping:
            raw = row_data.get(orig_header)
            if raw is None or raw == "":
                continue
            try:
                num = float(raw)
            except (ValueError, TypeError):
                errors.append(ParseError(row=row_num, roll_number=roll_value, reason=f"Invalid value for {orig_header}: \"{raw}\""))
                continue
            if num < 0:
                errors.append(ParseError(row=row_num, roll_number=roll_value, reason=f"Negative value for {orig_header}: {num}"))
                continue
            setattr(record, field_name, num)
            has_valid = True

        if has_valid:
            records.append(record)
        else:
            errors.append(ParseError(row=row_num, roll_number=roll_value, reason="No valid score values found"))

    return ParseResult(records=records, errors=errors)


def parse_spreadsheet(data: bytes, filename: str = "") -> ParseResult:
    lower = filename.lower()
    try:
        if lower.endswith(".csv"):
            text = data.decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            return _parse_rows(rows)
        else:
            import openpyxl  # type: ignore
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            ws = wb.active
            if ws is None:
                return ParseResult(errors=[ParseError(row=0, reason="Spreadsheet has no sheets")])
            iter_rows = list(ws.iter_rows(values_only=True))
            if not iter_rows:
                return ParseResult(errors=[ParseError(row=0, reason="Spreadsheet is empty")])
            headers = [str(c) if c is not None else "" for c in iter_rows[0]]
            rows = [dict(zip(headers, [str(c) if c is not None else "" for c in row])) for row in iter_rows[1:]]
            return _parse_rows(rows)
    except Exception as exc:
        return ParseResult(errors=[ParseError(row=0, reason=f"Failed to parse file: {exc}")])
