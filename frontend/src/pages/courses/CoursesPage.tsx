import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, FileText } from 'lucide-react';
import api from '@/lib/api';

export default function CoursesPage() {
  const { data: myCourses = [], isLoading } = useQuery({
    queryKey: ['my-courses'],
    queryFn: () => api.get('/courses/my-courses').then((r) => r.data.data),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">My Courses</h1>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Loading courses...</div>
      ) : myCourses.length === 0 ? (
        <div className="card text-center py-12">
          <BookOpen size={48} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-secondary">No enrolled courses yet</p>
          <p className="text-sm text-text-muted mt-1">
            Go to <Link to="/routine" className="text-primary hover:underline">My Routine</Link> to scan or add courses
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {myCourses.map((course: any) => (
            <Link
              key={course.id}
              to={`/courses/${course.id}`}
              className="card hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="badge bg-primary-light text-primary text-xs font-mono">
                  {course.courseCode}
                </span>
                <ChevronRight size={16} className="text-text-muted group-hover:text-primary transition-colors" />
              </div>
              <h3 className="font-semibold text-text-primary group-hover:text-primary transition-colors mb-2">
                {course.courseName}
              </h3>
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <FileText size={14} />
                <span>{course.totalTopics || 0} topics</span>
                {course.completedTopics > 0 && (
                  <span className="text-accent">· {course.completedTopics} completed</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
