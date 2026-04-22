import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from '../../src/pages/settings/SettingsPage';

const mockSettings = {
  language: 'en',
  timezone: 'Asia/Dhaka',
  timeFormat: 'H12',
  dateFormat: 'DD_MM_YYYY',
  notifChat: true,
  notifNewestUpdate: true,
  notifMentorOfMonth: false,
  notifCourseOfMonth: false,
};

vi.mock('../../src/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: mockSettings } })),
    patch: vi.fn(() => Promise.resolve({ data: { data: mockSettings } })),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    renderPage();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders all three tabs', () => {
    renderPage();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('shows general settings by default', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument();
    });
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Timezone')).toBeInTheDocument();
    expect(screen.getByText('Time Format')).toBeInTheDocument();
    expect(screen.getByText('Date Format')).toBeInTheDocument();
  });

  it('switches to password tab', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Password'));
    expect(screen.getByText('Change Password')).toBeInTheDocument();
    expect(screen.getByText('Current Password')).toBeInTheDocument();
    expect(screen.getByText('New Password')).toBeInTheDocument();
    expect(screen.getByText('Confirm New Password')).toBeInTheDocument();
  });

  it('switches to notifications tab', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
    });
    expect(screen.getByText('Chat notifications')).toBeInTheDocument();
    expect(screen.getByText('Newest updates')).toBeInTheDocument();
    expect(screen.getByText('Mentor of the month')).toBeInTheDocument();
    expect(screen.getByText('Course of the month')).toBeInTheDocument();
  });

  it('has Update Password button in password tab', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText('Password'));
    expect(screen.getByText('Update Password')).toBeInTheDocument();
  });

  it('renders language options', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument();
    });
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Bangla')).toBeInTheDocument();
  });

  it('renders date format options', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('General Settings')).toBeInTheDocument();
    });
    expect(screen.getByText('DD/MM/YYYY')).toBeInTheDocument();
    expect(screen.getByText('MM/DD/YYYY')).toBeInTheDocument();
    expect(screen.getByText('YYYY-MM-DD')).toBeInTheDocument();
  });
});
