import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '../../src/components/layout/AppLayout';

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    isAuthenticated: false,
    user: null,
    logout: vi.fn(),
  })),
}));

vi.mock('../../src/stores/ui.store', () => ({
  useUIStore: vi.fn(() => ({
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
  })),
}));

vi.mock('../../src/lib/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/routine']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<AppLayout />}>
            <Route path="/routine" element={<div>Routine Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppLayout', () => {
  it('redirects to login when not authenticated', () => {
    renderLayout();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });
});
