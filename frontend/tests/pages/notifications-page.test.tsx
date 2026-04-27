import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NotificationsPage from '../../src/pages/notifications/NotificationsPage';

const mockNotifications = [
  {
    id: 'n1',
    type: 'NEW_COURSE',
    title: 'New Course Available',
    body: 'A new Data Science course has been added.',
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n2',
    type: 'CLASS_REMINDER',
    title: 'Class in 30 minutes',
    body: 'CS 101 starts at 09:00 in Room 301.',
    isRead: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n3',
    type: 'SYSTEM',
    title: 'Welcome!',
    body: 'Start by exploring your courses.',
    isRead: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n4',
    type: 'MESSAGE',
    title: 'New Reply',
    body: 'Someone replied to your thread.',
    isRead: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n5',
    type: 'MESSAGE',
    title: 'Pat liked your thread',
    body: 'Someone appreciated your post.',
    isRead: false,
    createdAt: new Date().toISOString(),
    metadata: {
      kind: 'THREAD_LIKE',
      threadId: 'thread-99',
      courseId: 'course-1',
      deepLink: '/community/threads/thread-99',
    },
  },
];

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: mockNotifications } })),
    patch: vi.fn(() => Promise.resolve({ data: { data: {} } })),
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
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('renders notification items', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('New Course Available')).toBeInTheDocument();
    });
    expect(screen.getByText('Class in 30 minutes')).toBeInTheDocument();
    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    expect(screen.getByText('New Reply')).toBeInTheDocument();
  });

  it('shows unread count', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('3 unread')).toBeInTheDocument();
    });
  });

  it('shows mark all as read button when unread exist', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Mark all as read')).toBeInTheDocument();
    });
  });

  it('shows Open thread for thread notification deep links', async () => {
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Open thread' });
      expect(link).toHaveAttribute('href', '/community/threads/thread-99');
    });
  });

  it('renders notification body text', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText('A new Data Science course has been added.')
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no notifications', async () => {
    const api = await import('../../src/lib/api');
    vi.mocked(api.default.get).mockImplementation(() =>
      Promise.resolve({ data: { data: [] } })
    );

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });
  });
});
