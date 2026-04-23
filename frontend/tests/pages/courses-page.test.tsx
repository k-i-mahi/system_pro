import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CoursesPage from '../../src/pages/courses/CoursesPage';

const mockMyCourses = [
  {
    id: 'c1',
    courseCode: 'CS 101',
    courseName: 'Intro to Computer Science',
    description: 'Learn the basics of CS',
    level: 'Beginner',
    progress: 65,
    _count: { enrollments: 45 },
  },
  {
    id: 'c2',
    courseCode: 'MATH 201',
    courseName: 'Linear Algebra',
    description: 'Matrices and vectors',
    level: 'Intermediate',
    progress: 30,
    _count: { enrollments: 32 },
  },
];

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/courses/my-courses')) {
        return Promise.resolve({ data: { data: mockMyCourses } });
      }
      return Promise.resolve({ data: { data: [] } });
    }),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CoursesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CoursesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('My Courses')).toBeInTheDocument();
  });

  it('renders empty state loading skeleton text', () => {
    renderPage();
    expect(screen.getByText('Loading courses...')).toBeInTheDocument();
  });

  it('shows my courses by default', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Intro to Computer Science')).toBeInTheDocument();
    });
    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
  });

  it('shows course codes', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101')).toBeInTheDocument();
    });
    expect(screen.getByText('MATH 201')).toBeInTheDocument();
  });

  it('shows course descriptions', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Intro to Computer Science')).toBeInTheDocument();
    });
  });

  it('shows topics count', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('0 topics').length).toBeGreaterThan(0);
    });
  });

  it('links each course to detail page', async () => {
    renderPage();
    await waitFor(() => {
      const links = screen.getAllByRole('link');
      const hrefs = links.map((link) => link.getAttribute('href'));
      expect(hrefs).toContain('/courses/c1');
      expect(hrefs).toContain('/courses/c2');
    });
  });

  it('shows empty state when no courses', async () => {
    const api = await import('../../src/lib/api');
    vi.mocked(api.default.get).mockImplementation(() =>
      Promise.resolve({ data: { data: [] } })
    );

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No enrolled courses yet')).toBeInTheDocument();
    });
  });
});
