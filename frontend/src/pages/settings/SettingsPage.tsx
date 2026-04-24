import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock, Bell as BellIcon, School } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth.store';

interface SettingsData {
  language?: string;
  timezone?: string;
  timeFormat?: string;
  dateFormat?: string;
  notifChat?: boolean;
  notifNewestUpdate?: boolean;
  notifMentorOfMonth?: boolean;
  notifCourseOfMonth?: boolean;
}

const TABS = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'password', label: 'Password', icon: Lock },
  { id: 'notifications', label: 'Notifications', icon: BellIcon },
  { id: 'integrations', label: 'Integrations', icon: School },
];

interface GoogleClassroomCourse {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  alternateLink?: string;
  courseState?: string;
}

interface GoogleAssignment {
  id: string;
  title: string;
  description?: string;
  alternateLink?: string;
  workType?: string;
  state?: string;
  dueAt?: string;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const [activeTab, setActiveTab] = useState('general');
  const [generalForm, setGeneralForm] = useState({
    language: 'en',
    timezone: 'Asia/Dhaka',
    timeFormat: 'H12',
    dateFormat: 'DD_MM_YYYY',
  });
  const [notificationsForm, setNotificationsForm] = useState({
    notifChat: true,
    notifNewestUpdate: true,
    notifMentorOfMonth: true,
    notifCourseOfMonth: true,
  });
  const [selectedGoogleCourseId, setSelectedGoogleCourseId] = useState('');
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  const { data: settings, isLoading, isError, refetch, error } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data.data),
    retry: false,
  });

  useEffect(() => {
    if (!error) return;
    const err: any = error;
    const status = err?.response?.status;
    const msg = err?.response?.data?.error?.message || '';
    if (status === 401 || (status === 404 && /user not found/i.test(msg))) {
      toast.error('Your session/account is no longer valid. Please log in again.');
      logout();
      window.location.href = '/login';
    }
  }, [error, logout]);

  useEffect(() => {
    if (!settings) return;
    setGeneralForm({
      language: settings.language || 'en',
      timezone: settings.timezone || 'Asia/Dhaka',
      timeFormat: settings.timeFormat || 'H12',
      dateFormat: settings.dateFormat || 'DD_MM_YYYY',
    });
    setNotificationsForm({
      notifChat: settings.notifChat ?? true,
      notifNewestUpdate: settings.notifNewestUpdate ?? true,
      notifMentorOfMonth: settings.notifMentorOfMonth ?? true,
      notifCourseOfMonth: settings.notifCourseOfMonth ?? true,
    });
  }, [settings]);

  const generalMutation = useMutation({
    mutationFn: (data: any) => api.patch('/settings/general', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const passwordMutation = useMutation({
    mutationFn: (data: any) => api.patch('/settings/password', data),
    onSuccess: () => {
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password updated');
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message || 'Failed'),
  });

  const notifMutation = useMutation({
    mutationFn: (data: any) => api.patch('/settings/notifications', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Notification preferences saved');
    },
    onError: () => toast.error('Failed to save notification settings'),
  });

  const { data: googleStatus, refetch: refetchGoogleStatus } = useQuery<{ connected: boolean }>({
    queryKey: ['google-classroom-status'],
    queryFn: () => api.get('/google-classroom/status').then((r) => r.data.data),
    retry: false,
  });

  const { data: googleCourses, isLoading: googleCoursesLoading, refetch: refetchGoogleCourses } = useQuery<
    GoogleClassroomCourse[]
  >({
    queryKey: ['google-classroom-courses'],
    queryFn: () => api.get('/google-classroom/courses').then((r) => r.data.data),
    enabled: Boolean(googleStatus?.connected),
    retry: false,
  });

  const {
    data: googleAssignments,
    isLoading: googleAssignmentsLoading,
    refetch: refetchGoogleAssignments,
  } = useQuery<GoogleAssignment[]>({
    queryKey: ['google-classroom-assignments', selectedGoogleCourseId],
    queryFn: () =>
      api.get(`/google-classroom/courses/${selectedGoogleCourseId}/assignments`).then((r) => r.data.data),
    enabled: Boolean(googleStatus?.connected && selectedGoogleCourseId),
    retry: false,
  });

  const connectGoogleMutation = useMutation({
    mutationFn: () => api.get('/google-classroom/connect-url').then((r) => r.data.data.url as string),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Failed to start Google connect flow'),
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: () => api.delete('/google-classroom/disconnect'),
    onSuccess: async () => {
      toast.success('Google Classroom disconnected');
      await refetchGoogleStatus();
      await refetchGoogleCourses();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Failed to disconnect'),
  });

  const importAssignmentMutation = useMutation({
    mutationFn: (payload: {
      googleCourseId: string;
      googleCourseName: string;
      assignmentTitle: string;
      dueAt: string;
    }) => api.post('/google-classroom/import-assignment', payload),
    onSuccess: async () => {
      toast.success('Assignment imported to routine');
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      await queryClient.invalidateQueries({ queryKey: ['my-courses'] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error?.message || 'Failed to import assignment to routine'),
  });

  useEffect(() => {
    if (!googleCourses?.length) {
      if (selectedGoogleCourseId) setSelectedGoogleCourseId('');
      return;
    }
    if (!selectedGoogleCourseId || !googleCourses.some((c) => c.id === selectedGoogleCourseId)) {
      setSelectedGoogleCourseId(googleCourses[0].id);
    }
  }, [googleCourses, selectedGoogleCourseId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('googleClassroom');
    if (!status) return;
    if (status === 'connected') {
      toast.success('Google Classroom connected');
      refetchGoogleStatus();
      refetchGoogleCourses();
    } else if (status === 'error') {
      toast.error('Google Classroom connection failed');
    }
    url.searchParams.delete('googleClassroom');
    window.history.replaceState({}, '', url.toString());
  }, [refetchGoogleCourses, refetchGoogleStatus]);


  function handlePasswordSubmit() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    passwordMutation.mutate({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
  }

  return (
    <div>
      <h1 className="page-title mb-6">Settings</h1>

      <div className="flex gap-6">
        {/* Tab sidebar */}
        <div className="w-48 shrink-0">
          <div className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary text-white'
                    : 'text-text-secondary hover:bg-bg-main'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          {isLoading && (
            <div className="card">
              <p className="text-text-muted">Loading settings...</p>
            </div>
          )}

          {isError && (
            <div className="card">
              <p className="text-danger mb-3">Could not load settings.</p>
              <button className="btn-secondary" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          )}

          {activeTab === 'general' && settings && (
            <div className="card">
              <h2 className="font-semibold mb-4">General Settings</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="label">Language</label>
                  <select
                    className="input"
                    value={generalForm.language}
                    onChange={(e) => setGeneralForm((prev) => ({ ...prev, language: e.target.value }))}
                  >
                    <option value="en">English</option>
                    <option value="bn">Bangla</option>
                  </select>
                </div>
                <div>
                  <label className="label">Timezone</label>
                  <select
                    className="input"
                    value={generalForm.timezone}
                    onChange={(e) => setGeneralForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  >
                    <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                    <option value="UTC">UTC</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Time Format</label>
                  <select
                    className="input"
                    value={generalForm.timeFormat}
                    onChange={(e) => setGeneralForm((prev) => ({ ...prev, timeFormat: e.target.value }))}
                  >
                    <option value="H12">12 Hour</option>
                    <option value="H24">24 Hour</option>
                  </select>
                </div>
                <div>
                  <label className="label">Date Format</label>
                  <select
                    className="input"
                    value={generalForm.dateFormat}
                    onChange={(e) => setGeneralForm((prev) => ({ ...prev, dateFormat: e.target.value }))}
                  >
                    <option value="DD_MM_YYYY">DD/MM/YYYY</option>
                    <option value="MM_DD_YYYY">MM/DD/YYYY</option>
                    <option value="YYYY_MM_DD">YYYY-MM-DD</option>
                  </select>
                </div>
                <button
                  onClick={() => generalMutation.mutate(generalForm)}
                  className="btn-primary"
                  disabled={generalMutation.isPending}
                >
                  {generalMutation.isPending ? 'Saving...' : 'Save General Settings'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'password' && (
            <div className="card">
              <h2 className="font-semibold mb-4">Change Password</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="label">Current Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, oldPassword: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                    minLength={8}
                  />
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                  />
                </div>
                <button
                  onClick={handlePasswordSubmit}
                  className="btn-primary"
                  disabled={!passwordForm.oldPassword || !passwordForm.newPassword || passwordMutation.isPending}
                >
                  {passwordMutation.isPending ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && settings && (
            <div className="card">
              <h2 className="font-semibold mb-4">Notification Preferences</h2>
              <div className="space-y-4">
                {[
                  { key: 'notifChat', label: 'Chat notifications' },
                  { key: 'notifNewestUpdate', label: 'Newest updates' },
                  { key: 'notifMentorOfMonth', label: 'Mentor of the month' },
                  { key: 'notifCourseOfMonth', label: 'Course of the month' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-3 py-2 hover:bg-bg-main"
                  >
                    <span className="text-sm text-text-primary">{item.label}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
                      checked={(notificationsForm as Record<string, boolean>)[item.key] ?? true}
                      onChange={(e) =>
                        setNotificationsForm((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() => notifMutation.mutate(notificationsForm)}
                  className="btn-primary mt-2"
                  disabled={notifMutation.isPending}
                >
                  {notifMutation.isPending ? 'Saving...' : 'Save Notification Settings'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="card">
              <h2 className="font-semibold mb-4">Google Classroom</h2>
              <p className="text-sm text-text-secondary mb-4">
                Connect your Google account to fetch your active Google Classroom courses.
              </p>

              <div className="flex items-center gap-3 mb-5">
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                    googleStatus?.connected ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {googleStatus?.connected ? 'Connected' : 'Not connected'}
                </span>
                {!googleStatus?.connected ? (
                  <button
                    className="btn-primary"
                    onClick={() => connectGoogleMutation.mutate()}
                    disabled={connectGoogleMutation.isPending}
                  >
                    {connectGoogleMutation.isPending ? 'Connecting...' : 'Connect Google Classroom'}
                  </button>
                ) : (
                  <button
                    className="btn-secondary"
                    onClick={() => disconnectGoogleMutation.mutate()}
                    disabled={disconnectGoogleMutation.isPending}
                  >
                    {disconnectGoogleMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                )}
              </div>

              {googleStatus?.connected && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Imported Classroom Courses</h3>
                    <button className="btn-secondary" onClick={() => refetchGoogleCourses()}>
                      Refresh
                    </button>
                  </div>
                  {googleCoursesLoading && <p className="text-sm text-text-muted">Loading courses...</p>}
                  {!googleCoursesLoading && (!googleCourses || googleCourses.length === 0) && (
                    <p className="text-sm text-text-muted">No active Google Classroom courses found.</p>
                  )}
                  {!!googleCourses?.length && (
                    <div className="space-y-2">
                      {googleCourses.map((course) => (
                        <div
                          key={course.id}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium">{course.name}</p>
                            <p className="text-xs text-text-secondary">
                              {[course.section, course.descriptionHeading].filter(Boolean).join(' | ') || 'No details'}
                            </p>
                          </div>
                          {course.alternateLink && (
                            <a
                              className="text-sm text-primary hover:underline"
                              href={course.alternateLink}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Classroom
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!!googleCourses?.length && (
                    <div className="mt-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium">Assignments & Due Dates</h3>
                        <button
                          className="btn-secondary"
                          onClick={() => refetchGoogleAssignments()}
                          disabled={!selectedGoogleCourseId}
                        >
                          Refresh
                        </button>
                      </div>
                      <div>
                        <label className="label">Select Classroom</label>
                        <select
                          className="input"
                          value={selectedGoogleCourseId}
                          onChange={(e) => setSelectedGoogleCourseId(e.target.value)}
                        >
                          {googleCourses.map((course) => (
                            <option key={course.id} value={course.id}>
                              {course.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {googleAssignmentsLoading && (
                        <p className="text-sm text-text-muted">Loading assignments...</p>
                      )}
                      {!googleAssignmentsLoading && (!googleAssignments || googleAssignments.length === 0) && (
                        <p className="text-sm text-text-muted">No assignments found for this classroom.</p>
                      )}
                      {!!googleAssignments?.length && (
                        <div className="space-y-2">
                          {googleAssignments.map((assignment) => (
                            <div
                              key={assignment.id}
                              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                            >
                              <div>
                                <p className="text-sm font-medium">{assignment.title}</p>
                                <p className="text-xs text-text-secondary">
                                  {assignment.dueAt
                                    ? `Due: ${new Date(assignment.dueAt).toLocaleString()}`
                                    : 'No due date'}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                {assignment.dueAt && (
                                  <button
                                    type="button"
                                    className="text-sm text-primary hover:underline disabled:opacity-50"
                                    disabled={importAssignmentMutation.isPending}
                                    onClick={() =>
                                      selectedGoogleCourseId &&
                                      assignment.dueAt &&
                                      importAssignmentMutation.mutate({
                                        googleCourseId: selectedGoogleCourseId,
                                        googleCourseName:
                                          googleCourses?.find((c) => c.id === selectedGoogleCourseId)?.name ||
                                          'Google Classroom Course',
                                        assignmentTitle: assignment.title || 'Assignment',
                                        dueAt: assignment.dueAt,
                                      })
                                    }
                                  >
                                    Import to Routine
                                  </button>
                                )}
                                {assignment.alternateLink && (
                                  <a
                                    className="text-sm text-primary hover:underline"
                                    href={assignment.alternateLink}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
