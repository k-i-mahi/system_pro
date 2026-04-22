import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'cc-theme';

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyThemeClass(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.remove('light', 'dark');
  html.classList.add(resolved);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolved: resolveTheme('system'),
      setTheme: (theme) => {
        const resolved = resolveTheme(theme);
        applyThemeClass(resolved);
        set({ theme, resolved });
      },
      toggle: () => {
        const current = get().resolved;
        const next: Theme = current === 'dark' ? 'light' : 'dark';
        get().setTheme(next);
      },
    }),
    { name: STORAGE_KEY }
  )
);

/**
 * Call once at app boot. Applies the persisted (or system) theme and wires a
 * listener so the UI tracks OS-level theme changes while the user is on
 * "system" mode.
 */
export function initTheme() {
  const { theme, setTheme } = useThemeStore.getState();
  setTheme(theme);

  if (typeof window !== 'undefined') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
      if (useThemeStore.getState().theme === 'system') {
        setTheme('system');
      }
    });
  }
}
