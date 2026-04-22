import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommunityPage from '../../src/pages/community/CommunityPage';

const mockThreads = [
  {
    id: 'thread-1',
    title: 'Tips for Big-O notation?',
    body: 'Struggling with time complexity.',
    createdAt: new Date().toISOString(),
    creator: { id: 'u1', name: 'Alex Student', avatarUrl: null },
    course: { courseCode: 'CS 101' },
    _count: { posts: 3, likes: 5 },
    tags: ['algorithms'],
  },
  {
    id: 'thread-2',
    title: 'Best study resources for calculus?',
    body: 'Need help with integrals.',
    createdAt: new Date().toISOString(),
    creator: { id: 'u2', name: 'Bob Student', avatarUrl: null },
    course: null,
    _count: { posts: 0, likes: 1 },
    tags: [],
  },
];

const mockThreadDetail = {
  id: 'thread-1',
  title: 'Tips for Big-O notation?',
  body: 'Struggling with time complexity.',
  createdAt: new Date().toISOString(),
  creator: { id: 'u1', name: 'Alex Student', avatarUrl: null },
  course: { courseCode: 'CS 101', courseName: 'Intro to CS' },
  posts: [
    {
      id: 'post-1',
      content: 'Try visualizing growth curves.',
      createdAt: new Date().toISOString(),
      author: { id: 'u2', name: 'Bob Student', avatarUrl: null },
    },
  ],
  likes: [],
  _count: { posts: 1, likes: 5 },
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string, opts?: any) => {
      if (url.includes('/community/threads/')) {
        return Promise.resolve({ data: { data: mockThreadDetail } });
      }
      if (url.includes('/community/threads')) {
        return Promise.resolve({ data: { data: mockThreads } });
      }
      return Promise.resolve({ data: { data: [] } });
    }),
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
      <MemoryRouter>
        <CommunityPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CommunityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title and new thread button', async () => {
    renderPage();
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('New Thread')).toBeInTheDocument();
  });

  it('renders tab buttons', () => {
    renderPage();
    expect(screen.getByText('All Threads')).toBeInTheDocument();
    expect(screen.getByText('My Courses')).toBeInTheDocument();
  });

  it('renders thread list after loading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Tips for Big-O notation?')).toBeInTheDocument();
    });
    expect(screen.getByText('Best study resources for calculus?')).toBeInTheDocument();
  });

  it('shows course badge on threads with course', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101')).toBeInTheDocument();
    });
  });

  it('shows new thread form when button clicked', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('New Thread'));
    expect(screen.getByPlaceholderText('Thread title...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What's on your mind?")).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tags (comma separated)')).toBeInTheDocument();
  });

  it('shows thread detail when thread is clicked', async () => {
    renderPage();
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Tips for Big-O notation?')).toBeInTheDocument();
    });
    // Click on the first thread
    const threadButtons = screen.getAllByRole('button');
    const threadBtn = threadButtons.find(
      (btn) => btn.textContent?.includes('Tips for Big-O notation?')
    );
    if (threadBtn) {
      await user.click(threadBtn);
      await waitFor(() => {
        expect(screen.getByText('← Back to threads')).toBeInTheDocument();
      });
    }
  });

  it('shows empty state when no threads', async () => {
    const api = await import('../../src/lib/api');
    vi.mocked(api.default.get).mockImplementation(() =>
      Promise.resolve({ data: { data: [] } })
    );

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No threads yet. Start the conversation!')).toBeInTheDocument();
    });
  });
});
