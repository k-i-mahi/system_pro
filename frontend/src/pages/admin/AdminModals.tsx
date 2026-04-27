import { useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';

type Role = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  universityName: string;
  role: Role;
  rollNumber?: string | null;
  session?: string | null;
  department?: string | null;
}

export interface AdminCommunity {
  id: string;
  name: string;
  description?: string | null;
  courseCode: string;
  courseName: string;
  session: string;
  department: string;
  university: string;
}

export function UserModal({
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
        <button type="button" className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
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
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClassroomModal({
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
        <button type="button" className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg">{mode === 'create' ? 'Create Classroom' : 'Edit Classroom'}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Classroom name</label>
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
              <label className="label">Tutor owner user ID (optional)</label>
              <input
                className="input"
                placeholder="Assign a tutor member when creating"
                value={form.ownerUserId}
                onChange={(e) => set('ownerUserId', e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmModal({
  target,
  onClose,
  onConfirm,
  isPending,
}: {
  target: { type: 'user' | 'community' | 'thread'; name: string };
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');

  const title =
    target.type === 'user' ? 'Delete user' : target.type === 'community' ? 'Delete classroom' : 'Delete thread';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm space-y-4 relative">
        <button type="button" className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg text-danger">{title}</h2>
        <p className="text-sm text-text-secondary">
          Permanently delete <span className="font-medium text-text-primary">&quot;{target.name}&quot;</span>?
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
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
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

export interface AdminThreadRow {
  id: string;
  title: string;
  body: string;
  tags: string[];
  courseId: string | null;
  course: { courseCode: string; courseName: string } | null;
  creator: { id: string; name: string; email: string } | null;
  createdAt: string;
  replyCount: number;
  likeCount: number;
}

export function ThreadEditModal({
  initial,
  onClose,
  onSave,
  isPending,
}: {
  initial: AdminThreadRow;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    title: initial.title,
    body: initial.body,
    courseId: initial.courseId ?? '',
    tags: (initial.tags || []).join(', '),
  });

  function handleSubmit() {
    if (!form.title.trim() || !form.body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    onSave({
      title: form.title,
      body: form.body,
      courseId: form.courseId.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg space-y-4 relative max-h-[90vh] overflow-y-auto">
        <button type="button" className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg">Edit thread</h2>
        <div className="space-y-3">
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className="label">Body</label>
            <textarea className="input min-h-[120px]" value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} />
          </div>
          <div>
            <label className="label">Course ID (optional)</label>
            <input className="input" value={form.courseId} onChange={(e) => setForm((p) => ({ ...p, courseId: e.target.value }))} />
          </div>
          <div>
            <label className="label">Tags (comma-separated)</label>
            <input className="input" value={form.tags} onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ThreadCreateModal({
  onClose,
  onSave,
  isPending,
}: {
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    creatorUserId: '',
    title: '',
    body: '',
    courseId: '',
    tags: '',
  });

  function handleSubmit() {
    if (!form.creatorUserId.trim()) {
      toast.error('Creator user ID is required');
      return;
    }
    if (!form.title.trim() || !form.body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    onSave({
      creatorUserId: form.creatorUserId.trim(),
      title: form.title,
      body: form.body,
      courseId: form.courseId.trim() || undefined,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg space-y-4 relative max-h-[90vh] overflow-y-auto">
        <button type="button" className="absolute top-4 right-4 text-text-muted hover:text-text-primary" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 className="font-semibold text-lg">Create thread</h2>
        <p className="text-sm text-text-secondary">
          The creator must be a student account (role STUDENT). Paste their user id from the API or their registered
          email address.
        </p>
        <div className="space-y-3">
          <div>
            <label className="label">Creator (user id or email)</label>
            <input
              className="input"
              placeholder="e.g. 5bc8d517-… or name@stud.kuet.ac.bd"
              value={form.creatorUserId}
              onChange={(e) => setForm((p) => ({ ...p, creatorUserId: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className="label">Body</label>
            <textarea className="input min-h-[120px]" value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} />
          </div>
          <div>
            <label className="label">Course ID (optional)</label>
            <input className="input" value={form.courseId} onChange={(e) => setForm((p) => ({ ...p, courseId: e.target.value }))} />
          </div>
          <div>
            <label className="label">Tags (comma-separated)</label>
            <input className="input" value={form.tags} onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
