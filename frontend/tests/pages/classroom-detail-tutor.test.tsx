import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClassroomDetailPage from '../../src/pages/community/ClassroomDetailPage';

const mockCommunity = {
  id: 'c1',
  name: 'Test Classroom',
  description: 'Desc',
  courseCode: 'CS101',
  session: '2025',
  department: 'CSE',
  university: 'U',
  course: { id: 'course-1' },
  members: [{ id: 'm1', role: 'TUTOR', user: { id: 't1', name: 'Tutor', email: 't@t', rollNumber: null } }],
  _count: { members: 1 },
};

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 't1', name: 'Tutor', role: 'TUTOR' },
  })),
}));

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/community/c1')) {
        return Promise.resolve({ data: { data: mockCommunity } });
      }
      if (url.includes('/announcements')) {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    }),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/community/c1']}>
        <Routes>
          <Route path="/community/:id" element={<ClassroomDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ClassroomDetailPage tutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show helper onboarding panels for announcements/marks/materials', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Test Classroom')).toBeInTheDocument();
    });
    expect(screen.queryByText(/announcements stay here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/marks stay here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/materials stay in the course page/i)).not.toBeInTheDocument();
  });

  it('Marks tab is upload-only (no student roll table or upload history)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Test Classroom')).toBeInTheDocument());
    screen.getByRole('button', { name: 'Marks' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: /Upload marks file/i })).toBeInTheDocument());
    expect(screen.queryByText('Upload History')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Roll' })).not.toBeInTheDocument();
    expect(screen.queryByText('No scores recorded yet')).not.toBeInTheDocument();
  });
});
