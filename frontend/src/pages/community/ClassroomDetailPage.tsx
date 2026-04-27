import { useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Megaphone,
  Upload,
  ClipboardCheck,
  Users,
  Trash2,
  Plus,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { canManageClassroom } from '@/lib/rbac';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';

type Tab = 'announcements' | 'marks' | 'attendance' | 'members';

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author?: { name?: string };
};

type AttendanceRecord = {
  id: string;
  date: string;
  present: boolean;
  slot?: { dayOfWeek?: string; startTime?: string; endTime?: string };
  user?: { name?: string; rollNumber?: string | null };
};

type MyAttendance = {
  summary?: { percentage: number; total: number; present: number; absent: number };
  records?: AttendanceRecord[];
};

type CommunityMember = {
  id: string;
  role: 'STUDENT' | 'TUTOR' | string;
  user?: { id: string; name?: string; email?: string; rollNumber?: string | null };
};

export default function ClassroomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('announcements');

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', id],
    queryFn: () => api.get(`/community/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const isTutor =
    canManageClassroom(user, community) ||
    (community?.members ?? []).some((m: CommunityMember) => m.user?.id === user?.id && m.role === 'TUTOR');

  if (isLoading) return <div className="text-center py-12 text-text-muted">Loading...</div>;
  if (!community) return <div className="text-center py-12 text-text-muted">Community not found</div>;

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [{ key: 'announcements', label: 'Announcements', icon: Megaphone }];
  if (isTutor) {
    tabs.push({ key: 'marks', label: 'Marks', icon: FileSpreadsheet });
  }
  if (!isTutor) {
    tabs.push({ key: 'attendance', label: 'Attendance', icon: ClipboardCheck });
  }
  tabs.push({ key: 'members', label: 'Members', icon: Users });

  return (
    <div>
      <button
        onClick={() => navigate('/community')}
        className="flex items-center gap-2 text-text-secondary hover:text-primary mb-4"
      >
        <ArrowLeft size={16} /> Back to Community
      </button>

      <div className="card mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{community.name}</h1>
            {community.description && (
              <p className="text-sm text-text-secondary mt-1">{community.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="badge bg-primary-light text-primary">{community.courseCode}</span>
              <span className="badge bg-bg-main text-text-secondary">{community.session}</span>
              <span className="badge bg-bg-main text-text-secondary">{community.department}</span>
            </div>
          </div>
          <div className="text-right text-sm text-text-muted">
            <p>{community._count?.members} members</p>
            <p>{community.university}</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {community.course?.id && (
                <Link to={`/courses/${community.course.id}`} className="btn-secondary text-xs">
                  Open Course Workspace
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-bg-main'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'announcements' && <AnnouncementsTab communityId={id!} isTutor={isTutor} />}
      {tab === 'marks' && <MarksTab communityId={id!} isTutor={isTutor} />}
      {!isTutor && tab === 'attendance' && <AttendanceTab communityId={id!} />}
      {tab === 'members' && <MembersTab communityId={id!} isTutor={isTutor} members={community.members} />}
    </div>
  );
}

// ─── Announcements Tab ─────────────────────────────────────

function AnnouncementsTab({ communityId, isTutor }: { communityId: string; isTutor: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });

  const { data: announcements = [], isLoading: announcementsLoading } = useQuery<Announcement[]>({
    queryKey: ['announcements', communityId],
    queryFn: () => api.get(`/community/${communityId}/announcements`).then((r) => r.data.data),
  });

  const invalidateNotifs = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const createMutation = useMutation({
    mutationFn: () => api.post(`/community/${communityId}/announcements`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', communityId] });
      invalidateNotifs();
      setShowForm(false);
      setForm({ title: '', body: '' });
      toast.success('Announcement posted');
    },
    onError: () => toast.error('Failed to post announcement'),
  });

  const deleteMutation = useMutation({
    mutationFn: (annId: string) => api.delete(`/community/${communityId}/announcements/${annId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', communityId] });
      invalidateNotifs();
      toast.success('Announcement deleted');
    },
  });

  return (
    <div>
      {isTutor && (
        <div className="mb-4">
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> New Announcement
            </button>
          ) : (
            <div className="card">
              <h3 className="font-semibold mb-3">New Announcement</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  className="input"
                  placeholder="Title"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                />
                <textarea
                  className="input h-24 py-2"
                  placeholder="Announcement body..."
                  value={form.body}
                  onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => createMutation.mutate()}
                    className="btn-primary"
                    disabled={!form.title || !form.body || createMutation.isPending}
                  >
                    Post
                  </button>
                  <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {announcementsLoading ? (
        <div className="card text-center py-8 text-text-muted text-sm">Loading announcements…</div>
      ) : announcements.length === 0 ? (
        <div className="card text-center py-8">
          <Megaphone size={40} className="mx-auto text-text-muted mb-2" />
          <p className="text-text-secondary">No announcements yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="text-sm text-text-secondary mt-1">{a.body}</p>
                  <p className="text-xs text-text-muted mt-2">
                    {a.author?.name} • {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {isTutor && (
                  <button onClick={() => deleteMutation.mutate(a.id)} className="p-1.5 hover:bg-bg-main rounded">
                    <Trash2 size={14} className="text-danger" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Marks Tab ─────────────────────────────────────────────

function MarksTab({ communityId, isTutor }: { communityId: string; isTutor: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidateNotifs = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/community/${communityId}/marks/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['announcements', communityId] });
      invalidateNotifs();
      const { processed, updated, errors } = res.data.data;
      const errCount = Array.isArray(errors) ? errors.length : 0;
      toast.success(
        `Upload complete: ${updated} student(s) updated from ${processed} row(s).${
          errCount ? ` ${errCount} row note(s) — check API response if needed.` : ''
        }`,
      );
    },
    onError: () => toast.error('Upload failed'),
  });

  if (!isTutor) {
    return (
      <div className="card text-center py-8 text-text-secondary text-sm">
        Marks upload is available to classroom tutors only.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-primary flex items-center gap-2"
          disabled={uploadMutation.isPending}
        >
          <Upload size={16} />
          {uploadMutation.isPending ? 'Uploading...' : 'Upload marks file'}
        </button>
        <p className="text-xs text-text-muted max-w-xl">
          Spreadsheet: roll column plus <strong>CT1</strong> / <strong>CT2</strong> / <strong>CT3</strong> / <strong>Lab</strong>{' '}
          headers, or one <strong>marks</strong> column (counted as Class Test 1). <strong>.csv</strong> and{' '}
          <strong>.xlsx</strong> only — PDF is not extracted. Students are notified; official scores appear under My Scores.
        </p>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadMutation.mutate(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ─── Attendance Tab ────────────────────────────────────────

function AttendanceTab({ communityId }: { communityId: string }) {
  const { data: myAttendance } = useQuery<MyAttendance>({
    queryKey: ['my-attendance', communityId],
    queryFn: () => api.get(`/community/${communityId}/attendance/me`).then((r) => r.data.data),
  });

  const summary = myAttendance?.summary;
  return (
    <div>
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card text-center">
            <p className="text-2xl font-bold text-primary">{summary.percentage}%</p>
            <p className="text-xs text-text-muted">Attendance</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-xs text-text-muted">Total Classes</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-green-600">{summary.present}</p>
            <p className="text-xs text-text-muted">Present</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-red-500">{summary.absent}</p>
            <p className="text-xs text-text-muted">Absent</p>
          </div>
        </div>
      )}
      {myAttendance?.records?.length === 0 ? (
        <div className="card text-center py-8">
          <ClipboardCheck size={40} className="mx-auto text-text-muted mb-2" />
          <p className="text-text-secondary">No attendance records</p>
        </div>
      ) : (
        <div className="space-y-2">
          {myAttendance?.records?.map((r) => (
            <div key={r.id} className="card flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{r.slot?.dayOfWeek} {r.slot?.startTime}–{r.slot?.endTime}</p>
                <p className="text-xs text-text-muted">{new Date(r.date).toLocaleDateString()}</p>
              </div>
              {r.present ? (
                <span className="flex items-center gap-1 text-green-600"><CheckCircle size={14} /> Present</span>
              ) : (
                <span className="flex items-center gap-1 text-red-500"><XCircle size={14} /> Absent</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Members Tab ───────────────────────────────────────────

function MembersTab({ communityId, isTutor, members }: { communityId: string; isTutor: boolean; members: CommunityMember[] }) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/community/${communityId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community', communityId] });
      toast.success('Member removed');
    },
  });

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.id} className="card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium">
              {m.user?.name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="font-medium text-sm">{m.user?.name}</p>
              <p className="text-xs text-text-muted">{m.user?.email} {m.user?.rollNumber ? `• ${m.user.rollNumber}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge text-xs ${m.role === 'TUTOR' ? 'bg-primary-light text-primary' : 'bg-bg-main text-text-secondary'}`}>
              {m.role}
            </span>
            {isTutor && m.role !== 'TUTOR' && (
              <button
                onClick={() => m.user?.id && removeMutation.mutate(m.user.id)}
                disabled={!m.user?.id}
                className="p-1.5 hover:bg-bg-main rounded text-text-muted hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
