import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Bell, BookOpen, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

interface Community {
  id: string;
  name: string;
  courseCode: string;
  session: string;
  department: string;
  university: string;
  course?: { courseCode: string; courseName: string } | null;
  _count?: { members: number };
}

interface TutorOverview {
  role: string;
  totalCoursesTeaching?: number;
  totalStudents?: number;
  avgClassAttendance?: number | null;
  avgClassCT?: number | null;
}

function greeting(name: string): string {
  const h = new Date().getHours();
  if (h < 12) return `Good morning, ${name}`;
  if (h < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

export default function TutorDashboardPage() {
  const { user } = useAuthStore();

  const { data: communities = [], isLoading: loadingCommunities } = useQuery<Community[]>({
    queryKey: ['communities', 'my'],
    queryFn: () =>
      api.get('/community', { params: { tab: 'my', limit: 100 } }).then((r) => r.data.data ?? []),
  });

  const { data: overview } = useQuery<TutorOverview>({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get('/analytics/overview').then((r) => r.data.data),
  });

  const statCards = [
    {
      label: 'Classrooms',
      value: communities.length,
      color: 'text-primary',
    },
    {
      label: 'Total Students',
      value: overview?.totalStudents ?? '—',
      color: 'text-blue-600',
    },
    {
      label: 'Avg Attendance',
      value:
        overview?.avgClassAttendance != null
          ? `${overview.avgClassAttendance.toFixed(1)}%`
          : '—',
      color: 'text-green-600',
    },
    {
      label: 'Avg Class CT',
      value:
        overview?.avgClassCT != null
          ? overview.avgClassCT.toFixed(1)
          : '—',
      color: 'text-amber-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">{greeting(user?.name ?? 'Tutor')}</h1>
        <p className="text-text-secondary text-sm mt-1">Here's your classroom overview for today.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="card text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Link to="/community" className="btn-secondary flex items-center gap-2 text-sm">
          <Bell size={15} /> Post Announcement
        </Link>
        <Link to="/community" className="btn-secondary flex items-center gap-2 text-sm">
          <BookOpen size={15} /> Upload Marks
        </Link>
        <Link to="/analytics" className="btn-secondary flex items-center gap-2 text-sm">
          <BarChart3 size={15} /> View Analytics
        </Link>
      </div>

      {/* Classrooms grid */}
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-3">Your Classrooms</h2>
        {loadingCommunities ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card animate-pulse h-32 bg-bg-main" />
            ))}
          </div>
        ) : communities.length === 0 ? (
          <div className="card text-center py-10">
            <Users size={40} className="mx-auto text-text-muted mb-2" />
            <p className="text-text-secondary">No classrooms yet.</p>
            <Link to="/community" className="btn-primary mt-4 inline-block">
              Create a classroom
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {communities.map((c) => (
              <Link
                key={c.id}
                to={`/community/${c.id}`}
                className="card hover:ring-2 hover:ring-primary/30 transition-all block"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="badge bg-primary-light text-primary">{c.courseCode}</span>
                  <span className="text-xs text-text-muted">{c.session}</span>
                </div>
                <h3 className="font-semibold text-sm leading-snug">{c.name}</h3>
                <p className="text-xs text-text-muted mt-1">
                  {c.department} · {c.university}
                </p>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-text-secondary text-xs">
                    {c._count?.members ?? 0} members
                  </span>
                  <span className="text-primary text-xs font-medium">Open →</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
