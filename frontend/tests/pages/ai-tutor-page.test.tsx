import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AITutorPage from '../../src/pages/ai-tutor/AITutorPage';

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = vi.fn();

const mockMyCourses = [
  { id: 'c1', courseCode: 'CS 101', courseName: 'Intro to CS' },
];

const mockCourseDetail = {
  id: 'c1',
  courseCode: 'CS 101',
  topics: [
    { id: 't1', title: 'Algorithms' },
    { id: 't2', title: 'Data Structures' },
  ],
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/courses/my-courses')) {
        return Promise.resolve({ data: { data: mockMyCourses } });
      }
      if (url.match(/\/courses\/[^/]+$/)) {
        return Promise.resolve({ data: { data: mockCourseDetail } });
      }
      return Promise.resolve({ data: { data: [] } });
    }),
  },
}));

vi.mock('../../src/stores/auth.store', () => ({
  useAuthStore: Object.assign(
    vi.fn(() => ({ user: { id: 'u1', name: 'Test' } })),
    {
      getState: vi.fn(() => ({
        accessToken: 'mock-token',
        user: { id: 'u1', name: 'Test' },
      })),
    }
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AITutorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AITutorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders AI Tutor heading', () => {
    renderPage();
    expect(screen.getByText('AI Tutor')).toBeInTheDocument();
  });

  it('renders context section', () => {
    renderPage();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('renders course selector', () => {
    renderPage();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('renders quick actions', () => {
    renderPage();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Explain this topic')).toBeInTheDocument();
    expect(screen.getByText('Generate quiz')).toBeInTheDocument();
    expect(screen.getByText('Key concepts')).toBeInTheDocument();
  });

  it('renders empty chat state', () => {
    renderPage();
    expect(screen.getByText('How can I help you study?')).toBeInTheDocument();
    expect(
      screen.getByText('Ask questions, request explanations, or generate quizzes')
    ).toBeInTheDocument();
  });

  it('renders message input', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Ask your AI tutor...')).toBeInTheDocument();
  });

  it('renders course options after loading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101 - Intro to CS')).toBeInTheDocument();
    });
  });
});
