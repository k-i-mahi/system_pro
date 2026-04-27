import { Fragment, useState, useCallback, useEffect, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { isLabCourse } from '@/lib/course-type';
import toast from 'react-hot-toast';
import { canUploadMaterial } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';
import {
  enqueueMaterialFiles,
  retryMaterialUploadFromIdb,
  useMaterialUploadStore,
} from '@/stores/material-upload.store';
import { useShallow } from 'zustand/react/shallow';

/** Tutor/official marks on enrollment (not edited via student self-service UI). */
type StudentLabMarks = {
  labTest?: number | null;
  labQuiz?: number | null;
  assignment?: number | null;
};

/** Student-entered theory marks (Path B); separate from instructor ctScore/labScore. */
type StudentTheoryMarks = {
  classTest1?: number | null;
  classTest2?: number | null;
  classTest3?: number | null;
  assignment?: number | null;
};

type EnrollmentScores = {
  id?: string;
  ctScore1?: number | null;
  ctScore2?: number | null;
  ctScore3?: number | null;
  labScore?: number | null;
  /** Student self-tracked lab marks (LAB courses); separate from ctScore/labScore. */
  studentLabMarks?: StudentLabMarks | null;
  /** Student self-entered theory marks (THEORY courses). */
  studentTheoryMarks?: StudentTheoryMarks | null;
};

type MaterialItem = {
  id: string;
  title: string;
  fileUrl: string;
  fileType: string;
  uploadedAt?: string;
};

type TopicItem = {
  id: string;
  title: string;
  description?: string | null;
  weekNumber?: number | null;
  sessionDate?: string | null;
  createdAt: string;
  isPersonal?: boolean;
  createdBy?: string | null;
  materials?: MaterialItem[];
};

type TodayAttendance = {
  slotId: string;
  startTime: string;
  endTime: string;
  room?: string | null;
  isPresent: boolean;
  isMarked: boolean;
};

type CourseDetail = {
  courseCode: string;
  courseName: string;
  /** THEORY vs LAB from API (`Course.courseType`); defaults to theory-style labels when absent. */
  courseType?: string;
  enrollment?: EnrollmentScores | null;
  topics?: TopicItem[];
  canManage?: boolean;
  isTeaching?: boolean;
  /** From API; used when enrollment object is missing but the viewer is still the enrolled student. */
  viewerRole?: string;
  communityId?: string | null;
  communityName?: string | null;
  todayAttendance?: TodayAttendance | null;
  _count?: {
    students?: number;
    materials?: number;
  };
};

type TopicDraft = {
  title: string;
  description: string;
  weekNumber: string;
  sessionDate: string;
};

type MaterialDraft = {
  title: string;
  fileUrl: string;
};

const SUPPORTED_MATERIAL_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp', '.txt'];
const SUPPORTED_MATERIAL_LABEL = 'PDF, DOCX, JPG, JPEG, PNG, WEBP, TXT';

function formatTopicDate(value?: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function topicToDraft(topic: TopicItem): TopicDraft {
  return {
    title: topic.title,
    description: topic.description ?? '',
    weekNumber: topic.weekNumber != null ? String(topic.weekNumber) : '',
    sessionDate: toDateInputValue(topic.sessionDate),
  };
}

function materialToDraft(material: MaterialItem): MaterialDraft {
  return {
    title: material.title,
    fileUrl: material.fileType === 'LINK' ? material.fileUrl : '',
  };
}

function extractErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

type LabMarkFieldKey = 'labTest' | 'labQuiz' | 'assignment';

type TheoryMarkFieldKey = 'classTest1' | 'classTest2' | 'classTest3' | 'assignment';

type AssessmentRow = {
  label: string;
  score: number | null | undefined;
  max: number;
  /** Tutor-uploaded official mark (theory CT / enrollment); read-only. */
  officialScore?: number | null;
  /** Present for lab courses — maps to `studentLabMarks` / PATCH body. */
  labField?: LabMarkFieldKey;
  /** Present for theory courses — maps to `studentTheoryMarks` / PATCH body. */
  theoryField?: TheoryMarkFieldKey;
};

function buildStudentAssessmentRows(course: CourseDetail): AssessmentRow[] {
  const e = course.enrollment;
  if (!e) return [];
  if (isLabCourse(course)) {
    const m = e.studentLabMarks;
    return [
      { label: 'Lab Test', labField: 'labTest', score: m?.labTest ?? null, max: 20 },
      { label: 'Lab Quiz', labField: 'labQuiz', score: m?.labQuiz ?? null, max: 20 },
      { label: 'Assignment', labField: 'assignment', score: m?.assignment ?? null, max: 40 },
    ];
  }
  const m = e.studentTheoryMarks;
  return [
    {
      label: 'Class Test 1',
      theoryField: 'classTest1',
      score: m?.classTest1 ?? null,
      max: 20,
      officialScore: e.ctScore1 ?? null,
    },
    {
      label: 'Class Test 2',
      theoryField: 'classTest2',
      score: m?.classTest2 ?? null,
      max: 20,
      officialScore: e.ctScore2 ?? null,
    },
    {
      label: 'Class Test 3',
      theoryField: 'classTest3',
      score: m?.classTest3 ?? null,
      max: 20,
      officialScore: e.ctScore3 ?? null,
    },
    { label: 'Assignment/Spot Test', theoryField: 'assignment', score: m?.assignment ?? null, max: 40 },
  ];
}

function isSupportedMaterialFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_MATERIAL_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function getMaterialBadgeLabel(material: MaterialItem): string {
  const lowerTitle = material.title.toLowerCase();
  const matchedExtension = SUPPORTED_MATERIAL_EXTENSIONS.find((extension) => lowerTitle.endsWith(extension));

  if (matchedExtension) {
    return matchedExtension.slice(1).toUpperCase();
  }
  if (material.fileType === 'NOTE') return 'TXT';
  return material.fileType;
}

function buildCreateTopicPayload(draft: TopicDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = { title: draft.title.trim() };
  const description = draft.description.trim();

  if (description) payload.description = description;
  if (draft.weekNumber.trim()) payload.weekNumber = Number.parseInt(draft.weekNumber, 10);
  if (draft.sessionDate) payload.sessionDate = new Date(`${draft.sessionDate}T00:00:00`).toISOString();

  return payload;
}

function buildUpdateTopicPayload(draft: TopicDraft): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    weekNumber: draft.weekNumber.trim() ? Number.parseInt(draft.weekNumber, 10) : null,
    sessionDate: draft.sessionDate ? new Date(`${draft.sessionDate}T00:00:00`).toISOString() : null,
  };
}

export default function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManageByRole = canUploadMaterial(user);

  const openMaterialUrl = useCallback((e: React.MouseEvent<HTMLAnchorElement>, material: MaterialItem) => {
    if (material.fileType === 'LINK') return;
    e.preventDefault();
    const raw = material.fileUrl;
    if (!raw) { toast.error('Material URL is not available.'); return; }
    // Images display fine inline; all other uploads (PDF, DOCX, PPTX etc.) are forced to
    // download via Cloudinary's fl_attachment flag to avoid browser PDF-viewer failures.
    let url = raw;
    if (material.fileType !== 'IMAGE' && raw.includes('res.cloudinary.com') && raw.includes('/upload/')) {
      url = raw.replace('/upload/', '/upload/fl_attachment/');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const [expandedTopicIds, setExpandedTopicIds] = useState<string[]>([]);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopic, setNewTopic] = useState<TopicDraft>({
    title: '',
    description: '',
    weekNumber: '',
    sessionDate: '',
  });
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState<TopicDraft>({
    title: '',
    description: '',
    weekNumber: '',
    sessionDate: '',
  });
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft>({ title: '', fileUrl: '' });
  const [fileFormatWarning, setFileFormatWarning] = useState<{ topicId: string; message: string } | null>(null);
  const [labDraft, setLabDraft] = useState<Record<LabMarkFieldKey, string>>({
    labTest: '',
    labQuiz: '',
    assignment: '',
  });
  const [theoryDraft, setTheoryDraft] = useState<Record<TheoryMarkFieldKey, string>>({
    classTest1: '',
    classTest2: '',
    classTest3: '',
    assignment: '',
  });

  const {
    data: course,
    isPending: courseQueryPending,
    isError: courseQueryError,
    error: courseQueryErr,
  } = useQuery<CourseDetail>({
    queryKey: ['course', courseId],
    queryFn: () => api.get(`/courses/${courseId}`).then((response) => response.data.data as CourseDetail),
    enabled: !!courseId,
    placeholderData: keepPreviousData,
    retry: (failCount, err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failCount < 2;
    },
  });
  const viewerId = user?.id;
  const canManageCourse = canManageByRole && Boolean(course?.canManage);
  const isEnrolledStudent =
    user?.role === 'STUDENT' && (Boolean(course?.enrollment) || course?.viewerRole === 'STUDENT');
  const canAddTopicInHeader = canManageCourse || isEnrolledStudent;

  const courseMaterialUploads = useMaterialUploadStore(
    useShallow((s) => s.items.filter((i) => i.courseId === courseId)),
  );

  useEffect(() => {
    if (!course || !isLabCourse(course) || !course.enrollment) return;
    const m = course.enrollment.studentLabMarks;
    setLabDraft({
      labTest: m?.labTest != null ? String(m.labTest) : '',
      labQuiz: m?.labQuiz != null ? String(m.labQuiz) : '',
      assignment: m?.assignment != null ? String(m.assignment) : '',
    });
  }, [course, courseId, course?.enrollment?.studentLabMarks]);

  useEffect(() => {
    if (!course || isLabCourse(course) || !course.enrollment) return;
    const m = course.enrollment.studentTheoryMarks;
    setTheoryDraft({
      classTest1: m?.classTest1 != null ? String(m.classTest1) : '',
      classTest2: m?.classTest2 != null ? String(m.classTest2) : '',
      classTest3: m?.classTest3 != null ? String(m.classTest3) : '',
      assignment: m?.assignment != null ? String(m.assignment) : '',
    });
  }, [course, courseId, course?.enrollment?.studentTheoryMarks]);

  const patchStudentLabMarksMutation = useMutation({
    mutationFn: (payload: Partial<Record<LabMarkFieldKey, number | null>>) =>
      api.patch(`/courses/${courseId}/my-lab-marks`, payload).then((response) => response.data.data as { studentLabMarks: StudentLabMarks }),
    onSuccess: () => {
      invalidateCourseViews();
      toast.success('Your lab marks were saved.', {
        icon: <CheckCircle2 className="text-green-600" size={20} />,
        duration: 3500,
      });
    },
    onError: (err: unknown) => {
      toast.error(extractErrorMessage(err, 'Could not save lab marks.'));
    },
  });

  function saveLabMarkField(field: LabMarkFieldKey, max: number) {
    const raw = labDraft[field].trim();
    if (raw === '') {
      toast.error('Enter a mark or use Clear.');
      return;
    }
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) {
      toast.error('Enter a valid number.');
      return;
    }
    if (n < 0 || n > max) {
      toast.error(`Mark must be between 0 and ${max}.`);
      return;
    }
    patchStudentLabMarksMutation.mutate({ [field]: n });
  }

  function clearLabMarkField(field: LabMarkFieldKey) {
    patchStudentLabMarksMutation.mutate({ [field]: null });
  }

  const patchStudentTheoryMarksMutation = useMutation({
    mutationFn: (payload: Partial<Record<TheoryMarkFieldKey, number | null>>) =>
      api
        .patch(`/courses/${courseId}/my-theory-marks`, payload)
        .then((response) => response.data.data as { studentTheoryMarks: StudentTheoryMarks }),
    onSuccess: () => {
      invalidateCourseViews();
      toast.success('Your marks were saved.', {
        icon: <CheckCircle2 className="text-green-600" size={20} />,
        duration: 3500,
      });
    },
    onError: (err: unknown) => {
      toast.error(extractErrorMessage(err, 'Could not save marks.'));
    },
  });

  function saveTheoryMarkField(field: TheoryMarkFieldKey, max: number) {
    const raw = theoryDraft[field].trim();
    if (raw === '') {
      toast.error('Enter a mark or use Clear.');
      return;
    }
    const n = Number.parseFloat(raw);
    if (Number.isNaN(n)) {
      toast.error('Enter a valid number.');
      return;
    }
    if (n < 0 || n > max) {
      toast.error(`Mark must be between 0 and ${max}.`);
      return;
    }
    patchStudentTheoryMarksMutation.mutate({ [field]: n });
  }

  function clearTheoryMarkField(field: TheoryMarkFieldKey) {
    patchStudentTheoryMarksMutation.mutate({ [field]: null });
  }

  function canModifyTopic(topic: TopicItem): boolean {
    if (canManageCourse) return true;
    if (isEnrolledStudent && topic.isPersonal && topic.createdBy === viewerId) return true;
    return false;
  }

  function invalidateCourseViews(includeNotifications = false) {
    const tasks: Promise<void>[] = [
      queryClient.invalidateQueries({ queryKey: ['course', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['analytics-course', courseId] }),
      queryClient.invalidateQueries({ queryKey: ['my-courses'] }),
    ];

    if (includeNotifications) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['notifications'] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] }));
    }

    void Promise.all(tasks);
  }

  function toggleTopicExpansion(topicId: string) {
    setExpandedTopicIds((previous) =>
      previous.includes(topicId) ? previous.filter((id) => id !== topicId) : [...previous, topicId]
    );
  }

  function ensureExpanded(topicId: string) {
    setExpandedTopicIds((previous) => (previous.includes(topicId) ? previous : [...previous, topicId]));
  }

  function resetTopicEditor() {
    setEditingTopicId(null);
    setTopicDraft({ title: '', description: '', weekNumber: '', sessionDate: '' });
  }

  function openTopicEditor(topic: TopicItem) {
    ensureExpanded(topic.id);
    setEditingTopicId(topic.id);
    setTopicDraft(topicToDraft(topic));
  }

  function resetMaterialEditor() {
    setEditingMaterialId(null);
    setMaterialDraft({ title: '', fileUrl: '' });
  }

  function openMaterialEditor(topicId: string, material: MaterialItem) {
    ensureExpanded(topicId);
    setEditingMaterialId(material.id);
    setMaterialDraft(materialToDraft(material));
  }

  const addTopicMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post(`/courses/${courseId}/topics`, payload),
    onSuccess: () => {
      invalidateCourseViews();
      setShowAddTopic(false);
      setNewTopic({ title: '', description: '', weekNumber: '', sessionDate: '' });
      toast.success('Topic added');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to add topic.'));
    },
  });

  const updateTopicMutation = useMutation({
    mutationFn: ({ topicId, payload }: { topicId: string; payload: Record<string, unknown> }) =>
      api.put(`/courses/${courseId}/topics/${topicId}`, payload),
    onSuccess: () => {
      invalidateCourseViews();
      resetTopicEditor();
      toast.success('Topic updated');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to update topic.'));
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: (topicId: string) => api.delete(`/courses/${courseId}/topics/${topicId}`),
    onSuccess: (_, deletedTopicId) => {
      invalidateCourseViews();
      setExpandedTopicIds((previous) => previous.filter((id) => id !== deletedTopicId));
      resetTopicEditor();
      resetMaterialEditor();
      toast.success('Topic deleted');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to delete topic.'));
    },
  });

  const updateMaterialMutation = useMutation({
    mutationFn: ({
      topicId,
      materialId,
      payload,
    }: {
      topicId: string;
      materialId: string;
      payload: Record<string, unknown>;
    }) => api.patch(`/courses/${courseId}/topics/${topicId}/materials/${materialId}`, payload),
    onSuccess: () => {
      invalidateCourseViews();
      resetMaterialEditor();
      toast.success('Material updated');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to update material.'));
    },
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: ({ topicId, materialId }: { topicId: string; materialId: string }) =>
      api.delete(`/courses/${courseId}/topics/${topicId}/materials/${materialId}`),
    onSuccess: () => {
      invalidateCourseViews();
      resetMaterialEditor();
      toast.success('Material deleted');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to delete material.'));
    },
  });

  function handleAddTopic() {
    if (!newTopic.title.trim()) {
      toast.error('Topic title is required.');
      return;
    }

    const payload = buildCreateTopicPayload(newTopic);
    if (user?.role === 'STUDENT') {
      payload.status = 'IN_PROGRESS';
    }
    addTopicMutation.mutate(payload);
  }

  function handleUpdateTopic() {
    if (!editingTopicId) return;
    if (!topicDraft.title.trim()) {
      toast.error('Topic title is required.');
      return;
    }

    updateTopicMutation.mutate({
      topicId: editingTopicId,
      payload: buildUpdateTopicPayload(topicDraft),
    });
  }

  function handleUpdateMaterial(topicId: string, material: MaterialItem) {
    if (!materialDraft.title.trim()) {
      toast.error('Material title is required.');
      return;
    }

    const payload: Record<string, unknown> = { title: materialDraft.title.trim() };

    if (material.fileType === 'LINK') {
      const fileUrl = materialDraft.fileUrl.trim();
      if (!fileUrl) {
        toast.error('Link materials need a valid URL.');
        return;
      }
      payload.fileUrl = fileUrl;
    }

    updateMaterialMutation.mutate({
      topicId,
      materialId: material.id,
      payload,
    });
  }

  function handleMaterialFileSelection(topicId: string, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0) return;

    for (const file of files) {
      if (!isSupportedMaterialFile(file)) {
        const ext = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : 'UNKNOWN';
        setFileFormatWarning({
          topicId,
          message: `.${String(ext).toLowerCase()} is not supported. Please upload: ${SUPPORTED_MATERIAL_LABEL}.`,
        });
        setTimeout(() => {
          setFileFormatWarning((w) => (w?.topicId === topicId ? null : w));
        }, 8000);
        continue;
      }

      setFileFormatWarning((w) => (w?.topicId === topicId ? null : w));
      enqueueMaterialFiles(courseId, topicId, [file]);
    }
  }

  if (!courseId) {
    return (
      <div className="py-12 text-center text-text-secondary">
        <p className="text-text-muted">No course was selected.</p>
        <Link to="/courses" className="mt-2 inline-block text-primary hover:underline">
          Back to My Courses
        </Link>
      </div>
    );
  }

  if (courseQueryPending) return <div className="py-12 text-center text-text-muted">Loading...</div>;

  if (courseQueryError) {
    const status = (courseQueryErr as { response?: { status?: number; data?: { error?: { message?: string } } } })
      ?.response?.status;
    const message =
      (courseQueryErr as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
    return (
      <div className="py-12 text-center text-text-secondary">
        <p className="text-text-primary font-medium">
          {status === 404 ? "We couldn’t find this course" : "Couldn’t load this course"}
        </p>
        <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
          {message ||
            (status === 404
              ? "It may have been removed, or the link is outdated. Open the course from My Courses again."
              : "Check your connection and try again.")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link to="/courses" className="text-primary hover:underline">
            Back to My Courses
          </Link>
        </div>
      </div>
    );
  }

  if (!course) {
    return <div className="py-12 text-center text-text-muted">Course not found</div>;
  }

  return (
    <div>
      <Link to="/courses" className="mb-4 flex items-center gap-2 text-text-secondary hover:text-primary">
        <ArrowLeft size={18} />
        Back to Courses
      </Link>

      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="badge mb-2 bg-primary-light font-mono text-primary">{course.courseCode}</span>
            <h1 className="page-title">{course.courseName}</h1>
            {course.isTeaching && (
              <p className="mt-2 text-sm text-text-secondary">
                {course._count?.students || 0} students • {course.topics?.length || 0} topics • {course._count?.materials || 0} materials
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {course.communityId && course.isTeaching && (
              <Link to={`/community/${course.communityId}`} className="btn-secondary text-sm">
                Open Classroom
              </Link>
            )}
            {user?.role === 'STUDENT' && (
              <Link to={`/ai-tutor?courseId=${courseId}`} className="btn-secondary flex items-center gap-2 text-sm">
                <Bot size={16} />
                Study with AI
              </Link>
            )}
          </div>
        </div>
      </div>

      {!course.isTeaching && course.enrollment && (
        <div className="card mb-6">
          <h2 className="mb-4 text-lg font-semibold">My Scores</h2>
          {isLabCourse(course) && (
            <p className="mb-3 max-w-2xl text-xs text-text-muted">
              Enter or update your own lab marks below. These are stored for your account only and are separate from
              instructor-uploaded class marks.
            </p>
          )}
          {isLabCourse(course) && course.enrollment?.labScore != null && (
            <p className="mb-3 max-w-2xl text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Instructor-recorded lab mark: </span>
              {course.enrollment.labScore}
            </p>
          )}
          {!isLabCourse(course) && (
            <p className="mb-3 max-w-2xl text-xs text-text-muted">
              <strong>Official</strong> shows marks your instructor recorded from classroom uploads. <strong>Your entry</strong>{' '}
              is optional self-tracking and stays separate unless you save it.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">Assessment</th>
                  {!isLabCourse(course) && (
                    <th className="px-3 py-2 text-center font-medium text-text-secondary">Official</th>
                  )}
                  <th className="px-3 py-2 text-center font-medium text-text-secondary">Your entry</th>
                  <th className="px-3 py-2 text-center font-medium text-text-secondary">Max</th>
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {buildStudentAssessmentRows(course).map((row) => {
                  const labField = row.labField;
                  const theoryField = row.theoryField;
                  const draftVal = labField
                    ? labDraft[labField]
                    : theoryField
                      ? theoryDraft[theoryField]
                      : '';
                  const numericFromDraft =
                    labField || theoryField
                      ? draftVal.trim() === ''
                        ? null
                        : Number.parseFloat(draftVal)
                      : null;
                  const effectiveScore =
                    labField || theoryField
                      ? numericFromDraft != null && !Number.isNaN(numericFromDraft)
                        ? numericFromDraft
                        : row.score ?? null
                      : row.score;
                  const percentage =
                    effectiveScore != null && !Number.isNaN(effectiveScore)
                      ? Math.round((effectiveScore / row.max) * 100)
                      : null;

                  return (
                    <tr
                      key={labField ?? theoryField ?? row.label}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2.5 font-medium">{row.label}</td>
                      {!isLabCourse(course) && (
                        <td className="px-3 py-2.5 text-center text-text-secondary">
                          {row.officialScore != null && row.officialScore !== undefined ? row.officialScore : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-center">
                        {labField ? (
                          <input
                            type="number"
                            min={0}
                            max={row.max}
                            step={0.5}
                            className="input mx-auto w-24 py-1 text-center text-sm"
                            value={labDraft[labField]}
                            onChange={(event) =>
                              setLabDraft((previous) => ({ ...previous, [labField]: event.target.value }))
                            }
                            aria-label={`${row.label} mark`}
                          />
                        ) : theoryField ? (
                          <input
                            type="number"
                            min={0}
                            max={row.max}
                            step={0.5}
                            className="input mx-auto w-24 py-1 text-center text-sm"
                            value={theoryDraft[theoryField]}
                            onChange={(event) =>
                              setTheoryDraft((previous) => ({ ...previous, [theoryField]: event.target.value }))
                            }
                            aria-label={`${row.label} mark`}
                          />
                        ) : row.score != null ? (
                          row.score
                        ) : (
                          'Not evaluated yet'
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center text-text-muted">{row.max}</td>
                      <td className="px-3 py-2.5">
                        {percentage != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-main">
                              <div
                                className={`h-full rounded-full ${
                                  percentage >= 60 ? 'bg-accent' : percentage >= 40 ? 'bg-warning' : 'bg-danger'
                                }`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-xs text-text-muted">{percentage}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">Not evaluated yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {labField ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="btn-primary py-1 text-xs"
                              disabled={patchStudentLabMarksMutation.isPending}
                              onClick={() => saveLabMarkField(labField, row.max)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-secondary py-1 text-xs"
                              disabled={patchStudentLabMarksMutation.isPending}
                              onClick={() => clearLabMarkField(labField)}
                            >
                              Clear
                            </button>
                          </div>
                        ) : theoryField ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="btn-primary py-1 text-xs"
                              disabled={patchStudentTheoryMarksMutation.isPending}
                              onClick={() => saveTheoryMarkField(theoryField, row.max)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-secondary py-1 text-xs"
                              disabled={patchStudentTheoryMarksMutation.isPending}
                              onClick={() => clearTheoryMarkField(theoryField)}
                            >
                              Clear
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Course Schedule & Topics ({course.topics?.length || 0})</h2>
          {isEnrolledStudent && !canManageCourse && (
            <p className="mt-1 max-w-2xl text-xs text-text-muted">
              Shared topics and materials come from your instructor. You can add personal topics for your own notes.
              Attendance is recorded from class reminders in Notifications, not from topics.
            </p>
          )}
        </div>
        {canAddTopicInHeader && (
          <button
            onClick={() => setShowAddTopic((previous) => !previous)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={16} />
            Add Topic
          </button>
        )}
      </div>

      {canAddTopicInHeader && showAddTopic && (
        <div className="card mb-4">
          <h3 className="mb-3 text-sm font-semibold">
            {canManageCourse ? 'New Topic' : 'New personal topic'}
          </h3>
          {!canManageCourse && isEnrolledStudent && (
            <p className="mb-3 text-xs text-text-secondary">
              Personal topics are visible only to you on this course. They are not the shared class schedule.
            </p>
          )}
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label text-xs">Title *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Introduction to Data Structures"
                value={newTopic.title}
                onChange={(event) => setNewTopic((previous) => ({ ...previous, title: event.target.value }))}
              />
            </div>
            <div>
              <label className="label text-xs">Week Number</label>
              <input
                type="number"
                min={1}
                className="input"
                placeholder="e.g. 1"
                value={newTopic.weekNumber}
                onChange={(event) => setNewTopic((previous) => ({ ...previous, weekNumber: event.target.value }))}
              />
            </div>
            <div>
              <label className="label text-xs">Session Date</label>
              <input
                type="date"
                className="input"
                value={newTopic.sessionDate}
                onChange={(event) => setNewTopic((previous) => ({ ...previous, sessionDate: event.target.value }))}
              />
            </div>
            <div>
              <label className="label text-xs">Description / Content</label>
              <input
                type="text"
                className="input"
                placeholder="Brief description of topic content"
                value={newTopic.description}
                onChange={(event) => setNewTopic((previous) => ({ ...previous, description: event.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddTopic}
              className="btn-primary text-sm"
              disabled={!newTopic.title.trim() || addTopicMutation.isPending}
            >
              {addTopicMutation.isPending ? 'Adding...' : 'Add Topic'}
            </button>
            <button onClick={() => setShowAddTopic(false)} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-main">
                <th className="w-12 px-4 py-3 text-left font-medium text-text-secondary">#</th>
                <th className="w-16 px-4 py-3 text-left font-medium text-text-secondary">Week</th>
                <th className="w-28 px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Topic</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Content</th>
                <th className="w-24 px-4 py-3 text-center font-medium text-text-secondary">Materials</th>
                <th className="w-36 px-4 py-3 text-center font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!course.topics || course.topics.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-text-muted">
                    <BookOpen size={32} className="mx-auto mb-2" />
                    <p>{canAddTopicInHeader ? 'No topics yet. Add your first topic to get started.' : 'No topics in this course yet.'}</p>
                  </td>
                </tr>
              ) : (
                course.topics.map((topic, index) => {
                  const isExpanded = expandedTopicIds.includes(topic.id);
                  const topicMaterials = topic.materials ?? [];
                  const topicUploading = courseMaterialUploads.filter((u) => u.topicId === topic.id);

                  return (
                    <Fragment key={topic.id}>
                      <tr className="border-b border-border transition-colors hover:bg-bg-main/50">
                        <td
                          className="cursor-pointer px-4 py-3 text-text-muted"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          {index + 1}
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          {topic.weekNumber ? `W${topic.weekNumber}` : '-'}
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3 text-text-secondary"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          {formatTopicDate(topic.sessionDate)}
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3 font-medium"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span>{topic.title}</span>
                          </div>
                        </td>
                        <td
                          className="max-w-md cursor-pointer px-4 py-3 text-text-secondary"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          <span className="line-clamp-2">{topic.description || '-'}</span>
                        </td>
                        <td
                          className="cursor-pointer px-4 py-3 text-center"
                          onClick={() => toggleTopicExpansion(topic.id)}
                        >
                          <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-bg-main px-2 py-1 text-xs font-medium text-text-secondary">
                            {topicMaterials.length}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              to={`/ai-tutor?topicId=${topic.id}&courseId=${courseId}`}
                              className="rounded p-1.5 text-primary hover:bg-primary-light"
                              title="Study with AI"
                            >
                              <Bot size={14} />
                            </Link>
                            {canModifyTopic(topic) && (
                              <button
                                onClick={() => openTopicEditor(topic)}
                                className="rounded p-1.5 text-primary hover:bg-primary-light"
                                title="Edit topic"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {canModifyTopic(topic) && (
                              <button
                                onClick={() => {
                                  const confirmed = window.confirm(
                                    `Delete "${topic.title}" and all of its uploaded materials?`
                                  );
                                  if (confirmed) {
                                    deleteTopicMutation.mutate(topic.id);
                                  }
                                }}
                                className="rounded p-1.5 text-danger hover:bg-red-50"
                                title="Delete topic"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-border bg-bg-main/30">
                          <td colSpan={7} className="p-4" onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
                              {canModifyTopic(topic) && editingTopicId === topic.id && (
                                <div className="rounded-xl border border-border bg-white p-4">
                                  <div className="mb-3 flex items-center justify-between">
                                    <h4 className="text-sm font-semibold">Edit Topic</h4>
                                    <button
                                      onClick={resetTopicEditor}
                                      className="rounded p-1 text-text-muted hover:bg-bg-main"
                                      title="Cancel topic edit"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                  <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div>
                                      <label className="label text-xs">Title *</label>
                                      <input
                                        type="text"
                                        className="input"
                                        value={topicDraft.title}
                                        onChange={(event) =>
                                          setTopicDraft((previous) => ({ ...previous, title: event.target.value }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="label text-xs">Week Number</label>
                                      <input
                                        type="number"
                                        min={1}
                                        className="input"
                                        value={topicDraft.weekNumber}
                                        onChange={(event) =>
                                          setTopicDraft((previous) => ({
                                            ...previous,
                                            weekNumber: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="label text-xs">Session Date</label>
                                      <input
                                        type="date"
                                        className="input"
                                        value={topicDraft.sessionDate}
                                        onChange={(event) =>
                                          setTopicDraft((previous) => ({
                                            ...previous,
                                            sessionDate: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="label text-xs">Description / Content</label>
                                      <input
                                        type="text"
                                        className="input"
                                        value={topicDraft.description}
                                        onChange={(event) =>
                                          setTopicDraft((previous) => ({
                                            ...previous,
                                            description: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={handleUpdateTopic}
                                      className="btn-primary flex items-center gap-2 text-sm"
                                      disabled={!topicDraft.title.trim() || updateTopicMutation.isPending}
                                    >
                                      <Save size={14} />
                                      {updateTopicMutation.isPending ? 'Saving...' : 'Save changes'}
                                    </button>
                                    <button onClick={resetTopicEditor} className="btn-secondary text-sm">
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <h4 className="text-sm font-medium">Materials ({topicMaterials.length})</h4>
                                    {canModifyTopic(topic) && (
                                      <p className="mt-1 text-xs text-text-muted">
                                        Supported: {SUPPORTED_MATERIAL_LABEL}
                                      </p>
                                    )}
                                    {isEnrolledStudent && !canModifyTopic(topic) && (
                                      <p className="mt-1 text-xs text-text-muted">
                                        Use <span className="font-medium">Add Topic</span> for your own private topic, then
                                        upload. Tutor files are read-only here.
                                      </p>
                                    )}
                                  </div>

                                  {canModifyTopic(topic) && (
                                    <label className="btn-secondary inline-flex cursor-pointer items-center gap-2 text-xs">
                                      <Upload size={14} className="shrink-0" />
                                      Upload file{topicUploading.length > 1 ? 's' : ''}
                                      <input
                                        type="file"
                                        className="hidden"
                                        multiple
                                        accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.txt"
                                        onChange={(event) => handleMaterialFileSelection(topic.id, event)}
                                      />
                                    </label>
                                  )}
                                </div>

                                {fileFormatWarning?.topicId === topic.id && (
                                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                    <span className="shrink-0">⚠</span>
                                    <span>{fileFormatWarning.message}</span>
                                  </div>
                                )}
                              </div>

                              {topicUploading.length > 0 && (
                                <div className="space-y-2">
                                  {topicUploading.map((u) => (
                                    <div
                                      key={u.uploadKey}
                                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-main px-3 py-2 text-sm text-text-secondary"
                                    >
                                      {u.phase === 'uploading' ? (
                                        <>
                                          <Loader2
                                            size={16}
                                            className="shrink-0 animate-spin text-primary"
                                            aria-hidden
                                          />
                                          <span className="font-medium text-text-primary">Uploading…</span>
                                          <span className="truncate text-xs" title={u.fileName}>
                                            {u.fileName}
                                          </span>
                                        </>
                                      ) : (
                                        <>
                                          <span className="text-xs text-danger">
                                            {u.errorMessage ?? 'Upload failed'} — {u.fileName}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn-secondary py-1 text-xs"
                                            onClick={() => void retryMaterialUploadFromIdb(u.uploadKey)}
                                          >
                                            Retry
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {topicMaterials.length === 0 && topicUploading.length === 0 ? (
                                <p className="text-sm text-text-muted">No materials yet</p>
                              ) : topicMaterials.length > 0 ? (
                                <div className="space-y-2">
                                  {topicMaterials.map((material) => {
                                    const isEditingMaterial = editingMaterialId === material.id;
                                    const isLink = material.fileType === 'LINK';

                                    return (
                                      <div
                                        key={material.id}
                                        className="rounded-xl border border-border bg-white p-3 shadow-sm"
                                      >
                                        <div className="flex items-start gap-3">
                                          {isLink ? (
                                            <LinkIcon size={16} className="mt-1 shrink-0 text-primary" />
                                          ) : (
                                            <FileText size={16} className="mt-1 shrink-0 text-primary" />
                                          )}

                                          <div className="min-w-0 flex-1">
                                            {canModifyTopic(topic) && isEditingMaterial ? (
                                              <div className="space-y-3">
                                                <div>
                                                  <label className="label text-xs">Material title</label>
                                                  <input
                                                    type="text"
                                                    className="input"
                                                    value={materialDraft.title}
                                                    onChange={(event) =>
                                                      setMaterialDraft((previous) => ({
                                                        ...previous,
                                                        title: event.target.value,
                                                      }))
                                                    }
                                                  />
                                                </div>
                                                {isLink && (
                                                  <div>
                                                    <label className="label text-xs">Link URL</label>
                                                    <input
                                                      type="url"
                                                      className="input"
                                                      value={materialDraft.fileUrl}
                                                      onChange={(event) =>
                                                        setMaterialDraft((previous) => ({
                                                          ...previous,
                                                          fileUrl: event.target.value,
                                                        }))
                                                      }
                                                    />
                                                  </div>
                                                )}
                                                <div className="flex gap-2">
                                                  <button
                                                    onClick={() => handleUpdateMaterial(topic.id, material)}
                                                    className="btn-primary flex items-center gap-2 text-sm"
                                                    disabled={
                                                      !materialDraft.title.trim() || updateMaterialMutation.isPending
                                                    }
                                                  >
                                                    <Save size={14} />
                                                    {updateMaterialMutation.isPending ? 'Saving...' : 'Save'}
                                                  </button>
                                                  <button onClick={resetMaterialEditor} className="btn-secondary text-sm">
                                                    Cancel
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <a
                                                  href={material.fileUrl || '#'}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:underline"
                                                  onClick={(e) => openMaterialUrl(e, material)}
                                                  title={material.fileType === 'LINK' ? 'External link — opens in new tab' : 'Click to view file'}
                                                >
                                                  {material.title}
                                                  {material.fileType === 'LINK' && (
                                                    <ExternalLink size={11} className="shrink-0 opacity-60" />
                                                  )}
                                                </a>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                                                  <span>{getMaterialBadgeLabel(material)}</span>
                                                  {material.uploadedAt && (
                                                    <span>
                                                      {material.fileType === 'LINK' ? 'Linked' : 'Uploaded'}{' '}
                                                      {new Date(material.uploadedAt).toLocaleDateString()}
                                                    </span>
                                                  )}
                                                </div>
                                              </>
                                            )}
                                          </div>

                                          <div className="flex shrink-0 items-center gap-0.5">
                                            {!isEditingMaterial && (
                                              <Link
                                                to={`/ai-tutor?topicId=${topic.id}&courseId=${courseId}`}
                                                className="rounded p-1.5 text-primary hover:bg-primary-light"
                                                title="Study with AI"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <Bot size={14} />
                                              </Link>
                                            )}
                                            <span className="rounded-full bg-bg-main px-2 py-1 text-[11px] font-medium text-text-secondary">
                                              {getMaterialBadgeLabel(material)}
                                            </span>
                                            {canModifyTopic(topic) && !isEditingMaterial && (
                                              <button
                                                type="button"
                                                onClick={() => openMaterialEditor(topic.id, material)}
                                                className="rounded p-1.5 text-primary hover:bg-primary-light"
                                                title="Edit material"
                                              >
                                                <Pencil size={14} />
                                              </button>
                                            )}
                                            {canModifyTopic(topic) && !isEditingMaterial && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const confirmed = window.confirm(
                                                    `Delete "${material.title}" from this topic?`
                                                  );
                                                  if (confirmed) {
                                                    deleteMaterialMutation.mutate({
                                                      topicId: topic.id,
                                                      materialId: material.id,
                                                    });
                                                  }
                                                }}
                                                className="rounded p-1.5 text-danger hover:bg-red-50"
                                                title="Delete material"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isEnrolledStudent && !canManageCourse && course.todayAttendance && (
        <div className="mt-6">
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
              course.todayAttendance.isMarked
                ? course.todayAttendance.isPresent
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            <CalendarCheck size={18} className="shrink-0" />
            <div className="flex-1">
              <span className="font-medium">
                Today&apos;s class: {course.todayAttendance.startTime}–{course.todayAttendance.endTime}
                {course.todayAttendance.room ? ` · ${course.todayAttendance.room}` : ''}
              </span>
              <span className="ml-2 text-xs">
                {course.todayAttendance.isMarked
                  ? course.todayAttendance.isPresent
                    ? '✓ Recorded as attended'
                    : '✓ Recorded as absent'
                  : (
                    <>
                      {' '}
                      · Open{' '}
                      <Link to="/notifications" className="font-medium text-primary hover:underline">
                        Notifications
                      </Link>{' '}
                      after class (I attended, I missed, or class not held)
                    </>
                  )}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
