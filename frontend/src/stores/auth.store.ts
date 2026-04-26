import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
        window.localStorage.removeItem('routine-draft-v1');
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
    }),
    { name: 'auth-storage' }
  )
);
