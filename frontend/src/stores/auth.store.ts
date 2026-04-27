import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTutorSessionStore } from '@/stores/tutor-session.store';
import { clearMaterialUploadSessionForUser } from '@/stores/material-upload.store';

export type UserRole = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  universityName?: string;
  role: UserRole;
  rollNumber?: string;
  session?: string;
  department?: string;
  bio?: string;
  phone?: string;
  language?: string;
  timezone?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  /** Refresh user fields from GET /auth/me without touching tokens. */
  setUserFromMe: (me: Partial<User>) => void;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, isAuthenticated: true }),
      setUser: (user) => set({ user }),
      setUserFromMe: (me) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...me } as User });
      },
      login: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),
      logout: () => {
        const uid = get().user?.id ?? null;
        void clearMaterialUploadSessionForUser(uid);
        // Routine drafts are per-user (`routine-draft-v1:<userId>`) and intentionally kept
        // across logout so tutors/students do not lose in-progress schedule edits.
        useTutorSessionStore.getState().clearAll();
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
    }),
    { name: 'auth-storage' }
  )
);
