/**
 * Normalize API course type for branching. Backend should send `THEORY` | `LAB`;
 * this tolerates alternate JSON shapes from proxies or older payloads.
 */
export function normalizeCourseType(raw: unknown): 'LAB' | 'THEORY' {
  if (raw == null || raw === '') return 'THEORY';
  let v: unknown = raw;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    v = (raw as { value: unknown }).value;
  }
  const s = String(v).trim().toUpperCase();
  if (s === 'LAB') return 'LAB';
  return 'THEORY';
}

export function rawCourseTypeField(course: { courseType?: unknown; course_type?: unknown }): unknown {
  return course.courseType ?? course.course_type;
}

export function isLabCourse(course: { courseType?: unknown; course_type?: unknown }): boolean {
  return normalizeCourseType(rawCourseTypeField(course)) === 'LAB';
}
