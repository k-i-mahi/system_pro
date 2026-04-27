import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CourseDetailPage from '../../src/pages/courses/CourseDetailPage';

const { mockGet, mockPost, mockDelete, mockPatch, mockStudentUser } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDelete: vi.fn(),
  mockPatch: vi.fn(),
  mockStudentUser: { id: 'student-1', role: 'STUDENT' as const, email: 'student@test.edu' },
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: Object.assign(
    vi.fn((selector: (s: { user: typeof mockStudentUser | null }) => unknown) =>
      selector({
        user: mockStudentUser,
      })
    ),
    {
      getState: () => ({ user: mockStudentUser }),
      setState: vi.fn(),
    },
  ),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
    patch: mockPatch,
  },
}));

const mockCourseTheory = {
  id: 'c1',
  courseCode: 'CS 101',
  courseName: 'Intro to Computer Science',
  description: 'Learn the basics of CS',
  viewerRole: 'STUDENT',
  isTeaching: false,
  enrollment: {
    ctScore1: 17,
    ctScore2: 15,
    ctScore3: null,
    labScore: 35,
    studentTheoryMarks: { classTest1: 17, classTest2: 15, classTest3: null, assignment: 35 },
  },
  topics: [
    {
      id: 'tp1',
      title: 'My study notes',
      description: 'Personal',
      status: 'IN_PROGRESS',
      orderIndex: 0,
      isPersonal: true,
      createdBy: 'student-1',
      materials: [],
      topicProgress: [{ expertiseLevel: 0.5 }],
    },
    {
      id: 't1',
      title: 'Algorithms',
      description: 'Sorting and searching',
      status: 'DONE',
      orderIndex: 1,
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
      orderIndex: 2,
      materials: [],
      topicProgress: [{ expertiseLevel: 0.4 }],
    },
  ],
};

const mockCourseLab = {
  ...mockCourseTheory,
  id: 'c-lab',
  courseCode: 'CS 102L',
  courseName: 'Intro Lab',
  courseType: 'LAB',
  enrollment: {
    id: 'enr-lab',
    ctScore1: 1,
    ctScore2: 2,
    ctScore3: 3,
    labScore: 4,
    studentLabMarks: { labTest: 8, labQuiz: 7, assignment: 25 },
  },
};

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
    mockGet.mockResolvedValue({ data: { data: mockCourseTheory } });
    mockPost.mockResolvedValue({ data: { data: {} } });
    mockDelete.mockResolvedValue({ data: { data: {} } });
    mockPatch.mockImplementation((url: string) => {
      if (String(url).includes('my-theory-marks')) {
        return Promise.resolve({
          data: {
            data: {
              studentTheoryMarks: mockCourseTheory.enrollment.studentTheoryMarks,
            },
          },
        });
      }
      return Promise.resolve({
        data: { data: { studentLabMarks: { labTest: 8, labQuiz: 7, assignment: 25 } } },
      });
    });
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
      expect(screen.getByText('CS 101')).toBeInTheDocument();
    });
  });

  it('renders back to courses link', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Back to Courses')).toBeInTheDocument();
    });
  });

  it('theory course renders theory assessment labels in My Scores', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('My Scores')).toBeInTheDocument();
    });
    expect(screen.getByRole('columnheader', { name: 'Official' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Your entry' })).toBeInTheDocument();
    expect(screen.getByText('Class Test 1')).toBeInTheDocument();
    expect(screen.getByText('Class Test 2')).toBeInTheDocument();
    expect(screen.getByText('Class Test 3')).toBeInTheDocument();
    expect(screen.getByText('Assignment/Spot Test')).toBeInTheDocument();
    expect(screen.queryByText('Lab / Assignment')).not.toBeInTheDocument();
  });

  it('lab course renders lab assessment labels in My Scores', async () => {
    mockGet.mockResolvedValue({ data: { data: mockCourseLab } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/courses/c-lab']}>
          <Routes>
            <Route path="/courses/:courseId" element={<CourseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByText('My Scores')).toBeInTheDocument();
    });
    expect(screen.getByText('Lab Test')).toBeInTheDocument();
    expect(screen.getByText('Lab Quiz')).toBeInTheDocument();
    expect(screen.getByText('Assignment')).toBeInTheDocument();
    expect(screen.queryByText('Class Test 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Class Test 3')).not.toBeInTheDocument();
  });

  it('lab course shows inputs and PATCHes Save / Clear for student-owned marks', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({ data: { data: mockCourseLab } });
    mockPatch.mockImplementation((url: string, body: unknown) => {
      if (String(url).includes('my-lab-marks')) {
        return Promise.resolve({
          data: {
            data: {
              studentLabMarks:
                body && typeof body === 'object' && body !== null && 'labTest' in body && (body as { labTest: number }).labTest === 16
                  ? { labTest: 16, labQuiz: 7, assignment: 25 }
                  : body &&
                      typeof body === 'object' &&
                      body !== null &&
                      'labQuiz' in body &&
                      (body as { labQuiz: null }).labQuiz === null
                    ? { labTest: 8, labQuiz: null, assignment: 25 }
                    : mockCourseLab.enrollment.studentLabMarks,
            },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/courses/c-lab']}>
          <Routes>
            <Route path="/courses/:courseId" element={<CourseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText('Lab Test')).toBeInTheDocument());

    const labTestRow = screen.getByText('Lab Test').closest('tr');
    expect(labTestRow).toBeTruthy();
    const labTestInput = within(labTestRow as HTMLElement).getByRole('spinbutton', { name: /Lab Test mark/i });
    expect(labTestInput).toHaveValue(8);

    await user.clear(labTestInput);
    await user.type(labTestInput, '16');
    await user.click(within(labTestRow as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/courses/c-lab/my-lab-marks', { labTest: 16 });
    });

    const labQuizRow = screen.getByText('Lab Quiz').closest('tr');
    await user.click(within(labQuizRow as HTMLElement).getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/courses/c-lab/my-lab-marks', { labQuiz: null });
    });
  });

  it('renders topic count', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Course Schedule & Topics (3)')).toBeInTheDocument();
    });
  });

  it('renders topic titles', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Algorithms')).toBeInTheDocument();
    });
    expect(screen.getByText('Data Structures')).toBeInTheDocument();
    expect(screen.getByText('My study notes')).toBeInTheDocument();
  });

  it('shows add topic for enrolled student', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Add Topic')).toBeInTheDocument();
    });
  });

  it('shows score progress percentage from enrollment', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('85%').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
  });

  it('shows independent Uploading rows for simultaneous multi-file upload until each completes', async () => {
    const user = userEvent.setup();
    const resolvers: Array<(v: unknown) => void> = [];
    mockPost.mockImplementation((url: string) => {
      if (String(url).includes('/materials')) {
        return new Promise((resolve) => {
          resolvers.push((value) => resolve(value));
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('My study notes')).toBeInTheDocument());

    await user.click(screen.getByText('My study notes'));

    const uploadSection = screen.getByText('Materials (0)').closest('div')?.parentElement;
    expect(uploadSection).toBeTruthy();
    const fileInput = within(uploadSection as HTMLElement).getByLabelText(/upload file/i);

    const f1 = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const f2 = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, [f1, f2]);

    await waitFor(() => {
      expect(screen.getAllByText('Uploading…')).toHaveLength(2);
    });
    expect(screen.getByText('one.pdf')).toBeInTheDocument();
    expect(screen.getByText('two.pdf')).toBeInTheDocument();

    expect(resolvers.length).toBe(2);
    resolvers[0]({ data: { data: {} } });

    await waitFor(() => {
      expect(screen.getAllByText('Uploading…')).toHaveLength(1);
    });
    expect(screen.queryByText('one.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('two.pdf')).toBeInTheDocument();

    resolvers[1]({ data: { data: {} } });

    await waitFor(() => {
      expect(screen.queryAllByText('Uploading…')).toHaveLength(0);
    });
  });

  it('failed upload for one file leaves other in-flight upload showing Uploading', async () => {
    const user = userEvent.setup();
    let materialsCalls = 0;
    const resolvers: Array<(v: unknown) => void> = [];
    mockPost.mockImplementation((url: string) => {
      if (String(url).includes('/materials')) {
        materialsCalls += 1;
        if (materialsCalls === 1) {
          return Promise.reject({ response: { data: { error: { message: 'Upload failed' } } } });
        }
        return new Promise((resolve) => {
          resolvers.push((value) => resolve(value));
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('My study notes')).toBeInTheDocument());
    await user.click(screen.getByText('My study notes'));

    const uploadSection = screen.getByText('Materials (0)').closest('div')?.parentElement;
    const fileInput = within(uploadSection as HTMLElement).getByLabelText(/upload file/i);

    const f1 = new File(['a'], 'first.pdf', { type: 'application/pdf' });
    const f2 = new File(['b'], 'second.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, [f1, f2]);

    await waitFor(() => {
      expect(screen.getAllByText('Uploading…')).toHaveLength(1);
    });
    expect(screen.getByText('second.pdf')).toBeInTheDocument();

    resolvers[0]({ data: { data: {} } });
    await waitFor(() => {
      expect(screen.queryAllByText('Uploading…')).toHaveLength(0);
    });
  });
});
