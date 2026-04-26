import type { User } from '@/stores/auth.store';

export const isAdmin = (u?: User | null): boolean => u?.role === 'ADMIN';
export const isTutor = (u?: User | null): boolean =>
  u?.role === 'TUTOR' || u?.role === 'ADMIN';
export const isStudent = (u?: User | null): boolean => u?.role === 'STUDENT';

export const canManageClassroom = (
  u?: User | null,
  community?: { createdBy?: string } | null,
): boolean => isAdmin(u) || !!(community?.createdBy && community.createdBy === u?.id);

export const canUploadMaterial = (u?: User | null): boolean => isTutor(u);
export const canViewEvalPage = (u?: User | null): boolean => isTutor(u);
export const canUseAdminPanel = (u?: User | null): boolean => isAdmin(u);
export const canUseAiTutor = (u?: User | null): boolean => !isAdmin(u);
