import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { ClassroomModal, DeleteConfirmModal, type AdminCommunity } from './AdminModals';

export default function AdminClassroomsPage() {
  const queryClient = useQueryClient();
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityModal, setCommunityModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    community?: AdminCommunity;
  }>({ open: false, mode: 'create' });
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'community'; id: string; name: string } | null>(null);

  const { data: communities = [], isLoading: communitiesLoading } = useQuery({
    queryKey: ['admin-communities', communitySearch],
    queryFn: async () => {
      const res = await api.get('/admin/communities', { params: { search: communitySearch || undefined, limit: 200 } });
      return (res.data.data ?? []) as AdminCommunity[];
    },
  });

  const createCommunity = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/admin/communities', payload),
    onSuccess: () => {
      toast.success('Classroom created');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setCommunityModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to create classroom'),
  });

  const updateCommunity = useMutation({
    mutationFn: ({ communityId, payload }: { communityId: string; payload: Record<string, unknown> }) =>
      api.patch(`/admin/communities/${communityId}`, payload),
    onSuccess: () => {
      toast.success('Classroom updated');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setCommunityModal({ open: false, mode: 'create' });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to update classroom'),
  });

  const deleteCommunity = useMutation({
    mutationFn: (communityId: string) => api.delete(`/admin/communities/${communityId}`),
    onSuccess: () => {
      toast.success('Classroom deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-communities'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      setDeleteTarget(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to delete classroom'),
  });

  function handleCommunitySave(payload: Record<string, unknown>) {
    if (communityModal.mode === 'create') {
      createCommunity.mutate(payload);
    } else if (communityModal.community) {
      updateCommunity.mutate({ communityId: communityModal.community.id, payload });
    }
  }

  const isCommunityPending = createCommunity.isPending || updateCommunity.isPending;

  return (
    <div>
      <h1 className="page-title mb-6">Classrooms</h1>
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <input
            className="input max-w-md"
            placeholder="Search classrooms by name/course/university"
            value={communitySearch}
            onChange={(e) => setCommunitySearch(e.target.value)}
          />
          <button type="button" className="btn-primary" onClick={() => setCommunityModal({ open: true, mode: 'create' })}>
            Create classroom
          </button>
        </div>
        {communitiesLoading ? (
          <p className="text-text-muted">Loading classrooms…</p>
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
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setCommunityModal({ open: true, mode: 'edit', community: c })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
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

      {communityModal.open && (
        <ClassroomModal
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
          onConfirm={() => deleteCommunity.mutate(deleteTarget.id)}
          isPending={deleteCommunity.isPending}
        />
      )}
    </div>
  );
}
