import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Users, Shield, Building2, BarChart3 } from 'lucide-react';
import api from '@/lib/api';

type Role = 'STUDENT' | 'TUTOR' | 'ADMIN';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  universityName: string;
  role: Role;
  rollNumber?: string | null;
  session?: string | null;
  department?: string | null;
}

interface AdminCommunity {
  id: string;
  name: string;
  description?: string | null;
  courseCode: string;
  courseName: string;
  session: string;
  department: string;
  university: string;
}

// ─── Modals ────────────────────────────────────────────────

function UserModal({
  mode,
  initial,
  onClose,
  onSave,
  isPending,
}: {
  mode: 'create' | 'edit';
  initial?: AdminUser;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    role: (initial?.role ?? 'STUDENT') as Role,
    universityName: initial?.universityName ?? '',
    rollNumber: initial?.rollNumber ?? '',
    session: initial?.session ?? '',
    department: initial?.department ?? '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    if (mode === 'create' && !form.password.trim()) {
      toast.error('Password is required when creating a user');
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      role: form.role,
      universityName: form.universityName,
      rollNumber: form.rollNumber || undefined,
      session: form.session || undefined,
      department: form.department || undefined,
    };
    if (mode === 'create') payload.password = form.password;
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md space-y-4 relative">
        <button className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg">{mode === 'create' ? 'Create User' : 'Edit User'}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              disabled={mode === 'edit'}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          {mode === 'create' && (
            <div className="col-span-2">
              <label className="label">Password</label>
              <input className="input" type="text" value={form.password} onChange={(e) => set('password', e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="STUDENT">STUDENT</option>
              <option value="TUTOR">TUTOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div>
            <label className="label">University</label>
            <input className="input" value={form.universityName} onChange={(e) => set('universityName', e.target.value)} />
          </div>
          <div>
            <label className="label">Roll Number (optional)</label>
            <input className="input" value={form.rollNumber ?? ''} onChange={(e) => set('rollNumber', e.target.value)} />
          </div>
          <div>
            <label className="label">Session (optional)</label>
            <input className="input" placeholder="e.g. 2022-23" value={form.session ?? ''} onChange={(e) => set('session', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Department (optional)</label>
            <input className="input" value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommunityModal({
  mode,
  initial,
  onClose,
  onSave,
  isPending,
}: {
  mode: 'create' | 'edit';
  initial?: AdminCommunity;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    courseCode: initial?.courseCode ?? '',
    session: initial?.session ?? '',
    department: initial?.department ?? '',
    university: initial?.university ?? '',
    description: initial?.description ?? '',
    ownerUserId: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim() || !form.courseCode.trim()) {
      toast.error('Name and course code are required');
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name,
      courseCode: form.courseCode,
      session: form.session,
      department: form.department,
      university: form.university,
      description: form.description,
    };
    if (mode === 'create' && form.ownerUserId.trim()) {
      payload.ownerUserId = form.ownerUserId.trim();
    }
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md space-y-4 relative">
        <button className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg">{mode === 'create' ? 'Create Community' : 'Edit Community'}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Community Name</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Course Code</label>
            <input className="input" placeholder="e.g. CSE3101" value={form.courseCode} onChange={(e) => set('courseCode', e.target.value)} />
          </div>
          <div>
            <label className="label">Session</label>
            <input className="input" placeholder="e.g. 2022-23" value={form.session} onChange={(e) => set('session', e.target.value)} />
          </div>
          <div>
            <label className="label">Department</label>
            <input className="input" value={form.department} onChange={(e) => set('department', e.target.value)} />
          </div>
          <div>
            <label className="label">University</label>
            <input className="input" value={form.university} onChange={(e) => set('university', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Description</label>
            <textarea className="input min-h-[64px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          {mode === 'create' && (
            <div className="col-span-2">
              <label className="label">Tutor Owner User ID (optional)</label>
              <input
                className="input"
                placeholder="Leave blank to assign yourself"
                value={form.ownerUserId}
                onChange={(e) => set('ownerUserId', e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  target,
  onClose,
  onConfirm,
  isPending,
}: {
  target: { type: 'user' | 'community'; name: string };
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm space-y-4 relative">
        <button className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg text-danger">
          {target.type === 'user' ? 'Delete Account' : 'Delete Community'}
        </h2>
        <p className="text-sm text-text-secondary">
          Permanently delete <span className="font-medium text-text-primary">"{target.name}"</span>?
          This cannot be undone.
        </p>
        {target.type === 'user' && (
          <div>
            <label className="label">Reason (misconduct proof)</label>
            <input
              className="input"
              placeholder="Required for user deletion"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary bg-danger hover:bg-danger/90 border-danger"
            disabled={isPending || (target.type === 'user' && !reason.trim())}
            onClick={() => onConfirm(reason || undefined)}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────

interface PlatformStats {
  roleCounts: Record<string, number>;
  totalCommunities: number;
  recentRegistrations: { name: string; email: string; role: string; joinedAt: string }[];
}

function OverviewTab() {
  const { data: stats, isLoading } = useQuery<PlatformStats>({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then((r) => r.data.data),
  });

  if (isLoading) return <p className="text-text-muted">Loading stats…</p>;
  if (!stats) return null;

  const statCards = [
    { label: 'Students', value: stats.roleCounts['STUDENT'] ?? 0, icon: Users, color: 'text-primary' },
    { label: 'Tutors', value: stats.roleCounts['TUTOR'] ?? 0, icon: Shield, color: 'text-amber-600' },
    { label: 'Admins', value: stats.roleCounts['ADMIN'] ?? 0, icon: BarChart3, color: 'text-red-500' },
    { label: 'Communities', value: stats.totalCommunities, icon: Building2, color: 'text-green-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="card text-center">
            <s.icon size={22} className={`mx-auto mb-1 ${s.color}`} />
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-text-secondary mb-2">Recent Registrations</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.recentRegistrations.map((r, i) => (
                <tr key={i}>
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-text-secondary">{r.email}</td>
                  <td className="py-2">
                    <span className="badge bg-bg-main text-text-secondary">{r.role}</span>
                  </td>
                  <td className="py-2 text-text-muted text-xs">
                    {new Date(r.joinedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function AdminPanelPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'users' | 'communities'>('overview');
  const [userSearch, setUserSearch] = useState('');
  const [communitySearch, setCommunitySearch] = useState('');

  // Modal state
  const [userModal, setUserModal] = useState<{ open: boolean; mode: 'create' | 'edit'; user?: AdminUser }>({
    open: false,
    mode: 'create',
  });
  const [communityModal, setCommunityModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    community?: AdminCommunity;
  }>({ open: false, mode: 'create' });
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'user' | 'community'; id: string; name: string } | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users', userSearch],
    queryFn: async () => {
      const res = await api.get('/admin/users', { params: { search: userSearch || undefined, limit: 200 } });
      return (res.data.data ?? []) as AdminUser[];
    },
    enabled: tab === 'users',
  });

  const { data: communities = [], isLoading: communitiesLoading } = useQuery({
    queryKey: ['admin-communities', communitySearch],
    queryFn: async () => {
      const res = await api.get('/admin/communities', { params: { search: communitySearch || undefined, limit: 200 } });
      return (res.data.data ?? []) as AdminCommunity[];
    },
    enabled: tab === 'communities',
  });

  const createUser = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/admin/users', payload),
    onSuccess: () => {
      toast.success('User created');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setUserModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to create user'),
  });

  const updateUser = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/users/${userId}`, payload),
    onSuccess: () => {
      toast.success('User updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setUserModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to update user'),
  });

  const updateUserRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/admin/users/${userId}`, { role }),
    onSuccess: () => {
      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to update role'),
  });

  const deleteUser = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      api.delete(`/admin/users/${userId}`, { params: { reason } }),
    onSuccess: () => {
      toast.success('User account deleted permanently');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to delete user'),
  });

  const createCommunity = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/admin/communities', payload),
    onSuccess: () => {
      toast.success('Community created');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setCommunityModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to create community'),
  });

  const updateCommunity = useMutation({
    mutationFn: ({ communityId, payload }: { communityId: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/communities/${communityId}`, payload),
    onSuccess: () => {
      toast.success('Community updated');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setCommunityModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to update community'),
  });

  const deleteCommunity = useMutation({
    mutationFn: (communityId: string) => api.delete(`/admin/communities/${communityId}`),
    onSuccess: () => {
      toast.success('Community deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to delete community'),
  });

  function handleUserSave(payload: Record<string, unknown>) {
    if (userModal.mode === 'create') {
      createUser.mutate(payload);
    } else if (userModal.user) {
      updateUser.mutate({ userId: userModal.user.id, payload });
    }
  }

  function handleCommunitySave(payload: Record<string, unknown>) {
    if (communityModal.mode === 'create') {
      createCommunity.mutate(payload);
    } else if (communityModal.community) {
      updateCommunity.mutate({ communityId: communityModal.community.id, payload });
    }
  }

  function handleDeleteConfirm(reason?: string) {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'user') {
      deleteUser.mutate({ userId: deleteTarget.id, reason });
    } else {
      deleteCommunity.mutate(deleteTarget.id);
    }
  }

  const isUserPending = createUser.isPending || updateUser.isPending;
  const isCommunityPending = createCommunity.isPending || updateCommunity.isPending;
  const isDeletePending = deleteUser.isPending || deleteCommunity.isPending;

  return (
    <div>
      <h1 className="page-title mb-6">Admin Panel</h1>
      <div className="mb-4 flex gap-2 flex-wrap">
        <button className={`btn-secondary ${tab === 'overview' ? 'ring-2 ring-primary' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={`btn-secondary ${tab === 'users' ? 'ring-2 ring-primary' : ''}`} onClick={() => setTab('users')}>
          Manage Users
        </button>
        <button className={`btn-secondary ${tab === 'communities' ? 'ring-2 ring-primary' : ''}`} onClick={() => setTab('communities')}>
          Manage Communities
        </button>
      </div>

      {tab === 'overview' && <OverviewTab />}

      {tab === 'users' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <input
              className="input max-w-md"
              placeholder="Search users by name/email/university"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={() => setUserModal({ open: true, mode: 'create' })}
            >
              Create User
            </button>
          </div>
          {usersLoading ? (
            <p className="text-text-muted">Loading users…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary">
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Email</th>
                    <th className="pb-2">Role</th>
                    <th className="pb-2">University</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="py-2">{u.name}</td>
                      <td className="py-2">{u.email}</td>
                      <td className="py-2">
                        <select
                          className="input h-9 py-0"
                          value={u.role}
                          onChange={(e) => updateUserRole.mutate({ userId: u.id, role: e.target.value as Role })}
                        >
                          <option value="STUDENT">STUDENT</option>
                          <option value="TUTOR">TUTOR</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td className="py-2">{u.universityName}</td>
                      <td className="py-2 flex gap-3">
                        <button
                          className="text-primary hover:underline"
                          onClick={() => setUserModal({ open: true, mode: 'edit', user: u })}
                        >
                          Edit
                        </button>
                        <button
                          className="text-danger hover:underline"
                          onClick={() => setDeleteTarget({ type: 'user', id: u.id, name: u.name })}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'communities' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <input
              className="input max-w-md"
              placeholder="Search communities by name/course/university"
              value={communitySearch}
              onChange={(e) => setCommunitySearch(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={() => setCommunityModal({ open: true, mode: 'create' })}
            >
              Create Community
            </button>
          </div>
          {communitiesLoading ? (
            <p className="text-text-muted">Loading communities…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary">
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Course</th>
                    <th className="pb-2">Session</th>
                    <th className="pb-2">Department</th>
                    <th className="pb-2">University</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {communities.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="py-2">{c.name}</td>
                      <td className="py-2">{c.courseCode}</td>
                      <td className="py-2">{c.session}</td>
                      <td className="py-2">{c.department}</td>
                      <td className="py-2">{c.university}</td>
                      <td className="py-2 flex gap-3">
                        <button
                          className="text-primary hover:underline"
                          onClick={() => setCommunityModal({ open: true, mode: 'edit', community: c })}
                        >
                          Edit
                        </button>
                        <button
                          className="text-danger hover:underline"
                          onClick={() => setDeleteTarget({ type: 'community', id: c.id, name: c.name })}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {userModal.open && (
        <UserModal
          mode={userModal.mode}
          initial={userModal.user}
          onClose={() => setUserModal({ open: false, mode: 'create' })}
          onSave={handleUserSave}
          isPending={isUserPending}
        />
      )}
      {communityModal.open && (
        <CommunityModal
          mode={communityModal.mode}
          initial={communityModal.community}
          onClose={() => setCommunityModal({ open: false, mode: 'create' })}
          onSave={handleCommunitySave}
          isPending={isCommunityPending}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
          isPending={isDeletePending}
        />
      )}
    </div>
  );
}
