import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfilePage from '../../src/pages/profile/ProfilePage';

const mockProfile = {
  id: 'user-1',
  name: 'Alex Student',
  email: 'student@copilot.dev',
  universityName: 'Demo University',
  avatarUrl: null,
  bio: 'A passionate learner.',
  phone: '+880123456789',
  role: 'STUDENT',
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: mockProfile } })),
    patch: vi.fn(() => Promise.resolve({ data: { data: mockProfile } })),
    post: vi.fn(() =>
      Promise.resolve({ data: { data: { avatarUrl: 'https://example.com/avatar.jpg' } } })
    ),
  },
}));

vi.mock('../../src/stores/auth.store', () => {
  const authState = {
    setUser: vi.fn(),
    setUserFromMe: vi.fn(),
    user: {
      id: 'user-1',
      name: 'Alex Student',
      email: 'student@copilot.dev',
      universityName: 'Demo University',
      avatarUrl: null,
      bio: 'A passionate learner.',
      phone: '+880123456789',
      role: 'STUDENT',
    },
  };
  return {
    useAuthStore: Object.assign(
      vi.fn((selector?: (s: typeof authState) => unknown) => {
        if (typeof selector === 'function') return selector(authState);
        return authState;
      }),
      {
        getState: vi.fn(() => ({
          ...authState,
          logout: vi.fn(),
        })),
      }
    ),
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Account')).toBeInTheDocument();
    });
  });

  it('renders user name and email', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Alex Student').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('student@copilot.dev').length).toBeGreaterThanOrEqual(1);
  });

  it('renders university name', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Demo University').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders role badge', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('student')).toBeInTheDocument();
    });
  });

  it('renders profile information section', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Profile Information')).toBeInTheDocument();
    });
  });

  it('renders edit button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });
  });

  it('shows edit form when edit button clicked', async () => {
    renderPage();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Edit Profile'));
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders bio text', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('A passionate learner.').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders field labels', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Full Name')).toBeInTheDocument();
    });
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('University')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Bio')).toBeInTheDocument();
  });

  it('shows avatar initial when no avatar URL', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });
});
