import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from '../src/pages/auth/LoginPage';
import { useAuthStore } from '../src/stores/auth.store';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../src/lib/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

import api from '../src/lib/api';

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage redirect after success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  });

  it('navigates to /admin/users for ADMIN', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'a',
          refreshToken: 'r',
          user: {
            id: '1',
            name: 'Admin',
            email: 'a@dept.kuet.ac.bd',
            role: 'ADMIN',
          },
        },
      },
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Enter your educational email'), 'admin@dept.kuet.ac.bd');
    await user.type(screen.getByPlaceholderText('Enter your password'), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
    });
  });

  it('navigates to /routine for STUDENT (tutor uses same path)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'a',
          refreshToken: 'r',
          user: {
            id: '2',
            name: 'Student',
            email: 's@stud.kuet.ac.bd',
            role: 'STUDENT',
          },
        },
      },
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Enter your educational email'), 's@stud.kuet.ac.bd');
    await user.type(screen.getByPlaceholderText('Enter your password'), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/routine');
    });
  });
});
