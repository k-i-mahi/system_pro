import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { canUploadMaterial } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';
import {
  AskCoursePane,
  ChatPane,
  MaterialPreviewPane,
  ModeSwitcher,
  QuizPane,
  ResourceSuggestPane,
  type Citation,
  type TutorMode,
} from '@/components/ai-tutor';
import { normalizeTutorMode } from '@/lib/tutor-mode';

interface CourseListItem {
  id: string;
  courseCode: string;
  courseName: string;
}

interface MaterialRow {
  id: string;
  title: string;
  topicId?: string;
  fileType?: string;
  hasEmbeddings?: boolean;
  ingestStatus?: string;
  chunkCount?: number;
  ingestError?: string | null;
}

interface Topic {
  id: string;
  title: string;
  materials?: MaterialRow[];
}

interface CourseDetail {
  id: string;
  topics?: Topic[];
  enrollment?: { id?: string } | null;
}

const CHAT_QUICK_ACTIONS = [
  { label: 'Explain this topic', prompt: 'Explain this topic in detail with examples.' },
  { label: 'Key concepts', prompt: 'What are the key concepts I should know for this topic?' },
  { label: 'Practice problem', prompt: 'Give me one practice problem at my current level.' },
  { label: 'I\'m confused', prompt: 'I don\'t understand this topic. Can you help me figure out where I\'m stuck?' },
];

export default function AITutorPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const initialTopicId = searchParams.get('topicId') || '';
  const initialCourseId = searchParams.get('courseId') || '';
  const initialMode = normalizeTutorMode(searchParams.get('mode'));
  const initialPrompt = searchParams.get('prompt') || '';

  const [mode, setMode] = useState<TutorMode>(initialMode);
  const [selectedCourse, setSelectedCourse] = useState(initialCourseId);
  const [selectedTopic, setSelectedTopic] = useState(initialTopicId);
  const [prefillPrompt, setPrefillPrompt] = useState(initialPrompt);
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);

  const { data: myCourses = [] } = useQuery({
    queryKey: ['my-courses'],
    queryFn: () =>
      api.get('/courses/my-courses').then((r) => r.data.data as CourseListItem[]),
  });

  const { data: courseDetail, isPending: courseDetailLoading } = useQuery({
    queryKey: ['course', selectedCourse],
    queryFn: () =>
      api
        .get(`/courses/${selectedCourse}`)
        .then((r) => r.data.data as CourseDetail),
    enabled: !!selectedCourse,
    refetchInterval: (query) => {
      const data = query.state.data as CourseDetail | undefined;
      const topics = data?.topics ?? [];
      const mats = selectedTopic
        ? (topics.find((t) => t.id === selectedTopic)?.materials ?? [])
        : topics.flatMap((t) => t.materials ?? []);
      const ingesting = mats.some(
        (m) =>
          m.fileType !== 'LINK' &&
          (m.ingestStatus === 'PENDING' || m.ingestStatus === 'PROCESSING')
      );
      return mode === 'ask-course' && !!selectedCourse && ingesting ? 3000 : false;
    },
  });

  const selectedTopicObj = useMemo(
    () => courseDetail?.topics?.find((t) => t.id === selectedTopic),
    [courseDetail, selectedTopic]
  );

  const tutorSessionKey = useMemo(
    () => `${selectedCourse || 'none'}:${selectedTopic || 'all'}`,
    [selectedCourse, selectedTopic]
  );

  const canAddTopicsOnCoursePage = useMemo(
    () =>
      canUploadMaterial(user) || (user?.role === 'STUDENT' && Boolean(courseDetail?.enrollment)),
    [user, courseDetail?.enrollment]
  );

  /** All indexed-file rows for Ask Course: one topic, or de-duplicated across course when "All topics". */
  const askCourseMaterials = useMemo(() => {
    if (!courseDetail?.topics?.length) return undefined;
    if (selectedTopic) {
      return selectedTopicObj?.materials;
    }
    const byId = new Map<string, MaterialRow>();
    for (const t of courseDetail.topics) {
      for (const m of t.materials ?? []) {
        if (!byId.has(m.id)) byId.set(m.id, m);
      }
    }
    return [...byId.values()];
  }, [courseDetail, selectedTopic, selectedTopicObj?.materials]);

  useEffect(() => {
    setSelectedCourse(searchParams.get('courseId') || '');
    setSelectedTopic(searchParams.get('topicId') || '');
    setMode(normalizeTutorMode(searchParams.get('mode')));
    setPrefillPrompt(searchParams.get('prompt') || '');
    setPreviewCitation(null);
  }, [searchParams]);

  const showPreview = mode === 'ask-course' && !!previewCitation;

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <aside className="w-64 shrink-0 space-y-4 overflow-y-auto">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Context</h3>
          <div className="space-y-3">
            <div>
              <label className="label text-xs">Course</label>
              <select
                className="input text-sm"
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value);
                  setSelectedTopic('');
                  setPreviewCitation(null);
                }}
              >
                <option value="">General</option>
                {myCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.courseCode} — {c.courseName}
                  </option>
                ))}
              </select>
            </div>
            {!!selectedCourse && (
              <div>
                <label className="label text-xs">Topic</label>
                {courseDetailLoading ? (
                  <p className="text-xs text-text-muted">Loading topics…</p>
                ) : courseDetail?.topics && courseDetail.topics.length > 0 ? (
                  <select
                    className="input text-sm"
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                  >
                    <option value="">All topics</option>
                    {courseDetail.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs leading-relaxed text-text-secondary">
                    No week topics in this course yet, so Ask Course searches all course materials when you upload them.{' '}
                    {canAddTopicsOnCoursePage ? (
                      <Link
                        to={`/courses/${selectedCourse}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Add topics on the course page
                      </Link>
                    ) : (
                      'Ask your instructor to add week topics and upload materials there.'
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card text-xs text-text-secondary">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Modes</h3>
          <ul className="space-y-2">
            <li><strong className="text-text-primary">Chat:</strong> agentic tutor with tools (search, code, diagram).</li>
            <li><strong className="text-text-primary">Ask Course:</strong> grounded answers with citations.</li>
            <li><strong className="text-text-primary">Quiz:</strong> adaptive MCQ practice.</li>
            <li><strong className="text-text-primary">Resources:</strong> discover videos, reading, and blogs from the web.</li>
          </ul>
        </div>
      </aside>

      <div className="flex flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <ModeSwitcher value={mode} onChange={setMode} />
          {selectedTopicObj && (
            <span className="text-sm text-text-secondary">
              Topic: <span className="font-medium text-text-primary">{selectedTopicObj.title}</span>
            </span>
          )}
        </div>

        <div className="flex flex-1 gap-3 overflow-hidden">
          <div className="card flex flex-1 flex-col overflow-hidden p-0">
            {mode === 'chat' && (
              <ChatPane
                persistenceKey={`${tutorSessionKey}:chat`}
                topicId={selectedTopic || undefined}
                courseId={selectedCourse || undefined}
                quickActions={CHAT_QUICK_ACTIONS}
                initialPrompt={prefillPrompt || undefined}
              />
            )}
            {mode === 'ask-course' && (
              <AskCoursePane
                persistenceKey={`${tutorSessionKey}:ask`}
                courseId={selectedCourse || undefined}
                topicId={selectedTopic || undefined}
                materials={askCourseMaterials}
                onCitationClick={setPreviewCitation}
              />
            )}
            {mode === 'quiz' && (
              <QuizPane topicId={selectedTopic} topicTitle={selectedTopicObj?.title} />
            )}
            {mode === 'resources' && (
              <ResourceSuggestPane topicTitle={selectedTopicObj?.title} />
            )}
          </div>

          {showPreview && (
            <div className="hidden w-2/5 flex-col lg:flex">
              <MaterialPreviewPane
                citation={previewCitation}
                onClose={() => setPreviewCitation(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
