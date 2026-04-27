import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClassroomDetailPage from '../../src/pages/community/ClassroomDetailPage';

const mockCommunityStudent = {
  id: 'c1',
  name: 'Class',
  courseCode: 'CS101',
  session: '2025',
  department: 'CSE',
  university: 'U',
  course: { id: 'course-1' },
  members: [{ id: 'm1', role: 'STUDENT', user: { id: 's1', name: 'Stu', email: 's@s', rollNumber: '1' } }],
  _count: { members: 2 },
};

const studentAnnouncements = [
  {
    id: 'a1',
    title: 'CS101 — CT 1 file posted',
    body: 'Your instructor uploaded a marks file',
    createdAt: new Date().toISOString(),
    studentFeedOnly: true,
    author: { name: 'Tutor' },
  },
];

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 's1', name: 'Stu', role: 'STUDENT' },
  })),
}));

const apiGet = vi.fn((url: string) => {
  if (url.includes('/community/c1') && !url.includes('announcements')) {
    return Promise.resolve({ data: { data: mockCommunityStudent } });
  }
  if (url.includes('/announcements')) {
    return Promise.resolve({ data: { data: studentAnnouncements } });
  }
  return Promise.resolve({ data: { data: [] } });
});

vi.mock('../../src/lib/api', () => ({
  default: {
    get: (url: string, ...args: unknown[]) => apiGet(url, ...args),
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

describe('Classroom announcements feed (student)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows student-facing marks announcement returned by API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/CT 1 file posted/i)).toBeInTheDocument();
    });
    expect(apiGet).toHaveBeenCalled();
  });
});
