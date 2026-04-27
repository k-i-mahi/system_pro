"""Path B: marks upload rejects PDF and .xls at the router gate."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import UploadFile

from app.core.exceptions import ValidationError
from app.routers.community import _validate_marks_upload_file


def test_rejects_pdf_filename() -> None:
    f = MagicMock(spec=UploadFile)
    f.filename = "marks.pdf"
    f.content_type = "application/pdf"
    with pytest.raises(ValidationError, match="xlsx"):
        _validate_marks_upload_file(f)


def test_rejects_xls_filename() -> None:
    f = MagicMock(spec=UploadFile)
    f.filename = "old.xls"
    f.content_type = "application/vnd.ms-excel"
    with pytest.raises(ValidationError, match="xlsx"):
        _validate_marks_upload_file(f)


def test_rejects_pdf_content_type_even_if_spoofed_name() -> None:
    f = MagicMock(spec=UploadFile)
    f.filename = "fake.csv"
    f.content_type = "application/pdf"
    with pytest.raises(ValidationError):
        _validate_marks_upload_file(f)


def test_accepts_csv() -> None:
    f = MagicMock(spec=UploadFile)
    f.filename = "m.csv"
    f.content_type = "text/csv"
    _validate_marks_upload_file(f)
