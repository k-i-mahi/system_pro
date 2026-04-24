import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

type Role = 'STUDENT' | 'MENTOR' | 'TUTOR' | 'ADMIN';

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

export default function AdminPanelPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'users' | 'communities'>('users');
  const [userSearch, setUserSearch] = useState('');
  const [communitySearch, setCommunitySearch] = useState('');

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
    },
    onError: () => toast.error('Failed to create user'),
  });

  const updateUserRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/admin/users/${userId}`, { role }),
    onSuccess: () => {
      toast.success('User updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to update user'),
  });
  const updateUser = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/users/${userId}`, payload),
    onSuccess: () => {
      toast.success('User profile updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: () => toast.error('Failed to update user'),
  });

  const deleteUser = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api.delete(`/admin/users/${userId}`, { params: { reason } }),
    onSuccess: () => {
      toast.success('User account deleted permanently');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: () => toast.error('Failed to delete user'),
  });

  const createCommunity = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/admin/communities', payload),
    onSuccess: () => {
      toast.success('Community created');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: () => toast.error('Failed to create community'),
  });
  const updateCommunity = useMutation({
    mutationFn: ({ communityId, payload }: { communityId: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/communities/${communityId}`, payload),
    onSuccess: () => {
      toast.success('Community updated');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: () => toast.error('Failed to update community'),
  });

  const deleteCommunity = useMutation({
    mutationFn: (communityId: string) => api.delete(`/admin/communities/${communityId}`),
    onSuccess: () => {
      toast.success('Community deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
    },
    onError: () => toast.error('Failed to delete community'),
  });

  const defaultUserPayload = useMemo(
    () => ({
      name: 'New User',
      email: '',
      password: 'Password123',
      universityName: 'University',
      role: 'STUDENT' as Role,
      rollNumber: '',
      session: '',
      department: '',
    }),
    []
  );

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/routine" replace />;
  }

  return (
    <div>
      <h1 className="page-title mb-6">Admin Panel</h1>
      <div className="mb-4 flex gap-2">
        <button className={`btn-secondary ${tab === 'users' ? 'ring-2 ring-primary' : ''}`} onClick={() => setTab('users')}>
          Manage Users
        </button>
        <button className={`btn-secondary ${tab === 'communities' ? 'ring-2 ring-primary' : ''}`} onClick={() => setTab('communities')}>
          Manage Communities
        </button>
      </div>

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
              onClick={() => {
                const email = prompt('Email for new user');
                if (!email) return;
                const name = prompt('Name', 'New User') || 'New User';
                const universityName = prompt('University', 'University') || 'University';
                createUser.mutate({ ...defaultUserPayload, email, name, universityName });
              }}
            >
              Create User
            </button>
          </div>
          {usersLoading ? (
            <p className="text-text-muted">Loading users...</p>
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
                          <option value="MENTOR">MENTOR</option>
                          <option value="TUTOR">TUTOR</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td className="py-2">{u.universityName}</td>
                      <td className="py-2">
                        <button
                          className="mr-3 text-primary hover:underline"
                          onClick={() => {
                            const name = prompt('Update name', u.name);
                            if (!name) return;
                            const universityName = prompt('Update university', u.universityName) || u.universityName;
                            updateUser.mutate({ userId: u.id, payload: { name, universityName } });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="text-danger hover:underline"
                          onClick={() => {
                            const reason = prompt('Reason for permanent deletion (misconduct proof)');
                            if (!reason) return;
                            const ok = confirm(
                              `Permanently delete ${u.name}'s account and all linked records? This cannot be undone.`
                            );
                            if (!ok) return;
                            deleteUser.mutate({ userId: u.id, reason });
                          }}
                        >
                          Delete Account
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
              onClick={() => {
                const name = prompt('Community name');
                if (!name) return;
                const courseCode = prompt('Course code', 'CSE0000') || 'CSE0000';
                const session = prompt('Session', '2022-23') || '2022-23';
                const department = prompt('Department', 'CSE') || 'CSE';
                const university = prompt('University', 'University') || 'University';
                createCommunity.mutate({
                  name,
                  courseCode,
                  session,
                  department,
                  university,
                  description: '',
                });
              }}
            >
              Create Community
            </button>
          </div>
          {communitiesLoading ? (
            <p className="text-text-muted">Loading communities...</p>
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
                      <td className="py-2">
                        <button
                          className="mr-3 text-primary hover:underline"
                          onClick={() => {
                            const name = prompt('Community name', c.name);
                            if (!name) return;
                            const courseCode = prompt('Course code', c.courseCode) || c.courseCode;
                            const session = prompt('Session', c.session) || c.session;
                            const department = prompt('Department', c.department) || c.department;
                            const university = prompt('University', c.university) || c.university;
                            const description = prompt('Description', c.description || '') || '';
                            updateCommunity.mutate({
                              communityId: c.id,
                              payload: { name, courseCode, session, department, university, description },
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="text-danger hover:underline"
                          onClick={() => {
                            const ok = confirm(`Delete community "${c.name}"?`);
                            if (!ok) return;
                            deleteCommunity.mutate(c.id);
                          }}
                        >
                          Delete Community
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
    </div>
  );
}
