from app.db.base import Base  # noqa: F401 — ensures models register before Alembic sees metadata
from app.models.user import User  # noqa: F401
from app.models.course import Course, Enrollment, ScheduleSlot, Topic, Material, TopicProgress, AttendanceRecord  # noqa: F401
from app.models.community import Community, CommunityMember, Announcement, MarkUpload, Message, Thread, ThreadPost, ThreadLike  # noqa: F401
from app.models.misc import Notification, Embedding, LlmCall, ExamAttempt, RoutineScan, QuestionBank, StudySession  # noqa: F401
