import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { UserModal, DeleteConfirmModal, type AdminUser } from './AdminModals';

type Role = 'STUDENT' | 'TUTOR' | 'ADMIN';

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState('');
  const [userModal, setUserModal] = useState<{ open: boolean; mode: 'create' | 'edit'; user?: AdminUser }>({
    open: false,
    mode: 'create',
  });
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'user'; id: string; name: string } | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users', userSearch],
    queryFn: async () => {
      const res = await api.get('/admin/users', { params: { search: userSearch || undefined, limit: 200 } });
      return (res.data.data ?? []) as AdminUser[];
    },
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

  function handleUserSave(payload: Record<string, unknown>) {
    if (userModal.mode === 'create') {
      createUser.mutate(payload);
    } else if (userModal.user) {
      updateUser.mutate({ userId: userModal.user.id, payload });
    }
  }

  const isUserPending = createUser.isPending || updateUser.isPending;

  return (
    <div>
      <h1 className="page-title mb-6">Users</h1>
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <input
            className="input max-w-md"
            placeholder="Search users by name/email/university"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => setUserModal({ open: true, mode: 'create' })}>
            Create user
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
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setUserModal({ open: true, mode: 'edit', user: u })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
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

      {userModal.open && (
        <UserModal
          mode={userModal.mode}
          initial={userModal.user}
          onClose={() => setUserModal({ open: false, mode: 'create' })}
          onSave={handleUserSave}
          isPending={isUserPending}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={(reason) => deleteUser.mutate({ userId: deleteTarget.id, reason })}
          isPending={deleteUser.isPending}
        />
      )}
    </div>
  );
}
