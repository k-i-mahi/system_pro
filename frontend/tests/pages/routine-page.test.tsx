import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoutinePage from '../../src/pages/routine/RoutinePage';

const mockSchedule = [
  {
    id: 'slot-1',
    courseCode: 'CS 101',
    dayOfWeek: 'MON',
    startTime: '09:00',
    endTime: '10:30',
    room: 'Room 301',
    type: 'CLASS',
  },
  {
    id: 'slot-2',
    courseCode: 'MATH 201',
    dayOfWeek: 'WED',
    startTime: '11:00',
    endTime: '12:30',
    room: 'Room 102',
    type: 'CLASS',
  },
];

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: mockSchedule } })),
    post: vi.fn(() =>
      Promise.resolve({ data: { data: { extractedCodes: ['CS 101'] } } })
    ),
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
        <RoutinePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RoutinePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('My Routine')).toBeInTheDocument();
  });

  it('renders scan routine button', () => {
    renderPage();
    expect(screen.getByText('Scan Routine')).toBeInTheDocument();
  });

  it('renders day columns', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Mon')).toBeInTheDocument();
    });
    expect(screen.getByText('Tue')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.getByText('Thu')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });

  it('renders course slots in correct days', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101')).toBeInTheDocument();
    });
    expect(screen.getByText('MATH 201')).toBeInTheDocument();
  });

  it('shows time range for slots', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('09:00 – 10:30')).toBeInTheDocument();
    });
    expect(screen.getByText('11:00 – 12:30')).toBeInTheDocument();
  });

  it('shows room info for slots', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Room 301')).toBeInTheDocument();
    });
    expect(screen.getByText('Room 102')).toBeInTheDocument();
  });

  it('shows empty state when no schedule', async () => {
    const api = await import('../../src/lib/api');
    vi.mocked(api.default.get).mockImplementation(() =>
      Promise.resolve({ data: { data: [] } })
    );

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No courses in your routine yet')).toBeInTheDocument();
    });
  });
});
