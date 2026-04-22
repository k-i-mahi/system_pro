import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from '../../src/components/layout/Header';

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 'u1', name: 'Alex Student', email: 'alex@test.com', avatarUrl: null, role: 'STUDENT' },
  })),
}));

vi.mock('../../src/stores/ui.store', () => ({
  useUIStore: vi.fn(() => ({
    toggleSidebar: vi.fn(),
  })),
}));

function renderComponent() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );
}

describe('Header', () => {
  it('renders search input', () => {
    renderComponent();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders user name', () => {
    renderComponent();
    expect(screen.getByText('Alex Student')).toBeInTheDocument();
  });

  it('renders avatar initial when no avatar URL', () => {
    renderComponent();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders notification bell link', () => {
    renderComponent();
    const links = screen.getAllByRole('link');
    const notifLink = links.find((l) => l.getAttribute('href') === '/notifications');
    expect(notifLink).toBeDefined();
  });

  it('renders profile link', () => {
    renderComponent();
    const links = screen.getAllByRole('link');
    const profileLink = links.find((l) => l.getAttribute('href') === '/profile');
    expect(profileLink).toBeDefined();
  });
});
