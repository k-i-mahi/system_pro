import { useState, useCallback } from 'react';
import type { DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, CalendarDays, Clock, MapPin, Trash2, Plus, X, GripVertical, AlertTriangle, Pencil, CheckCheck } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import api from '@/lib/api';
import toast from 'react-hot-toast';

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
}

interface CourseForm {
  courseCode: string;
  courseName: string;
  slots: SlotForm[];
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

function emptySlot(): SlotForm {
  return { dayOfWeek: 'MON', startTime: '09:00', endTime: '10:30', type: 'CLASS', room: '' };
}

export default function RoutinePage() {
  const queryClient = useQueryClient();
  const [showUpload, setShowUpload] = useState(false);
  const [coursesForms, setCoursesForms] = useState<CourseForm[]>([]);
  const [scannedCodes, setScannedCodes] = useState<ScannedCode[]>([]);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState<ConflictInfo | null>(null);

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

  const saveCoursesMutation = useMutation({
    mutationFn: (courses: CourseForm[]) =>
      api.post('/routine/courses', { courses }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['my-courses'] });
      setCoursesForms([]);
      toast.success('Courses and schedule saved!');
    },
    onError: () => toast.error('Failed to save courses'),
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/routine/slots/${slotId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Slot removed');
    },
  });

  const moveSlotMutation = useMutation({
    mutationFn: ({ slotId, dayOfWeek, resolveConflicts }: { slotId: string; dayOfWeek: string; resolveConflicts?: string }) =>
      api.put(`/routine/slots/${slotId}/move`, { dayOfWeek, resolveConflicts }),
    onSuccess: (res) => {
      const { resolved, conflicts, targetDay, slot } = res.data.data;
      if (!resolved && conflicts?.length > 0) {
        setConflictDialog({
          slotId: slot.id,
          targetDay: targetDay || '',
          conflicts,
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      setConflictDialog(null);
      toast.success('Slot moved!');
    },
    onError: () => toast.error('Failed to move slot'),
  });

  function resolveConflict(strategy: 'override' | 'shift' | 'swap') {
    if (!conflictDialog) return;
    moveSlotMutation.mutate({
      slotId: conflictDialog.slotId,
      dayOfWeek: conflictDialog.targetDay,
      resolveConflicts: strategy,
    });
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
      prev.map((c, i) => (i === courseIdx ? { ...c, slots: [...c.slots, emptySlot()] } : c))
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
    setScannedCodes([]);
    setCoursesForms([{ courseCode: '', courseName: '', slots: [emptySlot()] }]);
    setShowUpload(false);
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
    saveCoursesMutation.mutate(coursesForms);
  }

  const showCourseForm = coursesForms.length > 0;
  const showReview = scannedCodes.length > 0 && !showCourseForm;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">My Routine</h1>
        <div className="flex gap-2">
          <button onClick={handleManualAdd} className="btn-secondary flex items-center gap-2">
            <Plus size={18} />
            Add Course
          </button>
          <button onClick={() => { setShowUpload(!showUpload); setCoursesForms([]); }} className="btn-primary flex items-center gap-2">
            <Upload size={18} />
            Scan Routine
          </button>
        </div>
      </div>

      {/* Upload area */}
      {showUpload && !showCourseForm && !showReview && (
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
                ? 'Processing OCR...'
                : 'Drop your routine image here, or click to select'}
            </p>
            <p className="text-xs text-text-muted mt-1">PNG, JPG, or PDF up to 20MB</p>
          </div>
        </div>
      )}

      {/* OCR review — pick which detected codes to keep */}
      {showReview && (
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
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Complete Course Details</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setCoursesForms((prev) => [...prev, { courseCode: '', courseName: '', slots: [emptySlot()] }])}
                className="btn-secondary text-sm flex items-center gap-1"
              >
                <Plus size={14} />
                Add Another Course
              </button>
              <button onClick={() => { setCoursesForms([]); setScannedCodes([]); }} className="btn-secondary text-sm">
                Cancel
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {coursesForms.map((course, ci) => (
              <div key={ci} className="border border-border rounded-lg p-4 relative">
                {coursesForms.length > 1 && (
                  <button
                    onClick={() => removeCourse(ci)}
                    className="absolute top-2 right-2 p-1 hover:bg-bg-main rounded"
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
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus size={12} />
                      Add Slot
                    </button>
                  </div>

                  <div className="space-y-2">
                    {course.slots.map((slot, si) => (
                      <div key={si} className="flex flex-wrap items-end gap-2 bg-bg-main rounded-lg p-3">
                        <div className="min-w-24">
                          <label className="text-xs text-text-muted">Day</label>
                          <select
                            className="input text-sm"
                            value={slot.dayOfWeek}
                            onChange={(e) => updateSlotForm(ci, si, 'dayOfWeek', e.target.value)}
                          >
                            {DAYS.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-28">
                          <label className="text-xs text-text-muted">Start Time</label>
                          <input
                            type="time"
                            className="input text-sm"
                            value={slot.startTime}
                            onChange={(e) => updateSlotForm(ci, si, 'startTime', e.target.value)}
                          />
                        </div>
                        <div className="min-w-28">
                          <label className="text-xs text-text-muted">End Time</label>
                          <input
                            type="time"
                            className="input text-sm"
                            value={slot.endTime}
                            onChange={(e) => updateSlotForm(ci, si, 'endTime', e.target.value)}
                          />
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
                            className="p-2 hover:bg-white rounded"
                          >
                            <Trash2 size={14} className="text-danger" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-4">
            <button
              onClick={handleSaveCourses}
              className="btn-primary"
              disabled={saveCoursesMutation.isPending}
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
                        className="bg-primary-light rounded-md p-2 text-xs group relative cursor-grab active:cursor-grabbing"
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 left-0.5 opacity-0 group-hover:opacity-40 pointer-events-none">
                          <GripVertical size={10} />
                        </div>
                        <p className="font-semibold text-primary-dark">{slot.courseCode}</p>
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
                onClick={() => setConflictDialog(null)}
                className="btn-secondary w-full"
                disabled={moveSlotMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
