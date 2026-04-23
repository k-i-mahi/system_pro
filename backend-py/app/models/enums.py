from __future__ import annotations

import enum


class Role(str, enum.Enum):
    STUDENT = "STUDENT"
    MENTOR = "MENTOR"
    TUTOR = "TUTOR"
    ADMIN = "ADMIN"


class CommunityRole(str, enum.Enum):
    STUDENT = "STUDENT"
    TUTOR = "TUTOR"


class TimeFormat(str, enum.Enum):
    H24 = "H24"
    H12 = "H12"


class DateFormat(str, enum.Enum):
    MDY = "MDY"
    DMY = "DMY"
    DD_MM_YYYY = "DD_MM_YYYY"
    MM_DD_YYYY = "MM_DD_YYYY"
    YYYY_MM_DD = "YYYY_MM_DD"


class DayOfWeek(str, enum.Enum):
    MON = "MON"
    TUE = "TUE"
    WED = "WED"
    THU = "THU"
    FRI = "FRI"
    SAT = "SAT"
    SUN = "SUN"


class CourseType(str, enum.Enum):
    THEORY = "THEORY"
    LAB = "LAB"


class SlotType(str, enum.Enum):
    CLASS = "CLASS"
    LAB = "LAB"


class MaterialType(str, enum.Enum):
    PDF = "PDF"
    LINK = "LINK"
    VIDEO = "VIDEO"
    IMAGE = "IMAGE"
    NOTE = "NOTE"


class NotificationType(str, enum.Enum):
    NEW_COURSE = "NEW_COURSE"
    MESSAGE = "MESSAGE"
    SYSTEM = "SYSTEM"
    MY_COURSE = "MY_COURSE"
    CLASS_REMINDER = "CLASS_REMINDER"
    LAB_REMINDER = "LAB_REMINDER"
    EXAM_REMINDER = "EXAM_REMINDER"
    TOPIC_SUGGESTION = "TOPIC_SUGGESTION"
    MATERIAL_UPLOAD_PROMPT = "MATERIAL_UPLOAD_PROMPT"
    ANNOUNCEMENT = "ANNOUNCEMENT"
    ATTENDANCE_ALERT = "ATTENDANCE_ALERT"


class ScanStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    DONE = "DONE"
    FAILED = "FAILED"


class TopicStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"


class OcrQuality(str, enum.Enum):
    FAST = "FAST"
    ACCURATE = "ACCURATE"


class IngestStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    DONE = "DONE"
    FAILED = "FAILED"


class LlmCallStatus(str, enum.Enum):
    OK = "OK"
    ERROR = "ERROR"
    TIMEOUT = "TIMEOUT"


class TutorStrategy(str, enum.Enum):
    EXPLAIN = "EXPLAIN"
    SOCRATIC = "SOCRATIC"
    HINT_LADDER = "HINT_LADDER"
    WORKED_EXAMPLE = "WORKED_EXAMPLE"
    MISCONCEPTION_PROBE = "MISCONCEPTION_PROBE"
