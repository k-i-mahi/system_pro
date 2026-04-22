import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AnalyticsPage from '../../src/pages/analytics/AnalyticsPage';

const mockOverview = {
  totalCourses: 3,
  avgAttendance: 80,
  avgCT: 15,
  topicsMastered: 1,
  totalTopics: 4,
};

const mockMyCourses = [
  { id: 'c1', courseCode: 'CS 101', courseName: 'Intro to CS' },
  { id: 'c2', courseCode: 'MATH 201', courseName: 'Linear Algebra' },
];

const mockCourseAnalytics = {
  enrollment: { ctScore1: 17, ctScore2: 15, ctScore3: null, labScore: 35 },
  topicAnalytics: [
    { id: 't1', title: 'Algorithms', expertiseLevel: 0.85, studyMinutes: 120 },
    { id: 't2', title: 'Data Structures', expertiseLevel: 0.6, studyMinutes: 90 },
  ],
  attendanceData: [
    { date: '2024-01-15', present: true },
    { date: '2024-01-16', present: false },
  ],
  attendancePercentage: 80,
  examHistory: [
    { id: 'e1', score: 75, totalQ: 10, timeTaken: 600, createdAt: '2024-01-10T10:00:00Z' },
  ],
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url.includes('/analytics/overview')) {
        return Promise.resolve({ data: { data: mockOverview } });
      }
      if (url.includes('/courses/my-courses')) {
        return Promise.resolve({ data: { data: mockMyCourses } });
      }
      if (url.includes('/analytics/courses/')) {
        return Promise.resolve({ data: { data: mockCourseAnalytics } });
      }
      return Promise.resolve({ data: { data: [] } });
    }),
  },
}));

// Mock recharts to avoid canvas issues in test env
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
  });

  it('renders overview stat cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total Courses')).toBeInTheDocument();
    });
    expect(screen.getByText('Avg Attendance')).toBeInTheDocument();
    expect(screen.getByText('Avg CT Score')).toBeInTheDocument();
    expect(screen.getByText('Topics Mastered')).toBeInTheDocument();
  });

  it('shows correct overview values', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });

  it('renders course selector with label', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Course Analytics')).toBeInTheDocument();
    });
    expect(screen.getByText('Select a course...')).toBeInTheDocument();
  });

  it('renders course options in dropdown', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('CS 101 - Intro to CS')).toBeInTheDocument();
    });
    expect(screen.getByText('MATH 201 - Linear Algebra')).toBeInTheDocument();
  });
});
