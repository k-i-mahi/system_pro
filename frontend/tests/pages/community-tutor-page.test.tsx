import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunityPage from '../../src/pages/community/CommunityPage';

vi.mock('../../src/stores/auth.store', () => {
  const state = {
    user: { id: 't1', name: 'Tutor', role: 'TUTOR', email: 'tutor@test.edu', universityName: 'U' },
  };
  return {
    useAuthStore: Object.assign(
      vi.fn((selector?: (s: typeof state) => unknown) => {
        if (typeof selector === 'function') return selector(state);
        return state;
      }),
      { getState: vi.fn(() => ({ ...state, logout: vi.fn() })) }
    ),
  };
});

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { data: {} } })),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/community']}>
        <Routes>
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/community/threads/:threadId" element={<CommunityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CommunityPage tutor classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show tutor workflow onboarding banner', () => {
    renderPage();
    expect(screen.queryByText(/tutor workflow/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/match course code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/students join once/i)).not.toBeInTheDocument();
  });
});
