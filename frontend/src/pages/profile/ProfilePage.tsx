import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Save, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { setUser } = useAuthStore();
  const [editing, setEditing] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/profile').then((r) => r.data.data),
  });

  const [form, setForm] = useState<Record<string, string>>({});

  function startEdit() {
    setForm({
      name: profile?.name || '',
      email: profile?.email || '',
      universityName: profile?.universityName || '',
      phone: profile?.phone || '',
      bio: profile?.bio || '',
      rollNumber: profile?.rollNumber || '',
      session: profile?.session || '',
      department: profile?.department || '',
    });
    setEditing(true);
  }

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, string>) => api.patch('/profile', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setUser(res.data.data);
      setEditing(false);
      toast.success('Profile updated');
    },
    onError: () => toast.error('Failed to update profile'),
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('avatar', file);
      return api.post('/profile/avatar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setUser({ ...useAuthStore.getState().user!, avatarUrl: res.data.data.avatarUrl });
      toast.success('Avatar updated');
    },
    onError: () => toast.error('Failed to upload avatar'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete('/profile'),
    onSuccess: () => {
      toast.success('Account deleted');
      useAuthStore.getState().logout();
      window.location.href = '/login';
    },
    onError: () => toast.error('Failed to delete account'),
  });

  if (isLoading) return <div className="text-center py-12 text-text-muted">Loading...</div>;

  return (
    <div>
      <h1 className="page-title mb-6">Account</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Avatar card */}
        <div className="card text-center">
          <div className="relative inline-block mx-auto mb-4">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="w-24 h-24 rounded-full object-cover"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-white text-3xl font-bold">
                {profile?.name?.charAt(0) || 'U'}
              </div>
            )}
            <label className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors">
              <Camera size={14} className="text-white" />
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) avatarMutation.mutate(file);
                }}
              />
            </label>
          </div>
          <h2 className="font-semibold text-lg">{profile?.name}</h2>
          <p className="text-sm text-text-secondary">{profile?.email}</p>
          {profile?.universityName && (
            <p className="text-sm text-text-muted mt-1">{profile.universityName}</p>
          )}
          <p className="text-xs text-text-muted mt-2 capitalize">{profile?.role?.toLowerCase()}</p>
        </div>

        {/* Profile form */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Profile Information</h2>
            {!editing ? (
              <button onClick={startEdit} className="btn-primary text-sm">
                Edit Profile
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
                <button
                  onClick={() => updateMutation.mutate(form)}
                  className="btn-primary text-sm flex items-center gap-1"
                  disabled={updateMutation.isPending}
                >
                  <Save size={14} />
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.name || '–'}</p>
              )}
            </div>
            <div>
              <label className="label">Email</label>
              <p className="text-text-primary">{profile?.email}</p>
            </div>
            <div>
              <label className="label">University</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.universityName}
                  onChange={(e) => setForm((p) => ({ ...p, universityName: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.universityName || '–'}</p>
              )}
            </div>
            <div>
              <label className="label">Phone</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.phone || '–'}</p>
              )}
            </div>
            <div>
              <label className="label">Roll Number</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.rollNumber}
                  onChange={(e) => setForm((p) => ({ ...p, rollNumber: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.rollNumber || '–'}</p>
              )}
            </div>
            <div>
              <label className="label">Session</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.session}
                  onChange={(e) => setForm((p) => ({ ...p, session: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.session || '–'}</p>
              )}
            </div>
            <div>
              <label className="label">Department</label>
              {editing ? (
                <input
                  type="text"
                  className="input"
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                />
              ) : (
                <p className="text-text-primary">{profile?.department || '–'}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="label">Bio</label>
              {editing ? (
                <textarea
                  className="input h-20 py-2"
                  value={form.bio}
                  onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell us about yourself..."
                />
              ) : (
                <p className="text-text-primary">{profile?.bio || 'No bio yet'}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-6 border border-danger/30">
        <h2 className="font-semibold text-danger mb-2">Danger Zone</h2>
        <p className="text-sm text-text-secondary mb-4">
          Permanently delete your account and remove your profile access.
        </p>
        <button
          className="btn-secondary text-danger border border-danger/40 flex items-center gap-2"
          onClick={() => {
            const confirmed = window.confirm('Delete your account permanently? This action cannot be undone.');
            if (confirmed) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 size={14} />
          {deleteMutation.isPending ? 'Deleting...' : 'Delete Account'}
        </button>
      </div>
    </div>
  );
}
