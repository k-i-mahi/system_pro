import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, FileText, GraduationCap, LibraryBig, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { isTutor as checkIsTutor } from '@/lib/rbac';

export default function CoursesPage() {
  const user = useAuthStore((state) => state.user);
  const isTutor = checkIsTutor(user);

  const { data: myCourses = [], isLoading } = useQuery({
    queryKey: ['my-courses'],
    queryFn: () => api.get('/courses/my-courses').then((r) => r.data.data),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{isTutor ? 'Teaching Courses' : 'My Courses'}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {isTutor
              ? 'Manage topics, materials, and course updates for the courses you teach.'
              : 'Open your enrolled courses, study materials, and latest results.'}
          </p>
        </div>
        {isTutor && (
          <Link to="/community" className="btn-primary">
            Manage Classrooms
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-text-muted">Loading courses...</div>
      ) : myCourses.length === 0 ? (
        <div className="card py-12 text-center">
          <BookOpen size={48} className="mx-auto mb-3 text-text-muted" />
          <p className="text-text-secondary">
            {isTutor ? 'No teaching courses yet' : 'No enrolled courses yet'}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {isTutor ? (
              <>
                Create a classroom from <Link to="/community" className="text-primary hover:underline">Classrooms</Link> to start teaching.
              </>
            ) : (
              <>
                Go to <Link to="/routine" className="text-primary hover:underline">My Routine</Link> to scan or add courses.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {myCourses.map((course: any) => {
            const isTeachingCourse = Boolean(course.isTeaching);

            return (
              <div key={course.id} className="card group transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-primary-light text-xs font-mono text-primary">
                      {course.courseCode}
                    </span>
                    {isTeachingCourse && (
                      <span className="badge bg-emerald-100 text-xs text-emerald-700">
                        Teaching
                      </span>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-text-muted transition-colors group-hover:text-primary" />
                </div>

                <Link to={`/courses/${course.id}`} className="block">
                  <h3 className="mb-2 font-semibold text-text-primary transition-colors group-hover:text-primary">
                    {course.courseName}
                  </h3>
                </Link>

                {isTeachingCourse ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-xs text-text-muted">
                      <div className="rounded-lg bg-bg-main px-3 py-2 text-center">
                        <div className="mb-1 flex items-center justify-center gap-1">
                          <Users size={12} />
                          <span>Students</span>
                        </div>
                        <p className="text-sm font-semibold text-text-primary">{course.studentCount || 0}</p>
                      </div>
                      <div className="rounded-lg bg-bg-main px-3 py-2 text-center">
                        <div className="mb-1 flex items-center justify-center gap-1">
                          <LibraryBig size={12} />
                          <span>Topics</span>
                        </div>
                        <p className="text-sm font-semibold text-text-primary">{course.totalTopics || 0}</p>
                      </div>
                      <div className="rounded-lg bg-bg-main px-3 py-2 text-center">
                        <div className="mb-1 flex items-center justify-center gap-1">
                          <FileText size={12} />
                          <span>Materials</span>
                        </div>
                        <p className="text-sm font-semibold text-text-primary">{course.materialCount || 0}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm">
                      <Link to={`/courses/${course.id}`} className="text-primary hover:underline">
                        Open course workspace
                      </Link>
                      {course.communityId && (
                        <Link to={`/community/${course.communityId}`} className="text-text-secondary hover:text-primary">
                          Open classroom
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <GraduationCap size={14} />
                    <span>{course.totalTopics || 0} topics</span>
                    {course.completedTopics > 0 && (
                      <span className="text-accent">· {course.completedTopics} completed</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
