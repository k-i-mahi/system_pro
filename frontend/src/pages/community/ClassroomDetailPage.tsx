import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

type CommunityScore = {
  userId: string;
  name: string;
  rollNumber?: string | null;
  ctScore1?: number | null;
  ctScore2?: number | null;
  ctScore3?: number | null;
  labScore?: number | null;
};

type MarkUploadHistory = {
  id: string;
  processedCount: number;
  errorCount: number;
  createdAt: string;
  fileUrl: string;
  uploader?: { name?: string };
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
    community?.createdBy === user?.id ||
    user?.role === 'ADMIN' ||
    (community?.members ?? []).some((m: CommunityMember) => m.user?.id === user?.id && m.role === 'TUTOR');

  if (isLoading) return <div className="text-center py-12 text-text-muted">Loading...</div>;
  if (!community) return <div className="text-center py-12 text-text-muted">Community not found</div>;

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
    { key: 'marks', label: 'Marks', icon: FileSpreadsheet },
    { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
    { key: 'members', label: 'Members', icon: Users },
  ];

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
      {tab === 'attendance' && <AttendanceTab communityId={id!} isTutor={isTutor} />}
      {tab === 'members' && <MembersTab communityId={id!} isTutor={isTutor} members={community.members} />}
    </div>
  );
}

// ─── Announcements Tab ─────────────────────────────────────

function AnnouncementsTab({ communityId, isTutor }: { communityId: string; isTutor: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });

  const { data: announcements = [] } = useQuery<Announcement[]>({
    queryKey: ['announcements', communityId],
    queryFn: () => api.get(`/community/${communityId}/announcements`).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/community/${communityId}/announcements`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', communityId] });
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

      {announcements.length === 0 ? (
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

  const { data: scores = [] } = useQuery<CommunityScore[]>({
    queryKey: ['community-scores', communityId],
    queryFn: () => api.get(`/community/${communityId}/marks/scores`).then((r) => r.data.data),
  });

  const { data: history = [] } = useQuery<MarkUploadHistory[]>({
    queryKey: ['marks-history', communityId],
    queryFn: () => api.get(`/community/${communityId}/marks/history`).then((r) => r.data.data),
    enabled: isTutor,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/community/${communityId}/marks/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['community-scores', communityId] });
      queryClient.invalidateQueries({ queryKey: ['marks-history', communityId] });
      const { processed, updated, errors } = res.data.data;
      toast.success(`Processed ${processed} rows, updated ${updated} students. ${errors.length} error(s).`);
    },
    onError: () => toast.error('Upload failed'),
  });

  return (
    <div>
      {isTutor && (
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-primary flex items-center gap-2"
            disabled={uploadMutation.isPending}
          >
            <Upload size={16} />
            {uploadMutation.isPending ? 'Uploading...' : 'Upload Spreadsheet'}
          </button>
          <span className="text-xs text-text-muted">CSV, XLSX, or XLS</span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {scores.length === 0 ? (
        <div className="card text-center py-8">
          <FileSpreadsheet size={40} className="mx-auto text-text-muted mb-2" />
          <p className="text-text-secondary">No scores recorded yet</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 font-medium text-text-secondary">Roll</th>
                <th className="pb-3 font-medium text-text-secondary">Name</th>
                <th className="pb-3 font-medium text-text-secondary">CT1</th>
                <th className="pb-3 font-medium text-text-secondary">CT2</th>
                <th className="pb-3 font-medium text-text-secondary">CT3</th>
                <th className="pb-3 font-medium text-text-secondary">Lab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scores.map((s) => (
                <tr key={s.userId}>
                  <td className="py-2 font-mono text-xs">{s.rollNumber || '–'}</td>
                  <td className="py-2">{s.name}</td>
                  <td className="py-2">{s.ctScore1 ?? '–'}</td>
                  <td className="py-2">{s.ctScore2 ?? '–'}</td>
                  <td className="py-2">{s.ctScore3 ?? '–'}</td>
                  <td className="py-2">{s.labScore ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isTutor && history.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold mb-3">Upload History</h3>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="card text-sm flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {h.processedCount} processed, {h.errorCount} errors
                  </p>
                  <p className="text-xs text-text-muted">
                    {h.uploader?.name} • {formatDistanceToNow(new Date(h.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <a href={h.fileUrl} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">
                  View file
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Attendance Tab ────────────────────────────────────────

function AttendanceTab({ communityId, isTutor }: { communityId: string; isTutor: boolean }) {
  // Student view
  const { data: myAttendance } = useQuery<MyAttendance>({
    queryKey: ['my-attendance', communityId],
    queryFn: () => api.get(`/community/${communityId}/attendance/me`).then((r) => r.data.data),
    enabled: !isTutor,
  });

  // Tutor view
  const { data: allAttendance = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['community-attendance', communityId],
    queryFn: () => api.get(`/community/${communityId}/attendance`).then((r) => r.data.data),
    enabled: isTutor,
  });

  if (!isTutor) {
    // Student attendance summary
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

  // Tutor view - show all attendance records
  return (
    <div>
      {allAttendance.length === 0 ? (
        <div className="card text-center py-8">
          <ClipboardCheck size={40} className="mx-auto text-text-muted mb-2" />
          <p className="text-text-secondary">No attendance records yet</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 font-medium text-text-secondary">Date</th>
                <th className="pb-3 font-medium text-text-secondary">Slot</th>
                <th className="pb-3 font-medium text-text-secondary">Student</th>
                <th className="pb-3 font-medium text-text-secondary">Roll</th>
                <th className="pb-3 font-medium text-text-secondary">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allAttendance.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="py-2">{r.slot?.startTime}–{r.slot?.endTime}</td>
                  <td className="py-2">{r.user?.name}</td>
                  <td className="py-2 font-mono text-xs">{r.user?.rollNumber || '–'}</td>
                  <td className="py-2">
                    {r.present ? (
                      <span className="text-green-600 flex items-center gap-1"><CheckCircle size={12} /> Present</span>
                    ) : (
                      <span className="text-red-500 flex items-center gap-1"><XCircle size={12} /> Absent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
