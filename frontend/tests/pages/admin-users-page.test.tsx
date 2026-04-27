import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminUsersPage from '../../src/pages/admin/AdminUsersPage';

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({
        data: { data: [] },
      })
    ),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows users heading and no overview or stats copy', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    });
    expect(screen.queryByText(/overview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/recent registrations/i)).not.toBeInTheDocument();
  });
});
