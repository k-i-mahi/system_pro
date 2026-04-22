import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CourseDetailPage from '../../src/pages/courses/CourseDetailPage';

const mockCourse = {
  id: 'c1',
  courseCode: 'CS 101',
  courseName: 'Intro to Computer Science',
  description: 'Learn the basics of CS',
  enrollment: { ctScore1: 17, ctScore2: 15, ctScore3: null, labScore: 35 },
  topics: [
    {
      id: 't1',
      title: 'Algorithms',
      description: 'Sorting and searching',
      status: 'DONE',
      orderIndex: 0,
      materials: [
        { id: 'm1', title: 'Lecture Notes', fileUrl: '/files/notes.pdf', fileType: 'PDF' },
      ],
      topicProgress: [{ expertiseLevel: 0.85 }],
    },
    {
      id: 't2',
      title: 'Data Structures',
      description: 'Arrays, trees, graphs',
      status: 'IN_PROGRESS',
      orderIndex: 1,
      materials: [],
      topicProgress: [{ expertiseLevel: 0.4 }],
    },
  ],
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: mockCourse } })),
    post: vi.fn(() => Promise.resolve({ data: { data: {} } })),
    delete: vi.fn(() => Promise.resolve({ data: { data: {} } })),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/courses/c1']}>
        <Routes>
          <Route path="/courses/:courseId" element={<CourseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CourseDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders course code and name', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101')).toBeInTheDocument();
    });
    expect(screen.getByText('Intro to Computer Science')).toBeInTheDocument();
  });

  it('renders course description', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Learn the basics of CS')).toBeInTheDocument();
    });
  });

  it('renders back to courses link', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Back to Courses')).toBeInTheDocument();
    });
  });

  it('renders scores table', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('My Scores')).toBeInTheDocument();
    });
    expect(screen.getByText('Class Test 1')).toBeInTheDocument();
    expect(screen.getByText('Class Test 2')).toBeInTheDocument();
    expect(screen.getByText('Class Test 3')).toBeInTheDocument();
    expect(screen.getByText('Lab / Assignment')).toBeInTheDocument();
  });

  it('renders topic count', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Topics (2)')).toBeInTheDocument();
    });
  });

  it('renders topic titles', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Algorithms')).toBeInTheDocument();
    });
    expect(screen.getByText('Data Structures')).toBeInTheDocument();
  });

  it('shows add topic button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Add Topic')).toBeInTheDocument();
    });
  });

  it('shows mastery percentage', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('85% mastery')).toBeInTheDocument();
    });
    expect(screen.getByText('40% mastery')).toBeInTheDocument();
  });
});
