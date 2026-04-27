import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import api from '@/lib/api';
import {
  DeleteConfirmModal,
  ThreadCreateModal,
  ThreadEditModal,
  type AdminThreadRow,
} from './AdminModals';

export default function AdminThreadsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<AdminThreadRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'thread'; id: string; name: string } | null>(null);

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['admin-threads', search],
    queryFn: async () => {
      const res = await api.get('/admin/threads', { params: { search: search || undefined, limit: 200 } });
      return (res.data.data ?? []) as AdminThreadRow[];
    },
  });

  const createThread = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/admin/threads', payload),
    onSuccess: () => {
      toast.success('Thread created');
      queryClient.invalidateQueries({ queryKey: ['admin-threads'] });
      setCreateOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? e?.response?.data?.detail ?? 'Failed to create thread'),
  });

  const updateThread = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/threads/${id}`, payload),
    onSuccess: () => {
      toast.success('Thread updated');
      queryClient.invalidateQueries({ queryKey: ['admin-threads'] });
      setEditRow(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? e?.response?.data?.detail ?? 'Failed to update thread'),
  });

  const deleteThread = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/threads/${id}`),
    onSuccess: () => {
      toast.success('Thread deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-threads'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to delete thread'),
  });

  return (
    <div>
      <h1 className="page-title mb-6">Threads</h1>
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <input
            className="input max-w-md"
            placeholder="Search threads by title or body"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            Create thread
          </button>
        </div>
        {isLoading ? (
          <p className="text-text-muted">Loading threads…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Creator</th>
                  <th className="pb-2">Course</th>
                  <th className="pb-2">Tags</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2">Replies</th>
                  <th className="pb-2">Likes</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 max-w-[200px] truncate font-medium" title={t.title}>
                      {t.title}
                    </td>
                    <td className="py-2">{t.creator?.name ?? '—'}</td>
                    <td className="py-2">{t.course?.courseCode ?? '—'}</td>
                    <td className="py-2 text-text-muted text-xs">{(t.tags || []).join(', ') || '—'}</td>
                    <td className="py-2 text-text-muted text-xs whitespace-nowrap">
                      {t.createdAt ? formatDistanceToNow(new Date(t.createdAt), { addSuffix: true }) : '—'}
                    </td>
                    <td className="py-2">{t.replyCount}</td>
                    <td className="py-2">{t.likeCount}</td>
                    <td className="py-2 flex gap-3 whitespace-nowrap">
                      <button type="button" className="text-primary hover:underline" onClick={() => setEditRow(t)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-danger hover:underline"
                        onClick={() => setDeleteTarget({ type: 'thread', id: t.id, name: t.title })}
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

      {createOpen && (
        <ThreadCreateModal
          onClose={() => setCreateOpen(false)}
          onSave={(payload) => createThread.mutate(payload)}
          isPending={createThread.isPending}
        />
      )}
      {editRow && (
        <ThreadEditModal
          initial={editRow}
          onClose={() => setEditRow(null)}
          onSave={(payload) => updateThread.mutate({ id: editRow.id, payload })}
          isPending={updateThread.isPending}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteThread.mutate(deleteTarget.id)}
          isPending={deleteThread.isPending}
        />
      )}
    </div>
  );
}
