import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  universityName?: string;
  avatarUrl?: string;
  bio?: string;
  phone?: string;
  rollNumber?: string;
  session?: string;
  department?: string;
  role: string;
  language?: string;
  timezone?: string;
  createdAt?: string;
}

const BIO_MAX = 500;

function RoleBadge({ role }: { role?: string }) {
  const map: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    TUTOR: 'bg-blue-100 text-blue-700',
    STUDENT: 'bg-green-100 text-green-700',
  };
  const cls = map[role ?? ''] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {role?.toLowerCase() ?? 'unknown'}
    </span>
  );
}

function formatJoined(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { setUserFromMe } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: () => api.get('/profile').then((r) => r.data.data),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (profile) {
      setUserFromMe({
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        universityName: profile.universityName,
        bio: profile.bio,
        phone: profile.phone,
        rollNumber: profile.rollNumber,
        session: profile.session,
        department: profile.department,
        language: profile.language,
        timezone: profile.timezone,
      });
    }
  }, [profile, setUserFromMe]);

  function startEdit() {
    setForm({
      name: profile?.name || '',
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
      setUserFromMe(res.data.data);
      setEditing(false);
      toast.success('Profile updated');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to update profile');
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('avatar', file);
      return api.post('/profile/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setUserFromMe({ avatarUrl: res.data.data.avatarUrl });
      toast.success('Avatar updated');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to upload avatar');
    },
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

  const bioLength = (editing ? form.bio : profile?.bio)?.length ?? 0;

  if (isLoading) {
    return (
      <div className="card py-12 text-center text-text-muted">
        Loading account details...
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title mb-2">Account</h1>
      <p className="mb-6 max-w-2xl text-sm text-text-secondary">
        Manage your public profile, academic identity, and account security.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Overview card ── */}
        <div className="card flex flex-col items-center text-center">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Overview</p>

          <div className="relative mb-4 inline-block">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="h-24 w-24 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white ring-2 ring-border">
                {profile?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
            )}
            <label
              className={`absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-primary shadow transition-colors hover:bg-primary/90 ${avatarMutation.isPending ? 'opacity-60 pointer-events-none' : ''}`}
              title="Change avatar"
            >
              <Camera size={14} className="text-white" />
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) avatarMutation.mutate(file);
                }}
              />
            </label>
          </div>

          {avatarMutation.isPending && (
            <p className="mb-2 text-xs text-text-muted">Uploading avatar…</p>
          )}

          <h2 className="text-lg font-semibold">{profile?.name}</h2>
          <p className="text-sm text-text-secondary">{profile?.email}</p>
          {profile?.universityName && (
            <p className="mt-1 text-sm text-text-muted">{profile.universityName}</p>
          )}
          <div className="mt-3">
            <RoleBadge role={profile?.role} />
          </div>
          {profile?.createdAt && (
            <p className="mt-3 text-xs text-text-muted">
              Member since {formatJoined(profile.createdAt)}
            </p>
          )}
          {profile?.bio && !editing && (
            <p className="mt-3 border-t border-border pt-3 text-sm text-text-secondary">
              {profile.bio}
            </p>
          )}
        </div>

        {/* ── Profile form ── */}
        <div className="card lg:col-span-2">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="font-semibold">Profile Information</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Keep your personal and academic details up to date.
              </p>
            </div>
            {!editing ? (
              <button onClick={startEdit} className="btn-primary text-sm">
                Edit Profile
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="btn-secondary text-sm"
                  disabled={updateMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  onClick={() => updateMutation.mutate(form)}
                  className="btn-primary flex items-center gap-1 text-sm"
                  disabled={updateMutation.isPending}
                >
                  <Save size={14} />
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          {/* Personal */}
          <div className="mb-6">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Personal Details
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <p className="text-text-primary">{profile?.name || <span className="text-text-muted">Not set</span>}</p>
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
                  <p className="text-text-primary">{profile?.universityName || <span className="text-text-muted">Not set</span>}</p>
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
                    placeholder="+880 ..."
                  />
                ) : (
                  <p className="text-text-primary">{profile?.phone || <span className="text-text-muted">Not set</span>}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="label">Bio</label>
                  {editing && (
                    <span className={`text-xs ${bioLength > BIO_MAX ? 'text-danger' : 'text-text-muted'}`}>
                      {bioLength}/{BIO_MAX}
                    </span>
                  )}
                </div>
                {editing ? (
                  <textarea
                    className="input h-20 py-2"
                    value={form.bio}
                    maxLength={BIO_MAX}
                    onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                    placeholder="Tell us a bit about yourself…"
                  />
                ) : (
                  <p className="text-text-primary">{profile?.bio || <span className="text-text-muted">No bio yet</span>}</p>
                )}
              </div>
            </div>
          </div>

          {/* Academic */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Academic Details
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <p className="text-text-primary">{profile?.rollNumber || <span className="text-text-muted">Not set</span>}</p>
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
                    placeholder="e.g. 2022–2023"
                  />
                ) : (
                  <p className="text-text-primary">{profile?.session || <span className="text-text-muted">Not set</span>}</p>
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
                    placeholder="e.g. Computer Science & Engineering"
                  />
                ) : (
                  <p className="text-text-primary">{profile?.department || <span className="text-text-muted">Not set</span>}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className="card mt-6 border border-danger/30">
        <h2 className="mb-1 font-semibold text-danger">Danger Zone</h2>
        <p className="mb-4 text-sm text-text-secondary">
          Permanently delete your account and remove all your data. This action is irreversible.
        </p>
        <button
          className="btn-secondary flex items-center gap-2 border border-danger/40 text-danger hover:bg-red-50"
          onClick={() => {
            if (
              window.confirm(
                'Are you sure you want to permanently delete your account? This cannot be undone.'
              )
            ) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 size={14} />
          {deleteMutation.isPending ? 'Deleting…' : 'Delete My Account'}
        </button>
      </div>
    </div>
  );
}
