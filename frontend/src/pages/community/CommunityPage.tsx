import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, ThumbsUp, Plus, X, ChevronRight, School, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

type MainTab = 'threads' | 'classrooms';

export default function CommunityPage() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<MainTab>('classrooms');
  const [tab, setTab] = useState<'all' | 'my-courses'>('all');
  const [showNew, setShowNew] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [newThread, setNewThread] = useState({ title: '', body: '', tags: '' });
  const [replyContent, setReplyContent] = useState('');

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', tab],
    queryFn: () => api.get('/community/threads', { params: { tab } }).then((r) => r.data.data),
  });

  const { data: threadDetail } = useQuery({
    queryKey: ['thread', selectedThread],
    queryFn: () => api.get(`/community/threads/${selectedThread}`).then((r) => r.data.data),
    enabled: !!selectedThread,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/community/threads', {
        title: newThread.title,
        body: newThread.body,
        tags: newThread.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      setShowNew(false);
      setNewThread({ title: '', body: '', tags: '' });
      toast.success('Thread created');
    },
  });

  const replyMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/community/threads/${selectedThread}/posts`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', selectedThread] });
      setReplyContent('');
      toast.success('Reply posted');
    },
  });

  const likeMutation = useMutation({
    mutationFn: (threadId: string) => api.post(`/community/threads/${threadId}/like`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['thread', selectedThread] });
    },
  });

  if (selectedThread && threadDetail) {
    return (
      <div>
        <button
          onClick={() => setSelectedThread(null)}
          className="flex items-center gap-2 text-text-secondary hover:text-primary mb-4"
        >
          ← Back to threads
        </button>

        <div className="card mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium shrink-0">
              {threadDetail.creator?.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-semibold">{threadDetail.title}</h1>
              <p className="text-sm text-text-secondary mt-1">
                {threadDetail.creator?.name} •{' '}
                {formatDistanceToNow(new Date(threadDetail.createdAt), { addSuffix: true })}
              </p>
              {threadDetail.course && (
                <span className="badge bg-primary-light text-primary mt-2">
                  {threadDetail.course.courseCode}
                </span>
              )}
              <p className="mt-3 whitespace-pre-wrap text-text-primary">{threadDetail.body}</p>
              <div className="flex items-center gap-4 mt-3">
                <button
                  onClick={() => likeMutation.mutate(threadDetail.id)}
                  className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary"
                >
                  <ThumbsUp size={16} />
                  {threadDetail._count?.likes || 0}
                </button>
                <span className="flex items-center gap-1 text-sm text-text-secondary">
                  <MessageSquare size={16} />
                  {threadDetail._count?.posts || 0} replies
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Replies */}
        <div className="space-y-3 mb-4">
          {threadDetail.posts?.map((post: any) => (
            <div key={post.id} className="card">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-bg-main flex items-center justify-center text-text-secondary text-sm font-medium">
                  {post.author?.name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {post.author?.name}{' '}
                    <span className="text-text-muted font-normal">
                      • {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                    </span>
                  </p>
                  <p className="text-text-primary mt-1">{post.content}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reply input */}
        <div className="card">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (replyContent.trim()) replyMutation.mutate(replyContent);
            }}
            className="space-y-3"
          >
            <textarea
              className="input min-h-[90px] py-2"
              placeholder="Write your reply..."
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={!replyContent.trim() || replyMutation.isPending}>
              {replyMutation.isPending ? 'Posting...' : 'Reply'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">Community</h1>
        <div className="flex gap-2">
          {mainTab === 'threads' && (
            <button
              onClick={() => setShowNew(!showNew)}
              className="btn-primary flex items-center gap-2"
            >
              {showNew ? <X size={18} /> : <Plus size={18} />}
              {showNew ? 'Cancel' : 'Start Thread'}
            </button>
          )}
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 mb-4 border-b border-border pb-3">
        <button
          onClick={() => setMainTab('classrooms')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mainTab === 'classrooms' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-main'
          }`}
        >
          <School size={16} /> Classrooms
        </button>
        <button
          onClick={() => setMainTab('threads')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mainTab === 'threads' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-main'
          }`}
        >
          <MessageSquare size={16} /> Threads
        </button>
      </div>

      {mainTab === 'classrooms' && <ClassroomsSection />}

      {mainTab === 'threads' && (
        <>
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('all')}
          className={tab === 'all' ? 'btn-primary' : 'btn-secondary'}
        >
          All Threads
        </button>
        <button
          onClick={() => setTab('my-courses')}
          className={tab === 'my-courses' ? 'btn-primary' : 'btn-secondary'}
        >
          My Courses
        </button>
      </div>

      {/* New thread form */}
      {showNew && (
        <div className="card mb-4">
          <p className="text-sm text-text-secondary mb-3">
            Start a focused discussion. Keep title short, put details in the post body.
          </p>
          <div className="space-y-3">
            <input
              type="text"
              className="input"
              placeholder="Thread title"
              value={newThread.title}
              onChange={(e) => setNewThread((p) => ({ ...p, title: e.target.value }))}
            />
            <textarea
              className="input min-h-[110px] py-2"
              placeholder="Share context, question, and what you've tried..."
              value={newThread.body}
              onChange={(e) => setNewThread((p) => ({ ...p, body: e.target.value }))}
            />
            <input
              type="text"
              className="input"
              placeholder="Tags (comma separated)"
              value={newThread.tags}
              onChange={(e) => setNewThread((p) => ({ ...p, tags: e.target.value }))}
            />
            <button
              onClick={() => createMutation.mutate()}
              className="btn-primary"
              disabled={!newThread.title || !newThread.body || createMutation.isPending}
            >
              {createMutation.isPending ? 'Posting...' : 'Post Thread'}
            </button>
          </div>
        </div>
      )}

      {/* Thread list */}
      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Loading...</div>
      ) : threads.length === 0 ? (
        <div className="card text-center py-12">
          <MessageSquare size={48} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-secondary">No threads yet. Start the conversation!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread: any) => (
            <button
              key={thread.id}
              onClick={() => setSelectedThread(thread.id)}
              className="card w-full text-left hover:shadow-md transition-shadow flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium shrink-0">
                {thread.creator?.name?.charAt(0) || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{thread.title}</h3>
                <p className="text-sm text-text-secondary">
                  {thread.creator?.name} •{' '}
                  {formatDistanceToNow(new Date(thread.createdAt), { addSuffix: true })}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  {thread.course && (
                    <span className="badge bg-primary-light text-primary text-xs">
                      {thread.course.courseCode}
                    </span>
                  )}
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <ThumbsUp size={12} /> {thread._count?.likes || 0}
                  </span>
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <MessageSquare size={12} /> {thread._count?.posts || 0}
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-text-muted" />
            </button>
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

// ─── Classrooms Section ────────────────────────────────────

function ClassroomsSection() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [classroomTab, setClassroomTab] = useState<'my' | 'eligible'>('my');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', courseCode: '', session: '', department: '', university: '' });
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [joinForm, setJoinForm] = useState({ rollNumber: '', session: '', department: '' });

  const { data: communities = [], isLoading } = useQuery({
    queryKey: ['communities', classroomTab],
    queryFn: () => api.get(`/community?tab=${classroomTab}`).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/community', form),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setShowCreate(false);
      setForm({ name: '', description: '', courseCode: '', session: '', department: '', university: '' });
      toast.success('Classroom created');
      navigate(`/community/${res.data.data.id}`);
    },
    onError: () => toast.error('Failed to create classroom'),
  });

  const joinMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: typeof joinForm }) =>
      api.post(`/community/${id}/join`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setJoinTarget(null);
      setJoinForm({ rollNumber: '', session: '', department: '' });
      toast.success('Joined classroom');
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error?.message || 'Failed to join — details do not match'),
  });

  const isTutor = user?.role === 'TUTOR' || user?.role === 'ADMIN';

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setClassroomTab('my')}
          className={`px-3 py-1.5 rounded text-sm font-medium ${classroomTab === 'my' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-main'}`}
        >
          My Classrooms
        </button>
        <button
          onClick={() => setClassroomTab('eligible')}
          className={`px-3 py-1.5 rounded text-sm font-medium ${classroomTab === 'eligible' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-main'}`}
        >
          Available
        </button>
      </div>

      {/* Create Classroom Form */}
      {isTutor && showCreate && (
        <div className="card mb-4">
          <h3 className="font-semibold mb-3">Create Classroom</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="input" placeholder="Classroom name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <input className="input" placeholder="Course code" value={form.courseCode} onChange={(e) => setForm((p) => ({ ...p, courseCode: e.target.value }))} />
            <input className="input" placeholder="Session (e.g. 2024-25)" value={form.session} onChange={(e) => setForm((p) => ({ ...p, session: e.target.value }))} />
            <input className="input" placeholder="Department" value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} />
            <input className="input" placeholder="University" value={form.university} onChange={(e) => setForm((p) => ({ ...p, university: e.target.value }))} />
            <input className="input" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => createMutation.mutate()} className="btn-primary" disabled={!form.name || !form.courseCode || !form.session || !form.department || !form.university || createMutation.isPending}>
              Create
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}
      {isTutor && !showCreate && (
        <button onClick={() => setShowCreate(true)} className="btn-secondary flex items-center gap-2 mb-4">
          <Plus size={16} /> Create Classroom
        </button>
      )}

      {/* Community Cards */}
      {isLoading ? (
        <div className="text-center py-8 text-text-muted">Loading...</div>
      ) : communities.length === 0 ? (
        <div className="card text-center py-8">
          <School size={40} className="mx-auto text-text-muted mb-2" />
          <p className="text-text-secondary">{classroomTab === 'my' ? 'You haven\'t joined any classrooms yet' : 'No available classrooms'}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {communities.map((c: any) => (
            <div key={c.id} className="card hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/community/${c.id}`)}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  {c.description && <p className="text-sm text-text-secondary mt-1 line-clamp-2">{c.description}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="badge bg-primary-light text-primary text-xs">{c.courseCode}</span>
                    <span className="badge bg-bg-main text-text-muted text-xs">{c.session}</span>
                    <span className="badge bg-bg-main text-text-muted text-xs">{c.department}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-text-muted text-sm">
                  <Users size={14} /> {c._count?.members || 0}
                </div>
              </div>
              {classroomTab === 'eligible' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setJoinTarget(c.id); }}
                  className="btn-primary w-full mt-3 text-sm"
                >
                  Join Classroom
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Join Classroom Dialog ──────────────────────────── */}
      {joinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setJoinTarget(null)}>
          <div className="card w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-1">Join Classroom</h3>
            <p className="text-sm text-text-secondary mb-4">
              Enter your academic details. They must match the classroom's settings.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Roll Number</label>
                <input className="input" placeholder="e.g. 2301001" value={joinForm.rollNumber} onChange={(e) => setJoinForm((p) => ({ ...p, rollNumber: e.target.value }))} />
              </div>
              <div>
                <label className="label">Session</label>
                <input className="input" placeholder="e.g. 2023-2027" value={joinForm.session} onChange={(e) => setJoinForm((p) => ({ ...p, session: e.target.value }))} />
              </div>
              <div>
                <label className="label">Department</label>
                <input className="input" placeholder="e.g. Computer Science" value={joinForm.department} onChange={(e) => setJoinForm((p) => ({ ...p, department: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => joinMutation.mutate({ id: joinTarget, body: joinForm })}
                className="btn-primary flex-1"
                disabled={!joinForm.rollNumber || !joinForm.session || !joinForm.department || joinMutation.isPending}
              >
                {joinMutation.isPending ? 'Joining...' : 'Join'}
              </button>
              <button onClick={() => setJoinTarget(null)} className="btn-secondary flex-1">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
