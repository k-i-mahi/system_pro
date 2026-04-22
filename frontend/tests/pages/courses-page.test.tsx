import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const mockExploreCourses = [
  ...mockMyCourses,
  {
    id: 'c3',
    courseCode: 'PHY 101',
    courseName: 'Physics I',
    description: 'Mechanics and thermodynamics',
    level: 'Beginner',
    _count: { enrollments: 60 },
  },
];

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/courses/my-courses')) {
        return Promise.resolve({ data: { data: mockMyCourses } });
      }
      if (url.includes('/courses')) {
        return Promise.resolve({ data: { data: mockExploreCourses } });
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
    expect(screen.getByText('Courses')).toBeInTheDocument();
  });

  it('renders tab buttons', () => {
    renderPage();
    expect(screen.getByText('My Courses')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
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
      expect(screen.getByText('Learn the basics of CS')).toBeInTheDocument();
    });
  });

  it('shows level badges', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Beginner')).toBeInTheDocument();
    });
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
  });

  it('shows search/filter section when on explore tab', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Explore'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search courses...')).toBeInTheDocument();
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
