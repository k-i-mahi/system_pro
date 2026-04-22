import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock, Bell as BellIcon } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const TABS = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'password', label: 'Password', icon: Lock },
  { id: 'notifications', label: 'Notifications', icon: BellIcon },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('general');
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data.data),
  });

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
  });

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
          {activeTab === 'general' && settings && (
            <div className="card">
              <h2 className="font-semibold mb-4">General Settings</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="label">Language</label>
                  <select
                    className="input"
                    defaultValue={settings.language || 'en'}
                    onChange={(e) => generalMutation.mutate({ language: e.target.value })}
                  >
                    <option value="en">English</option>
                    <option value="bn">Bangla</option>
                  </select>
                </div>
                <div>
                  <label className="label">Timezone</label>
                  <select
                    className="input"
                    defaultValue={settings.timezone || 'Asia/Dhaka'}
                    onChange={(e) => generalMutation.mutate({ timezone: e.target.value })}
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
                    defaultValue={settings.timeFormat || 'H12'}
                    onChange={(e) => generalMutation.mutate({ timeFormat: e.target.value })}
                  >
                    <option value="H12">12 Hour</option>
                    <option value="H24">24 Hour</option>
                  </select>
                </div>
                <div>
                  <label className="label">Date Format</label>
                  <select
                    className="input"
                    defaultValue={settings.dateFormat || 'DD_MM_YYYY'}
                    onChange={(e) => generalMutation.mutate({ dateFormat: e.target.value })}
                  >
                    <option value="DD_MM_YYYY">DD/MM/YYYY</option>
                    <option value="MM_DD_YYYY">MM/DD/YYYY</option>
                    <option value="YYYY_MM_DD">YYYY-MM-DD</option>
                  </select>
                </div>
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
                  disabled={!passwordForm.oldPassword || !passwordForm.newPassword}
                >
                  Update Password
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
                  <label key={item.key} className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm">{item.label}</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={settings[item.key] ?? true}
                        onChange={(e) => notifMutation.mutate({ [item.key]: e.target.checked })}
                      />
                      <div className="w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary transition-colors" />
                      <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform" />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
