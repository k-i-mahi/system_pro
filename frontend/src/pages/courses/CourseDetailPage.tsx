import { Fragment, useState, useCallback, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
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
import toast from 'react-hot-toast';
import { canUploadMaterial } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';

type EnrollmentScores = {
  ctScore1?: number | null;
  ctScore2?: number | null;
  ctScore3?: number | null;
  labScore?: number | null;
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
  enrollment?: EnrollmentScores | null;
  topics?: TopicItem[];
  canManage?: boolean;
  isTeaching?: boolean;
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

type StudyLogDraft = {
  title: string;
  notes: string;
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

function isSupportedMaterialFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_MATERIAL_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function inferMaterialType(file: File): 'PDF' | 'IMAGE' | 'NOTE' {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.txt')) return 'NOTE';
  if (['.jpg', '.jpeg', '.png', '.webp'].some((extension) => lowerName.endsWith(extension))) return 'IMAGE';
  return 'PDF';
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
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const [uploadSuccessTopicId, setUploadSuccessTopicId] = useState<string | null>(null);
  const [fileFormatWarning, setFileFormatWarning] = useState<string | null>(null);

  // Student study-log state
  const [showStudyLogForm, setShowStudyLogForm] = useState(false);
  const [studyLogDraft, setStudyLogDraft] = useState<StudyLogDraft>({ title: '', notes: '' });

  const {
    data: course,
    isPending: courseQueryPending,
    isError: courseQueryError,
    error: courseQueryErr,
  } = useQuery<CourseDetail>({
    queryKey: ['course', courseId],
    queryFn: () => api.get(`/courses/${courseId}`).then((response) => response.data.data as CourseDetail),
    enabled: !!courseId,
    retry: (failCount, err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failCount < 2;
    },
  });
  const canManage = canManageByRole && Boolean(course?.canManage);

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

  // Student study-log: POST a personal topic → backend auto-marks attendance
  const addStudyLogMutation = useMutation({
    mutationFn: (data: { title: string; description?: string }) =>
      api.post(`/courses/${courseId}/topics`, {
        title: data.title,
        description: data.description || null,
        status: 'IN_PROGRESS',
      }),
    onSuccess: () => {
      invalidateCourseViews(true);
      setShowStudyLogForm(false);
      setStudyLogDraft({ title: '', notes: '' });
      toast.success('Topic logged! Attendance auto-marked if class is scheduled today.');
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, 'Failed to log topic.'));
    },
  });

  const uploadMaterialMutation = useMutation({
    mutationFn: ({ topicId, file }: { topicId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name);
      formData.append('fileType', inferMaterialType(file));

      return api.post(`/courses/${courseId}/topics/${topicId}/materials`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onMutate: ({ topicId }) => {
      setUploadingTopicId(topicId);
      setUploadSuccessTopicId(null);
    },
    onSuccess: (_, { topicId }) => {
      invalidateCourseViews(true);
      ensureExpanded(topicId);
      setUploadSuccessTopicId(topicId);
      setTimeout(() => setUploadSuccessTopicId(null), 4000);
    },
    onError: (err: any) => {
      toast.error(extractErrorMessage(err, `Supported formats: ${SUPPORTED_MATERIAL_LABEL}.`));
    },
    onSettled: () => {
      setUploadingTopicId(null);
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

    addTopicMutation.mutate(buildCreateTopicPayload(newTopic));
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
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!isSupportedMaterialFile(file)) {
      const ext = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : 'this format';
      setFileFormatWarning(`.${ext?.toLowerCase() ?? 'unknown'} files are not supported. Accepted: ${SUPPORTED_MATERIAL_LABEL}`);
      setTimeout(() => setFileFormatWarning(null), 6000);
      return;
    }

    setFileFormatWarning(null);
    uploadMaterialMutation.mutate({ topicId, file });
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
            <Link to={`/ai-tutor?courseId=${courseId}`} className="btn-secondary flex items-center gap-2 text-sm">
              <Bot size={16} />
              Study with AI
            </Link>
          </div>
        </div>
      </div>

      {!course.isTeaching && course.enrollment && (
        <div className="card mb-6">
          <h2 className="mb-4 text-lg font-semibold">My Scores</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">Assessment</th>
                  <th className="px-3 py-2 text-center font-medium text-text-secondary">Score</th>
                  <th className="px-3 py-2 text-center font-medium text-text-secondary">Max</th>
                  <th className="px-3 py-2 text-left font-medium text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Class Test 1', score: course.enrollment.ctScore1, max: 20 },
                  { label: 'Class Test 2', score: course.enrollment.ctScore2, max: 20 },
                  { label: 'Class Test 3', score: course.enrollment.ctScore3, max: 20 },
                  { label: 'Lab / Assignment', score: course.enrollment.labScore, max: 40 },
                ].map((row) => {
                  const percentage = row.score != null ? Math.round((row.score / row.max) * 100) : null;

                  return (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5 font-medium">{row.label}</td>
                      <td className="px-3 py-2.5 text-center">{row.score != null ? row.score : 'Not evaluated yet'}</td>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Course Schedule & Topics ({course.topics?.length || 0})</h2>
        {canManage && (
          <button
            onClick={() => setShowAddTopic((previous) => !previous)}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Plus size={16} />
            Add Topic
          </button>
        )}
      </div>

      {canManage && showAddTopic && (
        <div className="card mb-4">
          <h3 className="mb-3 text-sm font-semibold">New Topic</h3>
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
                    <p>No topics yet. Add your first topic to get started.</p>
                  </td>
                </tr>
              ) : (
                course.topics.map((topic, index) => {
                  const isExpanded = expandedTopicIds.includes(topic.id);
                  const topicMaterials = topic.materials ?? [];
                  const isUploadingHere = uploadingTopicId === topic.id;

                  return (
                    <Fragment key={topic.id}>
                      <tr
                        className="cursor-pointer border-b border-border transition-colors hover:bg-bg-main/50"
                        onClick={() => toggleTopicExpansion(topic.id)}
                      >
                        <td className="px-4 py-3 text-text-muted">{index + 1}</td>
                        <td className="px-4 py-3">{topic.weekNumber ? `W${topic.weekNumber}` : '-'}</td>
                        <td className="px-4 py-3 text-text-secondary">{formatTopicDate(topic.sessionDate)}</td>
                        <td className="px-4 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span>{topic.title}</span>
                          </div>
                        </td>
                        <td className="max-w-md px-4 py-3 text-text-secondary">
                          <span className="line-clamp-2">{topic.description || '-'}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
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
                            {canManage && (
                              <button
                                onClick={() => openTopicEditor(topic)}
                                className="rounded p-1.5 text-primary hover:bg-primary-light"
                                title="Edit topic"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {canManage && (
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
                          <td colSpan={7} className="p-4">
                            <div className="space-y-4">
                              {canManage && editingTopicId === topic.id && (
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
                                    {canManage && (
                                      <p className="mt-1 text-xs text-text-muted">
                                        Supported: {SUPPORTED_MATERIAL_LABEL}
                                      </p>
                                    )}
                                  </div>

                                  {canManage && (
                                    <label
                                      className={`btn-secondary inline-flex cursor-pointer items-center gap-2 text-xs ${
                                        isUploadingHere ? 'pointer-events-none opacity-80' : ''
                                      }`}
                                    >
                                      {isUploadingHere ? (
                                        <Loader2 size={14} className="animate-spin text-primary" />
                                      ) : (
                                        <Upload size={14} />
                                      )}
                                      {isUploadingHere ? 'Uploading…' : 'Upload File'}
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,.txt"
                                        disabled={isUploadingHere}
                                        onChange={(event) => handleMaterialFileSelection(topic.id, event)}
                                      />
                                    </label>
                                  )}
                                </div>

                                {fileFormatWarning && uploadingTopicId === null && (
                                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                    <span className="shrink-0">⚠</span>
                                    <span>{fileFormatWarning}</span>
                                  </div>
                                )}

                                {uploadSuccessTopicId === topic.id && (
                                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                                    <CheckCircle2 size={14} className="shrink-0 text-green-600" />
                                    <span>File uploaded successfully</span>
                                  </div>
                                )}
                              </div>

                              {topicMaterials.length === 0 ? (
                                <p className="text-sm text-text-muted">No materials yet</p>
                              ) : (
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
                                            {canManage && isEditingMaterial ? (
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

                                          <div className="flex shrink-0 items-center gap-1">
                                            <span className="rounded-full bg-bg-main px-2 py-1 text-[11px] font-medium text-text-secondary">
                                              {getMaterialBadgeLabel(material)}
                                            </span>
                                            {canManage && !isEditingMaterial && (
                                              <button
                                                onClick={() => openMaterialEditor(topic.id, material)}
                                                className="rounded p-1.5 text-primary hover:bg-primary-light"
                                                title="Edit material"
                                              >
                                                <Pencil size={14} />
                                              </button>
                                            )}
                                            {canManage && !isEditingMaterial && (
                                              <button
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
                              )}
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

      {/* ── Student Study Log ─────────────────────────────────────────────── */}
      {course.enrollment && !canManage && (
        <div className="mt-6">
          {/* Today's attendance status banner */}
          {course.todayAttendance && (
            <div
              className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                course.todayAttendance.isMarked
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <CalendarCheck size={18} className="shrink-0" />
              <div className="flex-1">
                <span className="font-medium">
                  Today's class: {course.todayAttendance.startTime}–{course.todayAttendance.endTime}
                  {course.todayAttendance.room ? ` · ${course.todayAttendance.room}` : ''}
                </span>
                <span className="ml-2 text-xs">
                  {course.todayAttendance.isMarked
                    ? course.todayAttendance.isPresent
                      ? '✓ Attendance marked as present'
                      : '✓ Attendance recorded'
                    : '· Log topics below to auto-mark attendance'}
                </span>
              </div>
            </div>
          )}

          {/* Study log header */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-primary" />
              <h2 className="text-lg font-semibold">My Study Log</h2>
              <span className="rounded-full bg-bg-main px-2 py-0.5 text-xs text-text-muted">
                {(course.topics?.filter((t: TopicItem) => t.isPersonal) || []).length} topics logged
              </span>
            </div>
            <button
              onClick={() => setShowStudyLogForm((prev) => !prev)}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Plus size={15} />
              Log Topic
            </button>
          </div>

          {/* Add study-log form */}
          {showStudyLogForm && (
            <div className="card mb-4 border-primary/20 bg-primary/5">
              <h3 className="mb-3 text-sm font-semibold text-primary">Log what you covered today</h3>
              <p className="mb-3 text-xs text-text-secondary">
                Logging a topic automatically marks your attendance if{' '}
                {course.courseCode ?? 'this course'} has a class scheduled today.
                Multiple topics in one session still count as{' '}
                <span className="font-medium">1 class attended</span>.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="label text-xs">Topic Title *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Mobile IP Protocol, Wireless Networking"
                    value={studyLogDraft.title}
                    onChange={(e) => setStudyLogDraft((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label text-xs">Notes (optional)</label>
                  <textarea
                    className="input min-h-[60px] py-2 text-sm"
                    placeholder="Any personal notes about today's class…"
                    value={studyLogDraft.notes}
                    onChange={(e) => setStudyLogDraft((prev) => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-sm"
                    disabled={!studyLogDraft.title.trim() || addStudyLogMutation.isPending}
                    onClick={() =>
                      addStudyLogMutation.mutate({
                        title: studyLogDraft.title.trim(),
                        description: studyLogDraft.notes.trim() || undefined,
                      })
                    }
                  >
                    {addStudyLogMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Logging…
                      </span>
                    ) : (
                      'Log & Mark Attendance'
                    )}
                  </button>
                  <button
                    className="btn-secondary text-sm"
                    onClick={() => {
                      setShowStudyLogForm(false);
                      setStudyLogDraft({ title: '', notes: '' });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Personal topics list */}
          {(() => {
            const personalTopics = (course.topics || []).filter((t: TopicItem) => t.isPersonal);
            if (personalTopics.length === 0) {
              return (
                <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-text-muted">
                  No topics logged yet. Log your first topic to start tracking attendance.
                </div>
              );
            }
            return (
              <div className="space-y-2">
                {personalTopics.map((t: TopicItem) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-bg-card px-4 py-3"
                  >
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary">{t.title}</p>
                      {t.description && (
                        <p className="mt-0.5 text-xs text-text-secondary">{t.description}</p>
                      )}
                      <p className="mt-1 text-xs text-text-muted">
                        {t.sessionDate
                          ? new Date(t.sessionDate).toLocaleDateString(undefined, {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : new Date(t.createdAt).toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
