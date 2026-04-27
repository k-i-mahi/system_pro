import { useState, useCallback, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import type { DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CalendarDays, Clock, MapPin, Trash2, Plus, X, GripVertical, AlertTriangle, Pencil, CheckCheck } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth.store';

export function routineDraftStorageKey(userId: string | undefined) {
  return userId ? `routine-draft-v1:${userId}` : 'routine-draft-v1:anonymous';
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ScheduleSlot {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  type: string;
  room?: string;
}

type ScheduleSlotApi = Partial<ScheduleSlot> & {
  day_of_week?: string;
  start_time?: string;
  end_time?: string;
  course_id?: string;
  course_code?: string;
  course_name?: string;
};

interface SlotForm {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  type: 'CLASS' | 'LAB';
  room: string;
  isAlternating: boolean;
}

interface CourseForm {
  courseCode: string;
  courseName: string;
  slots: SlotForm[];
}

interface DraftSlotConflict {
  courseIdx: number;
  slotIdx: number;
  message: string;
}

interface ScannedCode {
  id: number;
  code: string;
  selected: boolean;
  editing: boolean;
  draft: string;
}

interface ConflictInfo {
  slotId: string;
  targetDay: string;
  conflicts: { id: string; courseId: string; startTime: string; endTime: string; type: string; room?: string }[];
}
interface ConflictEditForm {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  type: 'CLASS' | 'LAB';
  room: string;
}

interface AlternatingPrompt {
  courseIdx: number;
  slotIdx: number;
  conflictLabel: string;
  conflictingKey?: string;
}

function emptySlot(): SlotForm {
  return { dayOfWeek: 'MON', startTime: '09:00', endTime: '10:30', type: 'CLASS', room: '', isAlternating: false };
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Pure 24-hour comparison — end must be strictly after start. */
function isValidRange(startTime: string, endTime: string) {
  return timeToMinutes(endTime) > timeToMinutes(startTime);
}

function isOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aStartMin = timeToMinutes(aStart);
  const aEndMin = timeToMinutes(aEnd);
  const bStartMin = timeToMinutes(bStart);
  const bEndMin = timeToMinutes(bEnd);
  return aStartMin < bEndMin && aEndMin > bStartMin;
}

function clampSegment(raw: string, max: number): string {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 2);
  if (!digits) return '';
  const n = Math.min(max, Math.max(0, Number.parseInt(digits, 10) || 0));
  return String(n);
}


type TimeSeg = 'sh' | 'sm' | 'eh' | 'em';
const SEG_RIGHT: Record<TimeSeg, TimeSeg> = { sh: 'sm', sm: 'eh', eh: 'em', em: 'sh' };
const SEG_LEFT: Record<TimeSeg, TimeSeg> = { sm: 'sh', eh: 'sm', em: 'eh', sh: 'em' };

export default function RoutinePage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const isTutorViewer = useAuthStore((s) => s.user?.role === 'TUTOR');
  const draftKey = routineDraftStorageKey(userId);
  const [showUpload, setShowUpload] = useState(false);
  const [coursesForms, setCoursesForms] = useState<CourseForm[]>([]);
  const [scannedCodes, setScannedCodes] = useState<ScannedCode[]>([]);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictInfo | null>(null);
  const [showConflictEdit, setShowConflictEdit] = useState(false);
  const [conflictEditForm, setConflictEditForm] = useState<ConflictEditForm>({
    dayOfWeek: 'MON',
    startTime: '09:00',
    endTime: '10:00',
    type: 'CLASS',
    room: '',
  });
  const slotDayRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  const segmentRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const courseCardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [pendingSlotFocusKey, setPendingSlotFocusKey] = useState<string | null>(null);
  const [ocrStep, setOcrStep] = useState(0);
  const ocrSteps = ['Detecting text zones...', 'Extracting course codes...', 'Preparing review panel...'];
  const [alternatingPrompt, setAlternatingPrompt] = useState<AlternatingPrompt | null>(null);
  const conflictEditDayRef = useRef<HTMLSelectElement | null>(null);
  const conflictEditTypeRef = useRef<HTMLSelectElement | null>(null);
  const conflictEditStartRef = useRef<HTMLInputElement | null>(null);
  const conflictEditEndRef = useRef<HTMLInputElement | null>(null);
  const conflictEditRoomRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!pendingSlotFocusKey) return;
    const target = slotDayRefs.current[pendingSlotFocusKey];
    if (target) target.focus();
    setPendingSlotFocusKey(null);
  }, [coursesForms, pendingSlotFocusKey]);

  useEffect(() => {
    if (isTutorViewer && showUpload) setShowUpload(false);
  }, [isTutorViewer, showUpload]);

  // Restore draft per logged-in user so navigation/reload keep in-progress routine edits.
  // Logout no longer wipes this key (see auth store); switching accounts uses a different key.
  useEffect(() => {
    if (!userId) {
      setDraftLoaded(false);
      return;
    }
    setDraftLoaded(false);
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          showUpload?: boolean;
          coursesForms?: CourseForm[];
          scannedCodes?: ScannedCode[];
          manualCodeInput?: string;
        };
        if (typeof draft.showUpload === 'boolean') setShowUpload(draft.showUpload);
        if (Array.isArray(draft.coursesForms)) setCoursesForms(draft.coursesForms);
        if (Array.isArray(draft.scannedCodes)) setScannedCodes(draft.scannedCodes);
        if (typeof draft.manualCodeInput === 'string') setManualCodeInput(draft.manualCodeInput);
      }
    } catch {
      // Ignore broken draft payloads.
    } finally {
      setDraftLoaded(true);
    }
  }, [userId, draftKey]);

  // Persist draft to localStorage after initial hydration — guard prevents overwriting
  // a valid saved draft with empty initial state on the very first render.
  useEffect(() => {
    if (!userId || !draftLoaded) return;
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ showUpload, coursesForms, scannedCodes, manualCodeInput })
    );
  }, [userId, draftKey, draftLoaded, showUpload, coursesForms, scannedCodes, manualCodeInput]);

  const { data: schedule = [], isLoading, isError } = useQuery({
    queryKey: ['schedule'],
    queryFn: (): Promise<ScheduleSlot[]> =>
      api.get('/routine/').then((r) => {
        const raw = (r.data.data ?? []) as ScheduleSlotApi[];
        return raw.map((slot) => ({
          id: slot.id ?? '',
          courseId: slot.courseId ?? slot.course_id ?? '',
          courseCode: slot.courseCode ?? slot.course_code ?? '',
          courseName: slot.courseName ?? slot.course_name ?? '',
          dayOfWeek: (slot.dayOfWeek ?? slot.day_of_week ?? '').toUpperCase(),
          startTime: slot.startTime ?? slot.start_time ?? '',
          endTime: slot.endTime ?? slot.end_time ?? '',
          type: slot.type ?? 'CLASS',
          room: slot.room,
        }));
      }),
  });

  const scanMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post('/routine/scan', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      const codes: string[] = res.data.data.extractedCodes;
      setShowUpload(false);
      if (codes.length === 0) {
        toast('No course codes detected — add manually below.', { icon: '📋' });
        setCoursesForms([{ courseCode: '', courseName: '', slots: [emptySlot()] }]);
        return;
      }
      toast.success(`Detected ${codes.length} course code(s) — review and select below`);
      setScannedCodes(
        codes.map((code, i) => ({ id: i, code, selected: true, editing: false, draft: code }))
      );
    },
    onError: () => {
      toast('OCR failed — add your course manually below.', { icon: '📋' });
      setCoursesForms([{ courseCode: '', courseName: '', slots: [emptySlot()] }]);
      setShowUpload(false);
    },
  });

  useEffect(() => {
    if (!scanMutation.isPending) {
      setOcrStep(0);
      return;
    }
    const timer = window.setInterval(() => {
      setOcrStep((s) => (s + 1) % ocrSteps.length);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [scanMutation.isPending]);

  const saveCoursesMutation = useMutation({
    mutationFn: (courses: CourseForm[]) =>
      api.post('/routine/courses', { courses }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['my-courses'] });
      setCoursesForms([]);
      setScannedCodes([]);
      setManualCodeInput('');
      setShowUpload(false);
      window.localStorage.removeItem(routineDraftStorageKey(useAuthStore.getState().user?.id));
      toast.success('Courses and schedule saved!');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message || 'Failed to save courses';
      if (String(msg).toLowerCase().includes('schedule conflict')) {
        toast.error('Schedule conflict: check routine properly and enter a free valid slot.');
        return;
      }
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/routine/slots/${slotId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Slot removed');
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: (courseId: string) => api.delete(`/routine/courses/${courseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['my-courses'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['course'] });
      toast.success('Course removed from your plan, routine, classrooms, and related reminders.');
    },
    onError: () => toast.error('Could not remove this course from your plan.'),
  });

  const moveSlotMutation = useMutation({
    mutationFn: ({ slotId, dayOfWeek, resolveConflicts }: { slotId: string; dayOfWeek: string; resolveConflicts?: string }) =>
      api.put(`/routine/slots/${slotId}/move`, { dayOfWeek, resolveConflicts }),
    onSuccess: (res) => {
      const { resolved, conflicts, targetDay, slot } = res.data.data;
      if (!resolved && conflicts?.length > 0) {
        const src = schedule.find((s) => s.id === slot.id);
        setConflictDialog({
          slotId: slot.id,
          targetDay: targetDay || '',
          conflicts,
        });
        setConflictEditForm({
          dayOfWeek: targetDay || src?.dayOfWeek || 'MON',
          startTime: src?.startTime || '09:00',
          endTime: src?.endTime || '10:00',
          type: (src?.type as 'CLASS' | 'LAB') || 'CLASS',
          room: src?.room || '',
        });
        setShowConflictEdit(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      setConflictDialog(null);
      setShowConflictEdit(false);
      toast.success('Slot moved!');
    },
    onError: () => toast.error('Failed to move slot'),
  });

  const updateSlotMutation = useMutation({
    mutationFn: ({
      slotId,
      payload,
    }: {
      slotId: string;
      payload: { dayOfWeek: string; startTime: string; endTime: string; type: 'CLASS' | 'LAB'; room?: string };
    }) => api.put(`/routine/slots/${slotId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      setConflictDialog(null);
      setShowConflictEdit(false);
      toast.success('Time slot updated and saved.');
    },
    onError: () => toast.error('Failed to update slot'),
  });

  function resolveConflict(strategy: 'override' | 'shift' | 'swap') {
    if (!conflictDialog) return;
    moveSlotMutation.mutate({
      slotId: conflictDialog.slotId,
      dayOfWeek: conflictDialog.targetDay,
      resolveConflicts: strategy,
    });
  }

  const hasValidEditRange = conflictEditForm.startTime < conflictEditForm.endTime;
  const editedConflictCount = conflictDialog
    ? schedule.filter(
        (s) =>
          s.id !== conflictDialog.slotId &&
          s.dayOfWeek === conflictEditForm.dayOfWeek &&
          conflictEditForm.startTime < s.endTime &&
          conflictEditForm.endTime > s.startTime
      ).length
    : 0;

  function focusConflictField(field: 'day' | 'type' | 'start' | 'end' | 'room') {
    const refMap = {
      day: conflictEditDayRef,
      type: conflictEditTypeRef,
      start: conflictEditStartRef,
      end: conflictEditEndRef,
      room: conflictEditRoomRef,
    } as const;
    refMap[field].current?.focus();
  }

  function handleConflictArrowNav(
    e: KeyboardEvent<HTMLElement>,
    field: 'day' | 'type' | 'start' | 'end' | 'room'
  ) {
    const nav: Record<string, Partial<Record<'day' | 'type' | 'start' | 'end' | 'room', 'day' | 'type' | 'start' | 'end' | 'room'>>> = {
      ArrowLeft: { type: 'day', end: 'start' },
      ArrowRight: { day: 'type', start: 'end' },
      ArrowUp: { start: 'day', end: 'type', room: 'start' },
      ArrowDown: { day: 'start', type: 'end', start: 'room', end: 'room' },
    };
    const next = nav[e.key]?.[field];
    if (next) {
      e.preventDefault();
      focusConflictField(next);
    }
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, slotId: string) {
    e.dataTransfer.setData('slotId', slotId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDay(day);
  }

  function handleDragLeave() {
    setDragOverDay(null);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, targetDay: string) {
    e.preventDefault();
    setDragOverDay(null);
    const slotId = e.dataTransfer.getData('slotId');
    if (!slotId) return;
    // Find the slot's current day to avoid no-op
    const currentSlot = schedule.find((s) => s.id === slotId);
    if (currentSlot && currentSlot.dayOfWeek === targetDay) return;
    moveSlotMutation.mutate({ slotId, dayOfWeek: targetDay });
  }

  const onDrop = useCallback(
    (files: File[]) => {
      if (files[0]) scanMutation.mutate(files[0]);
    },
    [scanMutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg'], 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const coursesInSchedule = useMemo(() => {
    const m = new Map<string, { courseId: string; courseCode: string; courseName: string }>();
    for (const s of schedule) {
      if (s.courseId && !m.has(s.courseId)) {
        m.set(s.courseId, {
          courseId: s.courseId,
          courseCode: s.courseCode,
          courseName: s.courseName,
        });
      }
    }
    return [...m.values()];
  }, [schedule]);

  // Group schedule by day
  const grouped = DAYS.reduce(
    (acc, day) => {
      acc[day] = schedule.filter((s) => s.dayOfWeek === day);
      return acc;
    },
    {} as Record<string, ScheduleSlot[]>
  );

  function updateCourseForm(idx: number, field: keyof CourseForm, value: CourseForm[keyof CourseForm]) {
    setCoursesForms((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  }

  function updateSlotForm(courseIdx: number, slotIdx: number, field: keyof SlotForm, value: SlotForm[keyof SlotForm]) {
    setCoursesForms((prev) =>
      prev.map((c, ci) =>
        ci === courseIdx
          ? { ...c, slots: c.slots.map((s, si) => (si === slotIdx ? { ...s, [field]: value } : s)) }
          : c
      )
    );
  }

  function addSlot(courseIdx: number) {
    setCoursesForms((prev) =>
      prev.map((c, i) => {
        if (i !== courseIdx) return c;
        const nextSlotIndex = c.slots.length;
        setPendingSlotFocusKey(`${courseIdx}-${nextSlotIndex}`);
        return { ...c, slots: [...c.slots, emptySlot()] };
      })
    );
  }

  function focusCourseCard(courseIdx: number) {
    courseCardRefs.current[courseIdx]?.focus();
  }

  function handleCourseCardArrowNav(e: KeyboardEvent<HTMLElement>, courseIdx: number) {
    if (e.key === 'ArrowUp' && courseIdx > 0) {
      e.preventDefault();
      focusCourseCard(courseIdx - 1);
    } else if (e.key === 'ArrowDown' && courseIdx < coursesForms.length - 1) {
      e.preventDefault();
      focusCourseCard(courseIdx + 1);
    }
  }

  function focusSegment(courseIdx: number, slotIdx: number, seg: TimeSeg) {
    const el = segmentRefs.current[`${courseIdx}-${slotIdx}-${seg}`];
    if (el) {
      el.focus();
      try {
        el.select();
      } catch {
        // Ignore selection errors on unsupported inputs.
      }
    }
  }

  function handleSegmentArrowNav(
    e: KeyboardEvent<HTMLInputElement>,
    courseIdx: number,
    slotIdx: number,
    seg: TimeSeg,
  ) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusSegment(courseIdx, slotIdx, SEG_RIGHT[seg]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusSegment(courseIdx, slotIdx, SEG_LEFT[seg]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = e.key === 'ArrowUp' ? courseIdx - 1 : courseIdx + 1;
      if (nextIdx < 0 || nextIdx >= coursesForms.length) return;
      const targetSlotIdx = Math.min(
        slotIdx,
        (coursesForms[nextIdx]?.slots.length ?? 1) - 1,
      );
      const el = segmentRefs.current[`${nextIdx}-${targetSlotIdx}-${seg}`];
      if (el) {
        el.focus();
        try {
          el.select();
        } catch {
          // Ignore selection errors on unsupported inputs.
        }
      } else {
        focusCourseCard(nextIdx);
      }
    }
  }

  function updateTimeSegment(
    courseIdx: number,
    slotIdx: number,
    field: 'startTime' | 'endTime',
    part: 'hour' | 'minute',
    rawValue: string,
  ) {
    const max = part === 'hour' ? 12 : 59;
    const cleaned = clampSegment(rawValue, max);
    setCoursesForms((prev) =>
      prev.map((c, i) => {
        if (i !== courseIdx) return c;
        return {
          ...c,
          slots: c.slots.map((s, j) => {
            if (j !== slotIdx) return s;
            // Split current stored "HH:MM" (or partial "HH:M") to get raw parts.
            const [h24Raw, rawMin] = (s[field] || '00:00').split(':');
            if (part === 'hour') {
              // Convert 12h input → 24h, keeping raw stored minute (never pad mid-type).
              const ampm = parseInt(h24Raw || '0', 10) >= 12 ? 'PM' : 'AM';
              let h = parseInt(cleaned || '12', 10) % 12;
              if (ampm === 'PM') h += 12;
              return { ...s, [field]: `${String(h).padStart(2, '0')}:${rawMin ?? '00'}` };
            } else {
              // Keep 24h hour; store raw minute without padding so user can type "40" as "4"→"40".
              return { ...s, [field]: `${h24Raw ?? '00'}:${cleaned}` };
            }
          }),
        };
      }),
    );
  }

  function updateAmPm(
    courseIdx: number,
    slotIdx: number,
    field: 'startTime' | 'endTime',
    ampm: 'AM' | 'PM',
  ) {
    setCoursesForms((prev) =>
      prev.map((c, i) => {
        if (i !== courseIdx) return c;
        return {
          ...c,
          slots: c.slots.map((s, j) => {
            if (j !== slotIdx) return s;
            // Split to preserve raw minute (never re-pad it here).
            const [h24Raw, rawMin] = (s[field] || '00:00').split(':');
            let h = parseInt(h24Raw || '0', 10) % 12;
            if (ampm === 'PM') h += 12;
            return { ...s, [field]: `${String(h).padStart(2, '0')}:${rawMin ?? '00'}` };
          }),
        };
      }),
    );
  }

  function normalizeTimeSegment(
    courseIdx: number,
    slotIdx: number,
    field: 'startTime' | 'endTime',
  ) {
    setCoursesForms((prev) =>
      prev.map((c, i) => {
        if (i !== courseIdx) return c;
        return {
          ...c,
          slots: c.slots.map((s, j) => {
            if (j !== slotIdx) return s;
            // On blur: pad both parts to canonical "HH:MM".
            const [h24Raw, rawMin] = (s[field] || '00:00').split(':');
            const h = parseInt(h24Raw || '0', 10);
            const m = parseInt(rawMin || '0', 10) || 0;
            return { ...s, [field]: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
          }),
        };
      }),
    );
  }

  function removeSlot(courseIdx: number, slotIdx: number) {
    setCoursesForms((prev) =>
      prev.map((c, i) =>
        i === courseIdx ? { ...c, slots: c.slots.filter((_, si) => si !== slotIdx) } : c
      )
    );
  }

  function removeCourse(courseIdx: number) {
    setCoursesForms((prev) => prev.filter((_, i) => i !== courseIdx));
  }

  function handleManualAdd() {
    setCoursesForms((prev) => [...prev, { courseCode: '', courseName: '', slots: [emptySlot()] }]);
    setShowUpload(false);
    if (scanMutation.isPending || scannedCodes.length > 0) {
      toast('Your scan/results are kept. Continue without losing progress.', { icon: '💾' });
    }
  }

  // ── Scanned-code review helpers ──────────────────────────────────────────────
  function toggleCode(id: number) {
    setScannedCodes((prev) => prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)));
  }

  function startEdit(id: number) {
    setScannedCodes((prev) => prev.map((c) => (c.id === id ? { ...c, editing: true } : c)));
  }

  function commitEdit(id: number) {
    setScannedCodes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, code: c.draft.trim().toUpperCase() || c.code, editing: false } : c))
    );
  }

  function updateDraft(id: number, val: string) {
    setScannedCodes((prev) => prev.map((c) => (c.id === id ? { ...c, draft: val.toUpperCase() } : c)));
  }

  function removeScannedCode(id: number) {
    setScannedCodes((prev) => prev.filter((c) => c.id !== id));
  }

  function addManualCode() {
    const code = manualCodeInput.trim().toUpperCase();
    if (!code) return;
    const nextId = scannedCodes.length > 0 ? Math.max(...scannedCodes.map((c) => c.id)) + 1 : 0;
    setScannedCodes((prev) => [...prev, { id: nextId, code, selected: true, editing: false, draft: code }]);
    setManualCodeInput('');
  }

  function confirmSelection() {
    const selected = scannedCodes.filter((c) => c.selected);
    if (selected.length === 0) {
      toast.error('Select at least one course code to continue');
      return;
    }
    setCoursesForms(selected.map((c) => ({ courseCode: c.code, courseName: '', slots: [emptySlot()] })));
    setScannedCodes([]);
  }

  function handleSaveCourses() {
    const invalid = coursesForms.some(
      (c) => !c.courseCode.trim() || !c.courseName.trim() || c.slots.length === 0
    );
    if (invalid) {
      toast.error('Fill in course code, full name, and at least one time slot for each course');
      return;
    }
    if (draftConflicts.length > 0) {
      toast.error('Schedule conflict: check routine properly and enter a free valid slot.');
      return;
    }
    saveCoursesMutation.mutate(coursesForms);
  }

  const showCourseForm = coursesForms.length > 0;
  const showReview = scannedCodes.length > 0 && !showCourseForm;
  const draftConflicts = useMemo<DraftSlotConflict[]>(() => {
    const issues: DraftSlotConflict[] = [];
    const existing = schedule.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      label: s.courseCode || 'Existing course',
    }));
    const draftSeen: { courseIdx: number; slotIdx: number; dayOfWeek: string; startTime: string; endTime: string; label: string; isAlternating: boolean }[] = [];

    coursesForms.forEach((course, courseIdx) => {
      course.slots.forEach((slot, slotIdx) => {
        const prefix = `Course ${course.courseCode || `#${courseIdx + 1}`}, slot ${slotIdx + 1}:`;
        if (!slot.startTime || !slot.endTime || !isValidRange(slot.startTime, slot.endTime)) {
          issues.push({
            courseIdx,
            slotIdx,
            message: `${prefix} end time must be later than start time.`,
          });
          return;
        }

        for (const ex of existing) {
          if (ex.dayOfWeek !== slot.dayOfWeek) continue;
          if (!isOverlap(slot.startTime, slot.endTime, ex.startTime, ex.endTime)) continue;
          // Alternating slots don't conflict with saved slots (they share the day intentionally).
          if (slot.isAlternating) continue;
          issues.push({
            courseIdx,
            slotIdx,
            message: `${prefix} schedule conflict (same day ${slot.dayOfWeek}) with ${ex.label} ${ex.startTime}–${ex.endTime}.`,
          });
          return;
        }

        for (const seen of draftSeen) {
          if (seen.dayOfWeek !== slot.dayOfWeek) continue;
          if (!isOverlap(slot.startTime, slot.endTime, seen.startTime, seen.endTime)) continue;
          // If BOTH sides are alternating weeks, allow the overlap.
          if (slot.isAlternating && seen.isAlternating) continue;
          issues.push({
            courseIdx,
            slotIdx,
            message: `${prefix} schedule conflict (same day ${slot.dayOfWeek}) with ${seen.label} ${seen.startTime}–${seen.endTime}.`,
          });
          return;
        }

        draftSeen.push({
          courseIdx,
          slotIdx,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          label: course.courseCode || `Course #${courseIdx + 1}`,
          isAlternating: slot.isAlternating,
        });
      });
    });

    return issues;
  }, [coursesForms, schedule]);
  const draftConflictMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of draftConflicts) {
      const key = `${c.courseIdx}-${c.slotIdx}`;
      if (!m.has(key)) m.set(key, c.message);
    }
    return m;
  }, [draftConflicts]);

  useEffect(() => {
    if (!showConflictEdit) return;
    const t = window.setTimeout(() => conflictEditDayRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [showConflictEdit]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">My Routine</h1>
        <div className="flex gap-2">
          <button onClick={handleManualAdd} className="btn-secondary flex items-center gap-2">
            <Plus size={18} />
            Add Course
          </button>
          {!isTutorViewer && (
            <button onClick={() => { setShowUpload(!showUpload); setCoursesForms([]); }} className="btn-primary flex items-center gap-2">
              <Upload size={18} />
              Scan Routine
            </button>
          )}
        </div>
      </div>

      {/* Upload area */}
      {!isTutorViewer && showUpload && !showCourseForm && !showReview && (
        <div className="card mb-6">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary bg-primary-light' : 'border-border hover:border-primary'
            }`}
          >
            <input {...getInputProps()} />
            <Upload size={40} className="mx-auto text-text-muted mb-3" />
            <p className="text-text-secondary">
              {scanMutation.isPending
                ? ocrSteps[ocrStep]
                : 'Drop your routine image here, or click to select'}
            </p>
            {scanMutation.isPending && (
              <div className="mt-3 mx-auto w-full max-w-sm">
                <div className="h-2 rounded-full bg-border overflow-hidden">
                  <div className="h-full w-1/2 bg-linear-to-r from-primary to-blue-400 animate-pulse rounded-full" />
                </div>
                <p className="text-[11px] text-text-muted mt-1">Processing OCR in real-time. Please keep this tab open.</p>
              </div>
            )}
            <p className="text-xs text-text-muted mt-1">PNG, JPG, or PDF up to 20MB</p>
          </div>
        </div>
      )}

      {/* OCR review — pick which detected codes to keep */}
      {!isTutorViewer && showReview && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-lg font-semibold">Review Detected Courses</h2>
              <p className="text-sm text-text-muted mt-0.5">
                Select which codes to add. Click a code to toggle, <Pencil size={12} className="inline" /> to correct OCR errors.
              </p>
            </div>
            <button onClick={() => setScannedCodes([])} className="btn-secondary text-sm">Cancel</button>
          </div>

          <div className="flex flex-wrap gap-2 my-4">
            {scannedCodes.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 transition-all text-sm font-mono font-semibold select-none ${
                  c.selected
                    ? 'border-primary bg-primary-light text-primary-dark'
                    : 'border-border bg-bg-main text-text-muted opacity-50'
                }`}
              >
                {c.editing ? (
                  <input
                    autoFocus
                    className="w-24 bg-transparent border-b border-primary outline-none text-sm font-mono"
                    value={c.draft}
                    onChange={(e) => updateDraft(c.id, e.target.value)}
                    onBlur={() => commitEdit(c.id)}
                    onKeyDown={(e) => e.key === 'Enter' && commitEdit(c.id)}
                  />
                ) : (
                  <button className="hover:opacity-80" onClick={() => toggleCode(c.id)} title="Click to toggle">
                    {c.code}
                  </button>
                )}
                <button
                  onClick={() => startEdit(c.id)}
                  className="opacity-40 hover:opacity-100 transition-opacity ml-1"
                  title="Edit code"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => removeScannedCode(c.id)}
                  className="opacity-40 hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mb-5">
            <input
              type="text"
              className="input text-sm flex-1"
              placeholder="OCR missed a code? Type it here, e.g. CSE101"
              value={manualCodeInput}
              onChange={(e) => setManualCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && addManualCode()}
            />
            <button onClick={addManualCode} className="btn-secondary flex items-center gap-1 shrink-0">
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              <span className="font-semibold text-text-primary">{scannedCodes.filter((c) => c.selected).length}</span> of {scannedCodes.length} selected
            </p>
            <button onClick={confirmSelection} className="btn-primary flex items-center gap-2">
              <CheckCheck size={16} />
              Continue with selected
            </button>
          </div>
        </div>
      )}

      {/* Course details form (after scan or manual add) */}
      {showCourseForm && (
        <div className="card mb-6 border border-primary/10 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div>
              <h2 className="text-lg font-semibold text-primary-dark">Complete Course Details</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Add course info and assign conflict-free weekly time slots.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCoursesForms((prev) => [...prev, { courseCode: '', courseName: '', slots: [emptySlot()] }])}
                className="btn-secondary text-sm flex items-center gap-1 transition-all hover:shadow-sm"
              >
                <Plus size={14} />
                Add Another Course
              </button>
              <button
                onClick={() => { setCoursesForms([]); setScannedCodes([]); }}
                className="btn-secondary text-sm transition-all hover:shadow-sm"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {coursesForms.map((course, ci) => (
              <div
                key={ci}
                ref={(el) => {
                  courseCardRefs.current[ci] = el;
                }}
                tabIndex={0}
                onKeyDown={(e) => handleCourseCardArrowNav(e, ci)}
                className="border border-border rounded-xl p-4 relative bg-white/90 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {coursesForms.length > 1 && (
                  <button
                    onClick={() => removeCourse(ci)}
                    className="absolute top-2 right-2 p-1 hover:bg-bg-main rounded transition-colors"
                  >
                    <X size={16} className="text-text-muted" />
                  </button>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="label">Course Code *</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. CSE 101"
                      value={course.courseCode}
                      onChange={(e) => updateCourseForm(ci, 'courseCode', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Full Course Name *</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Introduction to Computer Science"
                      value={course.courseName}
                      onChange={(e) => updateCourseForm(ci, 'courseName', e.target.value)}
                    />
                  </div>
                </div>

                <div className="mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">Time Slots</label>
                    <button
                      onClick={() => addSlot(ci)}
                      className="text-xs text-primary hover:underline flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-primary-light/60 transition-colors"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          addSlot(ci);
                        }
                      }}
                    >
                      <Plus size={12} />
                      Add Slot
                    </button>
                  </div>

                  <div className="space-y-2">
                    {course.slots.map((slot, si) => {
                      const slotConflict = draftConflictMap.get(`${ci}-${si}`);
                      const invalidRange =
                        !slot.startTime || !slot.endTime || !isValidRange(slot.startTime, slot.endTime);
                      // Derive display parts directly from stored string so raw (unpadded)
                      // minutes are shown during live typing (e.g. "4" before completing "40").
                      const [sH24Raw, sMinRaw] = (slot.startTime || '09:00').split(':');
                      const [eH24Raw, eMinRaw] = (slot.endTime || '10:30').split(':');
                      const sH24 = parseInt(sH24Raw || '9', 10);
                      const eH24 = parseInt(eH24Raw || '10', 10);
                      const startHour12 = String(sH24 % 12 || 12);
                      const endHour12 = String(eH24 % 12 || 12);
                      const startAmPm: 'AM' | 'PM' = sH24 >= 12 ? 'PM' : 'AM';
                      const endAmPm: 'AM' | 'PM' = eH24 >= 12 ? 'PM' : 'AM';
                      return (
                      <div
                        key={si}
                        className={`rounded-xl p-3 border transition-all ${
                          slotConflict
                            ? 'border-amber-300 bg-linear-to-r from-amber-50 to-orange-50/60 shadow-sm'
                            : invalidRange
                              ? 'border-danger/40 bg-linear-to-r from-rose-50 to-red-50/60 shadow-sm'
                              : 'border-transparent bg-bg-main hover:border-primary/20 hover:shadow-xs'
                        }`}
                      >
                        <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-24">
                          <label className="text-xs text-text-muted">Day</label>
                          <select
                            className="input text-sm"
                            ref={(el) => {
                              slotDayRefs.current[`${ci}-${si}`] = el;
                            }}
                            value={slot.dayOfWeek}
                            onChange={(e) => updateSlotForm(ci, si, 'dayOfWeek', e.target.value)}
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                        {/* Start Time — 12h + AM/PM */}
                        <div className="min-w-36">
                          <label className="text-xs text-text-muted">Start Time</label>
                          <div className="flex items-center gap-1">
                            <div
                              className={`input text-sm transition-colors flex items-center justify-center gap-0.5 px-2 py-1.5 flex-1 ${
                                invalidRange
                                  ? 'border-danger focus-within:ring-2 focus-within:ring-danger focus-within:border-danger bg-red-50/50'
                                  : 'focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary'
                              }`}
                              aria-invalid={invalidRange}
                            >
                              <input
                                ref={(el) => { segmentRefs.current[`${ci}-${si}-sh`] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                aria-label="Start Time hour"
                                placeholder="h"
                                className="w-6 bg-transparent text-center outline-none tabular-nums"
                                value={startHour12}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => updateTimeSegment(ci, si, 'startTime', 'hour', e.target.value)}
                                onBlur={() => normalizeTimeSegment(ci, si, 'startTime')}
                                onKeyDown={(e) => handleSegmentArrowNav(e, ci, si, 'sh')}
                              />
                              <span className="text-text-muted">:</span>
                              <input
                                ref={(el) => { segmentRefs.current[`${ci}-${si}-sm`] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                aria-label="Start Time minute"
                                placeholder="mm"
                                className="w-7 bg-transparent text-center outline-none tabular-nums"
                                value={sMinRaw ?? '00'}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => updateTimeSegment(ci, si, 'startTime', 'minute', e.target.value)}
                                onBlur={() => normalizeTimeSegment(ci, si, 'startTime')}
                                onKeyDown={(e) => handleSegmentArrowNav(e, ci, si, 'sm')}
                              />
                            </div>
                            <button
                              type="button"
                              className={`text-[10px] font-semibold px-1.5 py-1 rounded border transition-colors ${
                                startAmPm === 'AM'
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-bg-main text-text-muted border-border hover:border-primary'
                              }`}
                              onClick={() => updateAmPm(ci, si, 'startTime', startAmPm === 'AM' ? 'PM' : 'AM')}
                            >
                              {startAmPm}
                            </button>
                          </div>
                        </div>
                        {/* End Time — 12h + AM/PM */}
                        <div className="min-w-36">
                          <label className="text-xs text-text-muted">End Time</label>
                          <div className="flex items-center gap-1">
                            <div
                              className={`input text-sm transition-colors flex items-center justify-center gap-0.5 px-2 py-1.5 flex-1 ${
                                invalidRange
                                  ? 'border-danger focus-within:ring-2 focus-within:ring-danger focus-within:border-danger bg-red-50/50'
                                  : 'focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary'
                              }`}
                              aria-invalid={invalidRange}
                            >
                              <input
                                ref={(el) => { segmentRefs.current[`${ci}-${si}-eh`] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                aria-label="End Time hour"
                                placeholder="h"
                                className="w-6 bg-transparent text-center outline-none tabular-nums"
                                value={endHour12}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => updateTimeSegment(ci, si, 'endTime', 'hour', e.target.value)}
                                onBlur={() => normalizeTimeSegment(ci, si, 'endTime')}
                                onKeyDown={(e) => handleSegmentArrowNav(e, ci, si, 'eh')}
                              />
                              <span className="text-text-muted">:</span>
                              <input
                                ref={(el) => { segmentRefs.current[`${ci}-${si}-em`] = el; }}
                                type="text"
                                inputMode="numeric"
                                maxLength={2}
                                aria-label="End Time minute"
                                placeholder="mm"
                                className="w-7 bg-transparent text-center outline-none tabular-nums"
                                value={eMinRaw ?? '30'}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => updateTimeSegment(ci, si, 'endTime', 'minute', e.target.value)}
                                onBlur={() => normalizeTimeSegment(ci, si, 'endTime')}
                                onKeyDown={(e) => handleSegmentArrowNav(e, ci, si, 'em')}
                              />
                            </div>
                            <button
                              type="button"
                              className={`text-[10px] font-semibold px-1.5 py-1 rounded border transition-colors ${
                                endAmPm === 'PM'
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-bg-main text-text-muted border-border hover:border-primary'
                              }`}
                              onClick={() => updateAmPm(ci, si, 'endTime', endAmPm === 'AM' ? 'PM' : 'AM')}
                            >
                              {endAmPm}
                            </button>
                          </div>
                        </div>
                        <div className="min-w-24">
                          <label className="text-xs text-text-muted">Type</label>
                          <select
                            className="input text-sm"
                            value={slot.type}
                            onChange={(e) => updateSlotForm(ci, si, 'type', e.target.value as 'CLASS' | 'LAB')}
                          >
                            <option value="CLASS">Class</option>
                            <option value="LAB">Lab</option>
                          </select>
                        </div>
                        <div className="flex-1 min-w-24">
                          <label className="text-xs text-text-muted">Room</label>
                          <input
                            type="text"
                            className="input text-sm"
                            placeholder="Optional"
                            value={slot.room}
                            onChange={(e) => updateSlotForm(ci, si, 'room', e.target.value)}
                          />
                        </div>
                        {course.slots.length > 1 && (
                          <button
                            onClick={() => removeSlot(ci, si)}
                            className="p-2 hover:bg-white rounded transition-colors"
                          >
                            <Trash2 size={14} className="text-danger" />
                          </button>
                        )}
                        </div>
                        {slot.isAlternating && (
                          <div className="mt-1.5 inline-flex items-center rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800 gap-1">
                            <span>⇄</span>
                            <span>Alternating Week</span>
                          </div>
                        )}
                        {slotConflict && (
                          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                            <div className="flex items-start gap-2">
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 shrink-0">
                                Conflict
                              </span>
                              <div className="flex items-start gap-1.5 flex-1">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-700" />
                                <span>{slotConflict}</span>
                              </div>
                            </div>
                            {!slot.isAlternating && (
                              <button
                                type="button"
                                className="mt-1.5 text-[10px] text-amber-800 underline hover:text-amber-900 font-medium"
                                onClick={() => {
                                  setAlternatingPrompt({
                                    courseIdx: ci,
                                    slotIdx: si,
                                    conflictLabel: slotConflict,
                                  });
                                }}
                              >
                                Is this an alternating week course?
                              </button>
                            )}
                          </div>
                        )}
                        {invalidRange && (
                          <div className="mt-2 rounded-md border border-danger/30 bg-red-50 px-2.5 py-1.5 text-xs text-danger flex items-start gap-2">
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-700">
                              Time Error
                            </span>
                            <span>End time must be later than start time.</span>
                          </div>
                        )}
                      </div>
                    )})}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={handleSaveCourses}
              className="btn-primary transition-all hover:shadow-md"
              disabled={saveCoursesMutation.isPending || draftConflicts.length > 0}
            >
              {saveCoursesMutation.isPending ? 'Saving...' : 'Save Courses & Schedule'}
            </button>
          </div>
        </div>
      )}

      {/* Schedule grid */}
      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Loading schedule...</div>
      ) : isError ? (
        <div className="card text-center py-12">
          <AlertTriangle size={40} className="mx-auto text-danger mb-3" />
          <p className="text-text-secondary">Could not load your routine slots</p>
          <p className="text-sm text-text-muted mt-1">
            Please refresh the page or try again in a moment.
          </p>
        </div>
      ) : schedule.length === 0 && !showCourseForm ? (
        <div className="card text-center py-12">
          <CalendarDays size={48} className="mx-auto text-text-muted mb-3" />
          <p className="text-text-secondary">No courses in your routine yet</p>
          <p className="text-sm text-text-muted mt-1">
            Upload a routine image to auto-detect courses, or add them manually
          </p>
        </div>
      ) : (
        <>
        {coursesInSchedule.length > 0 && (
          <div className="card mb-4">
            <h3 className="text-sm font-semibold text-text-primary mb-2">Courses in this routine</h3>
            <p className="text-xs text-text-secondary mb-3">
              Removing a course drops it from My Courses, removes you from classroom communities for that course,
              clears your topic progress, updates this grid, and deletes related schedule reminders.
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {coursesInSchedule.map((c) => (
                <li key={c.courseId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-text-primary">
                    {c.courseCode} <span className="font-normal text-text-secondary">— {c.courseName}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
                    disabled={deleteCourseMutation.isPending}
                    onClick={() => {
                      if (
                        !confirm(
                          `Remove ${c.courseCode} from your plan? You will leave any classroom for this course, your weekly grid will update, and related notifications will be cleared.`
                        )
                      ) {
                        return;
                      }
                      deleteCourseMutation.mutate(c.courseId);
                    }}
                  >
                    Remove course
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
          {DAYS.map((day, i) => (
            <div
              key={day}
              className={`card p-3 transition-colors ${dragOverDay === day ? 'ring-2 ring-primary bg-primary-light/30' : ''}`}
              onDragOver={(e) => handleDragOver(e, day)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, day)}
            >
              <h3 className="text-sm font-semibold text-primary-dark mb-3">{DAY_SHORT[i]}</h3>
              <div className="space-y-2">
                {grouped[day]?.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">No classes</p>
                ) : (
                  grouped[day]
                    ?.sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((slot) => (
                      <div
                        key={slot.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, slot.id)}
                        className={`rounded-md p-2 text-xs group relative cursor-grab active:cursor-grabbing border-l-2 ${
                          slot.type === 'LAB'
                            ? 'bg-violet-50 border-l-violet-400'
                            : 'bg-primary-light border-l-primary'
                        }`}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 left-0.5 opacity-0 group-hover:opacity-40 pointer-events-none">
                          <GripVertical size={10} />
                        </div>
                        <div className="flex items-start justify-between gap-1 pr-4">
                          <p className="font-semibold text-primary-dark leading-tight">{slot.courseCode}</p>
                          <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 ${
                            slot.type === 'LAB'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-primary/10 text-primary-dark'
                          }`}>
                            {slot.type === 'LAB' ? 'Lab' : 'Theory'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-text-secondary mt-1">
                          <Clock size={10} />
                          <span>{slot.startTime} – {slot.endTime}</span>
                        </div>
                        {slot.room && (
                          <div className="flex items-center gap-1 text-text-secondary">
                            <MapPin size={10} />
                            <span>{slot.room}</span>
                          </div>
                        )}
                        <button
                          onClick={() => deleteMutation.mutate(slot.id)}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-white rounded"
                        >
                          <Trash2 size={12} className="text-danger" />
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Conflict Resolution Dialog */}
      {conflictDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Schedule Conflict</h3>
                <p className="text-sm text-text-secondary">
                  {conflictDialog.conflicts.length} conflicting slot{conflictDialog.conflicts.length > 1 ? 's' : ''} on {conflictDialog.targetDay}
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {conflictDialog.conflicts.map((c) => (
                <div key={c.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-600" />
                    <span className="font-medium">{c.startTime} – {c.endTime}</span>
                    <span className="text-text-muted">({c.type})</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <button
                onClick={() => resolveConflict('override')}
                className="btn-secondary w-full text-left px-4"
                disabled={moveSlotMutation.isPending}
              >
                <span className="font-medium">Override</span>
                <span className="text-xs text-text-muted block">Move anyway, keep overlapping slots</span>
              </button>
              <button
                onClick={() => resolveConflict('shift')}
                className="btn-secondary w-full text-left px-4"
                disabled={moveSlotMutation.isPending}
              >
                <span className="font-medium">Shift</span>
                <span className="text-xs text-text-muted block">Move conflicting slots to the next free time</span>
              </button>
              {conflictDialog.conflicts.length === 1 && (
                <button
                  onClick={() => resolveConflict('swap')}
                  className="btn-secondary w-full text-left px-4"
                  disabled={moveSlotMutation.isPending}
                >
                  <span className="font-medium">Swap</span>
                  <span className="text-xs text-text-muted block">Exchange days between the two slots</span>
                </button>
              )}
              <button
                onClick={() => setShowConflictEdit((v) => !v)}
                className="btn-secondary w-full text-left px-4"
                disabled={moveSlotMutation.isPending || updateSlotMutation.isPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowConflictEdit((v) => !v);
                  }
                }}
              >
                <span className="font-medium">{showConflictEdit ? 'Hide time editor' : 'Edit this slot time'}</span>
                <span className="text-xs text-text-muted block">
                  Change day/time manually to resolve conflict, then save.
                </span>
              </button>
              {showConflictEdit && (
                <div className="rounded-lg border border-border bg-bg-main p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-text-muted">
                      Day
                      <select
                        ref={conflictEditDayRef}
                        className="input mt-1 h-9 py-0 text-sm"
                        value={conflictEditForm.dayOfWeek}
                        onChange={(e) => setConflictEditForm((p) => ({ ...p, dayOfWeek: e.target.value }))}
                        onKeyDown={(e) => handleConflictArrowNav(e, 'day')}
                      >
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-text-muted">
                      Type
                      <select
                        ref={conflictEditTypeRef}
                        className="input mt-1 h-9 py-0 text-sm"
                        value={conflictEditForm.type}
                        onChange={(e) =>
                          setConflictEditForm((p) => ({ ...p, type: e.target.value as 'CLASS' | 'LAB' }))
                        }
                        onKeyDown={(e) => handleConflictArrowNav(e, 'type')}
                      >
                        <option value="CLASS">CLASS</option>
                        <option value="LAB">LAB</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-text-muted">
                      Start
                      <input
                        ref={conflictEditStartRef}
                        type="time"
                        className="input mt-1 h-9 py-0 text-sm"
                        value={conflictEditForm.startTime}
                        onChange={(e) => setConflictEditForm((p) => ({ ...p, startTime: e.target.value }))}
                        onKeyDown={(e) => {
                          handleConflictArrowNav(e, 'start');
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setShowConflictEdit(false);
                          }
                        }}
                      />
                    </label>
                    <label className="text-xs text-text-muted">
                      End
                      <input
                        ref={conflictEditEndRef}
                        type="time"
                        className="input mt-1 h-9 py-0 text-sm"
                        value={conflictEditForm.endTime}
                        onChange={(e) => setConflictEditForm((p) => ({ ...p, endTime: e.target.value }))}
                        onKeyDown={(e) => {
                          handleConflictArrowNav(e, 'end');
                          if (e.key === 'Enter' && hasValidEditRange && conflictDialog) {
                            e.preventDefault();
                            updateSlotMutation.mutate({
                              slotId: conflictDialog.slotId,
                              payload: {
                                dayOfWeek: conflictEditForm.dayOfWeek,
                                startTime: conflictEditForm.startTime,
                                endTime: conflictEditForm.endTime,
                                type: conflictEditForm.type,
                                room: conflictEditForm.room || undefined,
                              },
                            });
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setShowConflictEdit(false);
                          }
                        }}
                      />
                    </label>
                  </div>
                  <label className="text-xs text-text-muted block">
                    Room
                    <input
                      ref={conflictEditRoomRef}
                      className="input mt-1 h-9 py-0 text-sm"
                      value={conflictEditForm.room}
                      onChange={(e) => setConflictEditForm((p) => ({ ...p, room: e.target.value }))}
                      onKeyDown={(e) => {
                        handleConflictArrowNav(e, 'room');
                        if (e.key === 'Enter' && hasValidEditRange && conflictDialog) {
                          e.preventDefault();
                          updateSlotMutation.mutate({
                            slotId: conflictDialog.slotId,
                            payload: {
                              dayOfWeek: conflictEditForm.dayOfWeek,
                              startTime: conflictEditForm.startTime,
                              endTime: conflictEditForm.endTime,
                              type: conflictEditForm.type,
                              room: conflictEditForm.room || undefined,
                            },
                          });
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowConflictEdit(false);
                        }
                      }}
                    />
                  </label>
                  {!hasValidEditRange && (
                    <p className="text-xs text-danger">End time must be later than start time.</p>
                  )}
                  {hasValidEditRange && editedConflictCount > 0 && (
                    <p className="text-xs text-amber-700">
                      This edited slot still overlaps {editedConflictCount} course
                      {editedConflictCount > 1 ? 's' : ''} on {conflictEditForm.dayOfWeek}.
                    </p>
                  )}
                  <button
                    onClick={() =>
                      conflictDialog &&
                      updateSlotMutation.mutate({
                        slotId: conflictDialog.slotId,
                        payload: {
                          dayOfWeek: conflictEditForm.dayOfWeek,
                          startTime: conflictEditForm.startTime,
                          endTime: conflictEditForm.endTime,
                          type: conflictEditForm.type,
                          room: conflictEditForm.room || undefined,
                        },
                      })
                    }
                    className="btn-primary w-full"
                    disabled={updateSlotMutation.isPending || moveSlotMutation.isPending || !hasValidEditRange}
                  >
                    {updateSlotMutation.isPending ? 'Saving...' : 'Save edited time slot'}
                  </button>
                </div>
              )}
              <button
                onClick={() => {
                  setConflictDialog(null);
                  setShowConflictEdit(false);
                }}
                className="btn-secondary w-full"
                disabled={moveSlotMutation.isPending || updateSlotMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alternating Week Confirmation Dialog */}
      {alternatingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">⇄</span>
              <h3 className="font-semibold text-text-main">Alternating Week Course?</h3>
            </div>
            <p className="text-sm text-text-muted mb-5">
              This slot conflicts with another slot on the same day and time. Is this an{' '}
              <strong className="text-amber-700">alternating week lab</strong> (Week 1 / Week 2 rotation)?
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500 hover:border-amber-600"
                onClick={() => {
                  const { courseIdx, slotIdx } = alternatingPrompt;
                  // Mark the current slot as alternating.
                  setCoursesForms((prev) =>
                    prev.map((c, ci) => {
                      if (ci !== courseIdx) return c;
                      return {
                        ...c,
                        slots: c.slots.map((s, si) => {
                          if (si !== slotIdx) return s;
                          return { ...s, isAlternating: true };
                        }),
                      };
                    }),
                  );
                  // Also mark any conflicting draft slot as alternating.
                  const target = coursesForms[courseIdx]?.slots[slotIdx];
                  if (target) {
                    setCoursesForms((prev) =>
                      prev.map((c, ci) =>
                        ci === courseIdx
                          ? c
                          : {
                              ...c,
                              slots: c.slots.map((s) => {
                                if (
                                  s.dayOfWeek === target.dayOfWeek &&
                                  isOverlap(s.startTime, s.endTime, target.startTime, target.endTime)
                                ) {
                                  return { ...s, isAlternating: true };
                                }
                                return s;
                              }),
                            },
                      ),
                    );
                  }
                  setAlternatingPrompt(null);
                }}
              >
                Yes, alternating week
              </button>
              <button
                className="flex-1 btn-secondary"
                onClick={() => setAlternatingPrompt(null)}
              >
                No, keep error
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
