import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, FileText, Link as LinkIcon, Trash2, Upload,
  ChevronDown, ChevronRight, Bot, BookOpen,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  NOT_STARTED: { text: 'Not Started', color: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { text: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  DONE: { text: 'Completed', color: 'bg-green-100 text-green-700' },
};

export default function CourseDetailPage() {
  const { courseId } = useParams();
  const queryClient = useQueryClient();
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopic, setNewTopic] = useState({
    title: '',
    description: '',
    weekNumber: '',
    sessionDate: '',
  });

  const { data: course, isLoading } = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api.get(`/courses/${courseId}`).then((r) => r.data.data),
  });

  const addTopicMutation = useMutation({
    mutationFn: (data: any) =>
      api.post(`/courses/${courseId}/topics`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
      setShowAddTopic(false);
      setNewTopic({ title: '', description: '', weekNumber: '', sessionDate: '' });
      toast.success('Topic added');
    },
  });

  const deleteTopicMutation = useMutation({
    mutationFn: (topicId: string) =>
      api.delete(`/courses/${courseId}/topics/${topicId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
      toast.success('Topic deleted');
    },
  });

  const uploadMaterialMutation = useMutation({
    mutationFn: ({ topicId, file }: { topicId: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      return api.post(`/courses/${courseId}/topics/${topicId}/materials`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
      toast.success('Material uploaded');
    },
  });

  function handleAddTopic() {
    if (!newTopic.title.trim()) return;
    const data: any = { title: newTopic.title };
    if (newTopic.description) data.description = newTopic.description;
    if (newTopic.weekNumber) data.weekNumber = parseInt(newTopic.weekNumber);
    if (newTopic.sessionDate) data.sessionDate = new Date(newTopic.sessionDate).toISOString();
    addTopicMutation.mutate(data);
  }

  if (isLoading) return <div className="text-center py-12 text-text-muted">Loading...</div>;
  if (!course) return <div className="text-center py-12 text-text-muted">Course not found</div>;

  return (
    <div>
      <Link to="/courses" className="flex items-center gap-2 text-text-secondary hover:text-primary mb-4">
        <ArrowLeft size={18} />
        Back to Courses
      </Link>

      {/* Course Header */}
      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="badge bg-primary-light text-primary mb-2 font-mono">{course.courseCode}</span>
            <h1 className="page-title">{course.courseName}</h1>
          </div>
          <Link
            to={`/ai-tutor?courseId=${courseId}`}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Bot size={16} />
            Study with AI
          </Link>
        </div>
      </div>

      {/* Scores Table */}
      {course.enrollment && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-4">My Scores</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-text-secondary">Assessment</th>
                  <th className="text-center py-2 px-3 font-medium text-text-secondary">Score</th>
                  <th className="text-center py-2 px-3 font-medium text-text-secondary">Max</th>
                  <th className="text-left py-2 px-3 font-medium text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Class Test 1', score: course.enrollment.ctScore1, max: 20 },
                  { label: 'Class Test 2', score: course.enrollment.ctScore2, max: 20 },
                  { label: 'Class Test 3', score: course.enrollment.ctScore3, max: 20 },
                  { label: 'Lab / Assignment', score: course.enrollment.labScore, max: 40 },
                ].map((row) => {
                  const pct = row.score != null ? Math.round((row.score / row.max) * 100) : null;
                  return (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="py-2.5 px-3 font-medium">{row.label}</td>
                      <td className="py-2.5 px-3 text-center">
                        {row.score != null ? row.score : '–'}
                      </td>
                      <td className="py-2.5 px-3 text-center text-text-muted">{row.max}</td>
                      <td className="py-2.5 px-3">
                        {pct != null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-bg-main rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct >= 60 ? 'bg-accent' : pct >= 40 ? 'bg-warning' : 'bg-danger'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-text-muted">{pct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">Not graded</span>
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

      {/* Topics Spreadsheet */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Course Schedule & Topics ({course.topics?.length || 0})
        </h2>
        <button
          onClick={() => setShowAddTopic(!showAddTopic)}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          Add Topic
        </button>
      </div>

      {showAddTopic && (
        <div className="card mb-4">
          <h3 className="text-sm font-semibold mb-3">New Topic</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="label text-xs">Title *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Introduction to Data Structures"
                value={newTopic.title}
                onChange={(e) => setNewTopic({ ...newTopic, title: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Week Number</label>
              <input
                type="number"
                className="input"
                placeholder="e.g. 1"
                value={newTopic.weekNumber}
                onChange={(e) => setNewTopic({ ...newTopic, weekNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Session Date</label>
              <input
                type="date"
                className="input"
                value={newTopic.sessionDate}
                onChange={(e) => setNewTopic({ ...newTopic, sessionDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Description / Content</label>
              <input
                type="text"
                className="input"
                placeholder="Brief description of topic content"
                value={newTopic.description}
                onChange={(e) => setNewTopic({ ...newTopic, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddTopic}
              className="btn-primary text-sm"
              disabled={!newTopic.title.trim()}
            >
              Add Topic
            </button>
            <button onClick={() => setShowAddTopic(false)} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Spreadsheet Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-main border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-text-secondary w-12">#</th>
                <th className="text-left py-3 px-4 font-medium text-text-secondary w-16">Week</th>
                <th className="text-left py-3 px-4 font-medium text-text-secondary w-28">Date</th>
                <th className="text-left py-3 px-4 font-medium text-text-secondary">Topic</th>
                <th className="text-left py-3 px-4 font-medium text-text-secondary">Content</th>
                <th className="text-center py-3 px-4 font-medium text-text-secondary w-28">Status</th>
                <th className="text-center py-3 px-4 font-medium text-text-secondary w-24">Mastery</th>
                <th className="text-center py-3 px-4 font-medium text-text-secondary w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!course.topics || course.topics.length === 0) ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-text-muted">
                    <BookOpen size={32} className="mx-auto mb-2" />
                    <p>No topics yet. Add your first topic to get started.</p>
                  </td>
                </tr>
              ) : (
                course.topics.map((topic: any, index: number) => {
                  const isExpanded = expandedTopic === topic.id;
                  const progress = topic.topicProgress?.[0];
                  const mastery = progress ? Math.round(progress.expertiseLevel * 100) : 0;
                  const status = STATUS_LABELS[topic.status] || STATUS_LABELS.NOT_STARTED;

                  return (
                    <>
                      <tr
                        key={topic.id}
                        className="border-b border-border hover:bg-bg-main/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedTopic(isExpanded ? null : topic.id)}
                      >
                        <td className="py-3 px-4 text-text-muted">{index + 1}</td>
                        <td className="py-3 px-4">
                          {topic.weekNumber ? `W${topic.weekNumber}` : '–'}
                        </td>
                        <td className="py-3 px-4 text-text-secondary">
                          {topic.sessionDate
                            ? new Date(topic.sessionDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })
                            : '–'}
                        </td>
                        <td className="py-3 px-4 font-medium">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {topic.title}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-text-secondary max-w-xs truncate">
                          {topic.description || '–'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                            {status.text}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-12 h-1.5 bg-bg-main rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${mastery >= 70 ? 'bg-accent' : mastery >= 40 ? 'bg-warning' : 'bg-danger'}`}
                                style={{ width: `${mastery}%` }}
                              />
                            </div>
                            <span className="text-xs text-text-muted">{mastery}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              to={`/ai-tutor?topicId=${topic.id}&courseId=${courseId}`}
                              className="p-1.5 rounded hover:bg-primary-light text-primary"
                              title="Study with AI"
                            >
                              <Bot size={14} />
                            </Link>
                            <Link
                              to={`/ai-tutor?topicId=${topic.id}&courseId=${courseId}&mode=exam`}
                              className="p-1.5 rounded hover:bg-primary-light text-primary"
                              title="Take Exam"
                            >
                              <FileText size={14} />
                            </Link>
                            <button
                              onClick={() => deleteTopicMutation.mutate(topic.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-danger"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Materials Row */}
                      {isExpanded && (
                        <tr key={`${topic.id}-expanded`} className="bg-bg-main/30">
                          <td colSpan={8} className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-medium">
                                Materials ({topic.materials?.length || 0})
                              </h4>
                              <label className="btn-secondary text-xs flex items-center gap-1 cursor-pointer">
                                <Upload size={14} />
                                Upload
                                <input
                                  type="file"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file)
                                      uploadMaterialMutation.mutate({ topicId: topic.id, file });
                                  }}
                                />
                              </label>
                            </div>

                            {topic.materials?.length === 0 ? (
                              <p className="text-sm text-text-muted">No materials yet</p>
                            ) : (
                              <div className="space-y-1">
                                {topic.materials?.map((mat: any) => (
                                  <div
                                    key={mat.id}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white"
                                  >
                                    {mat.fileType === 'LINK' ? (
                                      <LinkIcon size={14} className="text-primary" />
                                    ) : (
                                      <FileText size={14} className="text-primary" />
                                    )}
                                    <a
                                      href={mat.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex-1 text-sm text-primary hover:underline"
                                    >
                                      {mat.title}
                                    </a>
                                    <span className="text-xs text-text-muted">{mat.fileType}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
