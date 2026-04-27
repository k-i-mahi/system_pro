import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../src/components/layout/Sidebar';

const logout = vi.fn();

function mockAuthState(user: { id: string; role: string } | null) {
  const state = { user, logout };
  return (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
}

let authImpl: ReturnType<typeof mockAuthState>;

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string; role: string } | null; logout: typeof logout }) => unknown) =>
    authImpl(selector),
  ),
}));

vi.mock('../../src/stores/ui.store', () => ({
  useUIStore: vi.fn(() => ({
    sidebarCollapsed: false,
  })),
}));

vi.mock('../../src/lib/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

function renderComponent() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    authImpl = mockAuthState({ id: 's1', role: 'STUDENT' });
  });

  it('renders app name', () => {
    renderComponent();
    expect(screen.getByText('Cognitive Copilot')).toBeInTheDocument();
  });

  it('renders student nav items', () => {
    renderComponent();
    expect(screen.getByText('My Routine')).toBeInTheDocument();
    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('renders tutor-only nav (Classroom, Account, Profile — no Courses)', () => {
    authImpl = mockAuthState({ id: 't1', role: 'TUTOR' });
    renderComponent();
    expect(screen.getByText('My Routine')).toBeInTheDocument();
    expect(screen.getByText('Classroom')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.queryByText('Courses')).not.toBeInTheDocument();
    expect(screen.queryByText('AI Tutor')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
  });

  it('renders admin-only nav (Users, Threads, Classrooms — no community/analytics)', () => {
    authImpl = mockAuthState({ id: 'a1', role: 'ADMIN' });
    renderComponent();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Threads')).toBeInTheDocument();
    expect(screen.getByText('Classrooms')).toBeInTheDocument();
    expect(screen.queryByText('Community')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('renders logout button', () => {
    renderComponent();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
  });

  it('renders correct student nav links', () => {
    renderComponent();
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/routine');
    expect(hrefs).toContain('/courses');
    expect(hrefs).toContain('/ai-tutor');
    expect(hrefs).toContain('/community');
    expect(hrefs).toContain('/analytics');
    expect(hrefs).toContain('/settings');
    expect(hrefs).toContain('/profile');
  });

  it('renders correct admin nav links', () => {
    authImpl = mockAuthState({ id: 'a1', role: 'ADMIN' });
    renderComponent();
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/admin/users');
    expect(hrefs).toContain('/admin/threads');
    expect(hrefs).toContain('/admin/classrooms');
  });
});
