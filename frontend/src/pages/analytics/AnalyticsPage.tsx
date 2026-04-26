import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, Target, Users, TrendingUp,
  AlertTriangle, Brain, RefreshCw, GraduationCap
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { isTutor as checkIsTutor } from '@/lib/rbac';

export default function AnalyticsPage() {
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const user = useAuthStore((s) => s.user);
  const isTutor = checkIsTutor(user);

  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get('/analytics/overview').then((r) => r.data.data),
  });

  const { data: myCourses = [] } = useQuery({
    queryKey: ['my-courses'],
    queryFn: () => api.get('/courses/my-courses').then((r) => r.data.data),
  });

  const { data: suggestions = [] } = useQuery({
    queryKey: ['analytics-suggestions'],
    queryFn: () => api.get('/analytics/suggestions').then((r) => r.data.data),
    enabled: !isTutor,
  });

  const { data: courseAnalytics } = useQuery({
    queryKey: ['analytics-course', selectedCourseId],
    queryFn: () =>
      api.get(`/analytics/courses/${selectedCourseId}`).then((r) => r.data.data),
    enabled: !!selectedCourseId,
  });

  // ── Different stat cards based on role ──
  const statCards = isTutor
    ? [
        { label: 'Courses Teaching', value: overview?.totalCoursesTeaching ?? '–', icon: BookOpen, color: 'text-primary' },
        { label: 'Total Students', value: overview?.totalStudents ?? '–', icon: GraduationCap, color: 'text-accent' },
        { label: 'Avg Class Attendance', value: overview ? `${overview.avgClassAttendance}%` : '–', icon: Users, color: 'text-warning' },
        { label: 'Avg Class CT', value: overview?.avgClassCT ?? '–', icon: TrendingUp, color: 'text-primary' },
      ]
    : [
        { label: 'Total Courses', value: overview?.totalCourses ?? '–', icon: BookOpen, color: 'text-primary' },
        { label: 'Avg Attendance', value: overview ? `${overview.avgAttendance}%` : '–', icon: Users, color: 'text-accent' },
        { label: 'Avg CT Score', value: overview?.avgCT ?? '–', icon: TrendingUp, color: 'text-warning' },
        { label: 'Topics Mastered', value: overview ? `${overview.topicsMastered}/${overview.totalTopics}` : '–', icon: Target, color: 'text-primary' },
      ];

  return (
    <div>
      <h1 className="page-title mb-6">Analytics</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((stat) => (
          <div key={stat.label} className="card flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-bg-main flex items-center justify-center">
              <stat.icon size={24} className={stat.color} />
            </div>
            <div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-text-secondary">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Suggestions — students only */}
      {!isTutor && suggestions.length > 0 && (
        <div className="card mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={18} className="text-warning" />
            Study Recommendations
          </h2>
          <div className="space-y-2">
            {suggestions.slice(0, 6).map((s: any) => {
              const priorityStyles: Record<string, string> = {
                high: 'border-l-danger bg-red-50/50',
                medium: 'border-l-warning bg-yellow-50/50',
                low: 'border-l-primary bg-blue-50/50',
              };
              const priorityStyle = priorityStyles[s.priority as string] || '';
              const Icon = s.type === 'study' ? Brain : RefreshCw;
              const actionLink = `/ai-tutor?topicId=${s.topicId}&courseId=${s.courseId}`;

              return (
                <Link
                  key={`${s.topicId}-${s.type}`}
                  to={actionLink}
                  className={`block border-l-4 rounded-r-lg p-3 hover:opacity-80 transition-opacity ${priorityStyle}`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className="text-text-secondary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.title}</p>
                      <p className="text-xs text-text-secondary">{s.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.priority === 'high' ? 'bg-red-100 text-red-700' :
                        s.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {s.priority}
                      </span>
                      <p className="text-xs text-text-muted mt-1">{Math.round(s.expertiseLevel * 100)}%</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Course selector */}
      <div className="card mb-6">
        <h2 className="font-semibold mb-3">Course Analytics</h2>
        <select
          className="input max-w-sm"
          value={selectedCourseId}
          onChange={(e) => setSelectedCourseId(e.target.value)}
        >
          <option value="">Select a course...</option>
          {myCourses.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.courseCode} - {c.courseName}
            </option>
          ))}
        </select>
      </div>

      {/* ── Tutor: Student performance table ── */}
      {isTutor && courseAnalytics?.role === 'TUTOR' && (
        <div className="space-y-6">
          {/* Class averages */}
          <div className="card">
            <h3 className="font-semibold mb-4">Class Averages</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-bg-main rounded-lg p-4 text-center">
                <p className="text-sm text-text-secondary">Attendance</p>
                <p className="text-3xl font-bold mt-1">{courseAnalytics.classAverages.attendancePercent}%</p>
              </div>
              {courseAnalytics.courseType === 'THEORY' && (
                <div className="bg-bg-main rounded-lg p-4 text-center">
                  <p className="text-sm text-text-secondary">Avg CT</p>
                  <p className="text-3xl font-bold mt-1">{courseAnalytics.classAverages.avgCT}</p>
                </div>
              )}
              {courseAnalytics.courseType === 'LAB' && (
                <div className="bg-bg-main rounded-lg p-4 text-center">
                  <p className="text-sm text-text-secondary">Avg Lab</p>
                  <p className="text-3xl font-bold mt-1">{courseAnalytics.classAverages.avgLab}</p>
                </div>
              )}
            </div>
          </div>

          {/* Student breakdown table */}
          <div className="card">
            <h3 className="font-semibold mb-4">
              Student Performance ({courseAnalytics.totalStudents} students)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-3 font-medium text-text-secondary">Name</th>
                    <th className="py-2 px-3 font-medium text-text-secondary">Roll</th>
                    <th className="py-2 px-3 font-medium text-text-secondary text-center">Attendance</th>
                    {courseAnalytics.courseType === 'THEORY' && (
                      <>
                        <th className="py-2 px-3 font-medium text-text-secondary text-center">CT1</th>
                        <th className="py-2 px-3 font-medium text-text-secondary text-center">CT2</th>
                        <th className="py-2 px-3 font-medium text-text-secondary text-center">CT3</th>
                      </>
                    )}
                    {courseAnalytics.courseType === 'LAB' && (
                      <th className="py-2 px-3 font-medium text-text-secondary text-center">Lab</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {courseAnalytics.students.map((s: any) => (
                    <tr key={s.userId} className="border-b border-border/50 hover:bg-bg-main/50">
                      <td className="py-2 px-3 font-medium">{s.name}</td>
                      <td className="py-2 px-3 text-text-secondary">{s.rollNumber || '–'}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.attendancePercent >= 75 ? 'bg-green-100 text-green-700' :
                          s.attendancePercent >= 50 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {s.attendancePercent}% ({s.present}/{s.totalClasses})
                        </span>
                      </td>
                      {courseAnalytics.courseType === 'THEORY' && (
                        <>
                          <td className="py-2 px-3 text-center">{s.ctScore1 ?? '–'}</td>
                          <td className="py-2 px-3 text-center">{s.ctScore2 ?? '–'}</td>
                          <td className="py-2 px-3 text-center">{s.ctScore3 ?? '–'}</td>
                        </>
                      )}
                      {courseAnalytics.courseType === 'LAB' && (
                        <td className="py-2 px-3 text-center">{s.labScore ?? '–'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {courseAnalytics.students.length === 0 && (
                <p className="text-text-muted text-sm py-8 text-center">No students enrolled yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Student: Personal analytics charts ── */}
      {!isTutor && courseAnalytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Topic expertise */}
          <div className="card">
            <h3 className="font-semibold mb-4">Topic Expertise (with decay)</h3>
            {courseAnalytics.topicAnalytics?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={courseAnalytics.topicAnalytics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="title"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip
                    formatter={(v: any) => `${(Number(v) * 100).toFixed(0)}%`}
                    labelFormatter={(l: any) => `Topic: ${l}`}
                  />
                  <Bar dataKey="expertiseLevel" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Current" />
                  <Bar dataKey="rawExpertise" fill="#93C5FD" radius={[4, 4, 0, 0]} name="Original" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-text-muted text-sm py-8 text-center">No topic data yet</p>
            )}
          </div>

          {/* Attendance chart */}
          <div className="card">
            <h3 className="font-semibold mb-4">
              Attendance ({courseAnalytics.attendancePercentage}%)
            </h3>
            {courseAnalytics.attendanceData?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Present', value: courseAnalytics.attendanceData.filter((a: any) => a.present).length },
                      { name: 'Absent', value: courseAnalytics.attendanceData.filter((a: any) => !a.present).length },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label
                  >
                    <Cell fill="#10B981" />
                    <Cell fill="#EF4444" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-text-muted text-sm py-8 text-center">No attendance data</p>
            )}
          </div>

          {/* CT Scores */}
          {courseAnalytics.enrollment && (
            <div className="card lg:col-span-2">
              <h3 className="font-semibold mb-4">
                {courseAnalytics.courseType === 'LAB' ? 'Lab Score' : 'Class Test Scores'}
              </h3>
              <div className={`grid gap-4 ${
                courseAnalytics.courseType === 'LAB'
                  ? 'grid-cols-1 sm:grid-cols-1 max-w-xs'
                  : 'grid-cols-2 sm:grid-cols-3'
              }`}>
                {courseAnalytics.courseType === 'THEORY' && [
                  { label: 'CT 1', value: courseAnalytics.enrollment.ctScore1 },
                  { label: 'CT 2', value: courseAnalytics.enrollment.ctScore2 },
                  { label: 'CT 3', value: courseAnalytics.enrollment.ctScore3 },
                ].map((item) => (
                  <div key={item.label} className="bg-bg-main rounded-lg p-4 text-center">
                    <p className="text-sm text-text-secondary">{item.label}</p>
                    <p className="text-3xl font-bold mt-1">
                      {item.value != null ? item.value : '–'}
                    </p>
                  </div>
                ))}
                {courseAnalytics.courseType === 'LAB' && (
                  <div className="bg-bg-main rounded-lg p-4 text-center">
                    <p className="text-sm text-text-secondary">Lab</p>
                    <p className="text-3xl font-bold mt-1">
                      {courseAnalytics.enrollment.labScore != null ? courseAnalytics.enrollment.labScore : '–'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
