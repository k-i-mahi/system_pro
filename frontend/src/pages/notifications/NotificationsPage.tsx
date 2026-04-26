import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Info, BookOpen, MessageSquare, Clock, FlaskConical, FileText, Lightbulb, Upload, Megaphone, ClipboardCheck, CheckCircle, XCircle } from 'lucide-react';
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

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: invalidateAll,
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      invalidateAll();
      toast.success('All marked as read');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`),
    onSuccess: () => {
      invalidateAll();
      toast.success('Notification deleted');
    },
  });

  const classResponseMutation = useMutation({
    mutationFn: (payload: {
      notificationId: string;
      action: 'attended' | 'missed';
      topicCovered?: string;
      materialNeeded?: boolean;
      materialRequest?: string;
      notes?: string;
    }) => api.post('/notifications/class-response', payload),
    onSuccess: (_data, variables) => {
      invalidateAll();
      setActiveResponseId(null);
      setResponseForm({ topicCovered: '', materialNeeded: false, materialRequest: '', notes: '' });
      toast.success(
        variables.action === 'missed'
          ? 'Marked as missed class'
          : 'Response submitted and attendance recorded'
      );
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
        <div className="card mx-auto max-w-md py-12 text-center">
          <Bell size={48} className="mx-auto mb-3 text-text-muted" />
          <p className="text-text-primary font-medium">No notifications yet</p>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            When you open this page, we sync class and lab reminders for today from your schedule. You will also see
            prompts after class, material updates from instructors, and community announcements.
          </p>
          <p className="mt-2 text-xs text-text-muted">
            If today has no classes in your routine, the list can stay empty until one is scheduled.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif: any) => {
            const Icon = ICON_MAP[notif.type] || Info;
            const isAttendancePrompt = Boolean(notif.metadata?.attendancePrompt);
            const hasClassResponse = Boolean(notif.metadata?.classResponse);
            const isMissedClass = Boolean(notif.metadata?.missedClass);
            const isFollowup = Boolean(notif.metadata?.isFollowup);
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
                  {(notif.metadata?.deepLink || notif.metadata?.communityId) && !notif.metadata?.attendancePrompt && (
                    <div className="mt-2">
                      <Link
                        to={notif.metadata?.deepLink || `/community/${notif.metadata.communityId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {notif.metadata?.kind === 'COURSE_MARKS_UPLOADED'
                          ? 'View my marks'
                          : notif.metadata?.kind === 'COURSE_MATERIAL_UPLOADED'
                            ? 'Open course materials'
                            : notif.metadata?.kind === 'CLASSROOM_ANNOUNCEMENT'
                              ? 'Open classroom'
                              : notif.type === 'MATERIAL_UPLOAD_PROMPT'
                                ? 'Go to community'
                                : notif.metadata?.communityId
                                  ? 'Open classroom'
                                  : 'Open'}
                      </Link>
                    </div>
                  )}
                  {isAttendancePrompt && (
                    <div className="mt-3 rounded-md border border-border bg-bg-main p-3">
                      {/* Already resolved states */}
                      {isMissedClass ? (
                        <p className="text-xs text-text-muted flex items-center gap-1">
                          <XCircle size={12} className="text-red-400" /> Marked as missed class
                        </p>
                      ) : hasClassResponse ? (
                        <div>
                          <p className="text-xs font-semibold text-primary flex items-center gap-1">
                            <CheckCircle size={12} /> Attended — response submitted
                          </p>
                          {notif.metadata.classResponse?.topicCovered && (
                            <p className="text-xs text-text-secondary mt-1">
                              Topic: {notif.metadata.classResponse.topicCovered}
                            </p>
                          )}
                        </div>
                      ) : (
                        /* Unresolved — show CTA */
                        <>
                          {isFollowup && (
                            <p className="text-xs text-amber-600 font-medium mb-2">
                              Follow-up reminder — still waiting for your response.
                            </p>
                          )}
                          {!formOpen ? (
                            <div className="flex flex-wrap gap-2">
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
                                I attended
                              </button>
                              <button
                                className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50"
                                disabled={classResponseMutation.isPending}
                                onClick={() =>
                                  classResponseMutation.mutate({
                                    notificationId: notif.id,
                                    action: 'missed',
                                  })
                                }
                              >
                                {classResponseMutation.isPending ? 'Saving…' : 'I missed class'}
                              </button>
                              {notif.metadata?.courseId && (
                                <Link
                                  to={`/courses/${notif.metadata.courseId}`}
                                  className="btn-secondary text-xs"
                                >
                                  Open course
                                </Link>
                              )}
                            </div>
                          ) : (
                            /* "I attended" topic form */
                            <div className="space-y-2">
                              <p className="text-xs text-text-secondary font-medium">
                                What topic was covered today?
                              </p>
                              <input
                                className="input text-xs"
                                placeholder="e.g. Linked Lists, Chapter 3..."
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
                                I need course material for this topic
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
                                className="input py-2 text-xs min-h-[64px]"
                                placeholder="Optional note for your teacher"
                                value={responseForm.notes}
                                onChange={(e) =>
                                  setResponseForm((prev) => ({ ...prev, notes: e.target.value }))
                                }
                              />
                              <div className="flex gap-2">
                                <button
                                  className="btn-primary text-xs"
                                  disabled={responseForm.topicCovered.trim().length < 2 || classResponseMutation.isPending}
                                  onClick={() =>
                                    classResponseMutation.mutate({
                                      notificationId: notif.id,
                                      action: 'attended',
                                      topicCovered: responseForm.topicCovered,
                                      materialNeeded: responseForm.materialNeeded,
                                      materialRequest: responseForm.materialRequest || undefined,
                                      notes: responseForm.notes || undefined,
                                    })
                                  }
                                >
                                  {classResponseMutation.isPending ? 'Submitting…' : 'Submit'}
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
