import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../../src/components/layout/Sidebar';

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    logout: vi.fn(),
  })),
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
  it('renders app name', () => {
    renderComponent();
    expect(screen.getByText('Cognitive Copilot')).toBeInTheDocument();
  });

  it('renders all nav items', () => {
    renderComponent();
    expect(screen.getByText('My Routine')).toBeInTheDocument();
    expect(screen.getByText('Courses')).toBeInTheDocument();
    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('renders logout button', () => {
    renderComponent();
    expect(screen.getByText('Log Out')).toBeInTheDocument();
  });

  it('renders correct nav links', () => {
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
});
