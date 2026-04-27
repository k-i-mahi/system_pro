"""Marks spreadsheet parsing: assessment label hint + single-column files."""
from __future__ import annotations

from app.services.spreadsheet_service import infer_assessment_field_from_label, parse_marks_spreadsheet


def test_infer_ct_labels() -> None:
    assert infer_assessment_field_from_label("CT 1") == "ct_score1"
    assert infer_assessment_field_from_label("ct2") == "ct_score2"
    assert infer_assessment_field_from_label("Class Test 3") == "ct_score3"
    assert infer_assessment_field_from_label("Lab final") == "lab_score"
    assert infer_assessment_field_from_label("") is None
    assert infer_assessment_field_from_label(None) is None


def test_parse_multi_column_csv() -> None:
    csv_bytes = b"rollNumber,CT1,CT2\n001,10,12\n002,9,11\n"
    r = parse_marks_spreadsheet(csv_bytes, "t.csv", None)
    assert len(r.records) == 2
    assert r.records[0].roll_number == "001"
    assert r.records[0].ct_score1 == 10.0
    assert r.records[0].ct_score2 == 12.0


def test_parse_single_column_with_assessment_hint() -> None:
    csv_bytes = b"roll,marks\n001,18\n002,16\n"
    r = parse_marks_spreadsheet(csv_bytes, "t.csv", "ct_score2")
    assert len(r.records) == 2
    assert r.records[0].ct_score2 == 18.0
    assert r.records[1].ct_score2 == 16.0


def test_parse_single_generic_column_defaults_to_class_test_1() -> None:
    csv_bytes = b"roll,marks\n001,18\n002,16\n"
    r = parse_marks_spreadsheet(csv_bytes, "t.csv", None)
    assert len(r.records) == 2
    assert r.records[0].ct_score1 == 18.0
    assert r.records[1].ct_score1 == 16.0


def test_reject_xls_filename_branch() -> None:
    r = parse_marks_spreadsheet(b"dummy", "bad.xls", "ct_score1")
    assert r.errors
    assert "Unsupported format" in r.errors[0].reason


def test_role_number_and_marks_slash_columns_with_blank_spacer_row() -> None:
    """Matches common templates: Role Number, Marks / 20, Marks / 10, blank row, then data."""
    csv_bytes = b"Role Number,Marks / 20,Marks / 10\n\n2107001,15,7\n2107002,16,8\n"
    r = parse_marks_spreadsheet(csv_bytes, "ct.csv", None)
    assert not r.errors
    assert len(r.records) == 2
    assert r.records[0].roll_number == "2107001"
    assert r.records[0].ct_score1 == 15.0
    assert r.records[0].ct_score2 == 7.0
    assert r.records[1].ct_score1 == 16.0
    assert r.records[1].ct_score2 == 8.0
