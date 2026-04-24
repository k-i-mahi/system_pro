import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Info, BookOpen, MessageSquare, Clock, FlaskConical, FileText, Lightbulb, Upload, Megaphone, ClipboardCheck } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { useEffect, useState } from 'react';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  NEW_COURSE: BookOpen,
  MESSAGE: MessageSquare,
  SYSTEM: Info,
  MY_COURSE: BookOpen,
  CLASS_REMINDER: Clock,
  LAB_REMINDER: FlaskConical,
  EXAM_REMINDER: FileText,
  TOPIC_SUGGESTION: Lightbulb,
  MATERIAL_UPLOAD_PROMPT: Upload,
  ANNOUNCEMENT: Megaphone,
  ATTENDANCE_ALERT: ClipboardCheck,
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [responseForm, setResponseForm] = useState({
    topicCovered: '',
    materialNeeded: false,
    materialRequest: '',
    notes: '',
  });

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data.data),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All marked as read');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notification deleted');
    },
  });

  const classResponseMutation = useMutation({
    mutationFn: (payload: {
      notificationId: string;
      topicCovered: string;
      materialNeeded: boolean;
      materialRequest?: string;
      notes?: string;
    }) => api.post('/notifications/class-response', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      setActiveResponseId(null);
      setResponseForm({ topicCovered: '', materialNeeded: false, materialRequest: '', notes: '' });
      toast.success('Response submitted and attendance recorded');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to submit class response');
    },
  });

  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  useEffect(() => {
    queryClient.setQueryData(['notifications-unread-count'], unreadCount);
  }, [queryClient, unreadCount]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="text-sm text-text-secondary mt-1">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllMutation.mutate()}
            className="btn-secondary flex items-center gap-2"
          >
            <CheckCheck size={18} />
            Mark all as read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Loading...</div>
      ) : notifications.length === 0 ? (
        <div className="card text-center py-12">
          <Bell size={48} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-secondary">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif: any) => {
            const Icon = ICON_MAP[notif.type] || Info;
            const isAttendancePrompt = Boolean(notif.metadata?.attendancePrompt);
            const hasClassResponse = Boolean(notif.metadata?.classResponse);
            const formOpen = activeResponseId === notif.id;
            return (
              <div
                key={notif.id}
                className={`card flex items-start gap-4 ${!notif.isRead ? 'border-l-4 border-l-primary' : ''}`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    !notif.isRead ? 'bg-primary-light' : 'bg-bg-main'
                  }`}
                >
                  <Icon size={18} className={!notif.isRead ? 'text-primary' : 'text-text-muted'} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm font-medium ${!notif.isRead ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {notif.title}
                  </h3>
                  <p className="text-sm text-text-secondary mt-0.5">{notif.body}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                  </p>
                  {(notif.metadata?.deepLink || notif.metadata?.communityId) && (
                    <div className="mt-2">
                      <Link
                        to={notif.metadata?.deepLink || `/community/${notif.metadata.communityId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open recommendation
                      </Link>
                    </div>
                  )}
                  {isAttendancePrompt && (
                    <div className="mt-3 rounded-md border border-border bg-bg-main p-3">
                      {hasClassResponse ? (
                        <div>
                          <p className="text-xs font-semibold text-primary">Response submitted</p>
                          <p className="text-xs text-text-secondary mt-1">
                            Topic: {notif.metadata.classResponse.topicCovered}
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-text-secondary mb-2">
                            Submit attendance response for today&apos;s class.
                          </p>
                          {!formOpen ? (
                            <button
                              className="btn-secondary text-xs"
                              onClick={() => {
                                setActiveResponseId(notif.id);
                                setResponseForm({
                                  topicCovered: '',
                                  materialNeeded: false,
                                  materialRequest: '',
                                  notes: '',
                                });
                              }}
                            >
                              Submit class response
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <input
                                className="input text-xs"
                                placeholder="What topic was covered today?"
                                value={responseForm.topicCovered}
                                onChange={(e) =>
                                  setResponseForm((prev) => ({ ...prev, topicCovered: e.target.value }))
                                }
                              />
                              <label className="flex items-center gap-2 text-xs text-text-secondary">
                                <input
                                  type="checkbox"
                                  checked={responseForm.materialNeeded}
                                  onChange={(e) =>
                                    setResponseForm((prev) => ({ ...prev, materialNeeded: e.target.checked }))
                                  }
                                />
                                Need course material for this topic
                              </label>
                              {responseForm.materialNeeded && (
                                <input
                                  className="input text-xs"
                                  placeholder="What material do you need?"
                                  value={responseForm.materialRequest}
                                  onChange={(e) =>
                                    setResponseForm((prev) => ({ ...prev, materialRequest: e.target.value }))
                                  }
                                />
                              )}
                              <textarea
                                className="input py-2 text-xs min-h-[70px]"
                                placeholder="Optional note for teacher"
                                value={responseForm.notes}
                                onChange={(e) =>
                                  setResponseForm((prev) => ({ ...prev, notes: e.target.value }))
                                }
                              />
                              <div className="flex gap-2">
                                <button
                                  className="btn-primary text-xs"
                                  disabled={!responseForm.topicCovered.trim() || classResponseMutation.isPending}
                                  onClick={() =>
                                    classResponseMutation.mutate({
                                      notificationId: notif.id,
                                      topicCovered: responseForm.topicCovered,
                                      materialNeeded: responseForm.materialNeeded,
                                      materialRequest: responseForm.materialRequest || undefined,
                                      notes: responseForm.notes || undefined,
                                    })
                                  }
                                >
                                  {classResponseMutation.isPending ? 'Submitting...' : 'Submit'}
                                </button>
                                <button
                                  className="btn-secondary text-xs"
                                  onClick={() => setActiveResponseId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!notif.isRead && (
                    <button
                      onClick={() => markReadMutation.mutate(notif.id)}
                      className="p-1.5 hover:bg-bg-main rounded-lg text-text-muted"
                      title="Mark as read"
                    >
                      <CheckCheck size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteMutation.mutate(notif.id)}
                    className="p-1.5 hover:bg-bg-main rounded-lg text-text-muted hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
