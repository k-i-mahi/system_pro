import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { extractTextFromFile } from '../services/ocr.service.js';
import { uploadFile } from '../services/cloudinary.service.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import fs from 'fs';

export async function scanRoutine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return resp.error(res, 400, 'NO_FILE', 'Please upload an image or PDF file');
    }

    // Upload to Cloudinary
    const { secureUrl } = await uploadFile(req.file.path, 'routine-scans');

    // Text extraction (images via OCR, PDFs, DOCX)
    let extraction = await extractTextFromFile(req.file.path, 'fast');

    // If no codes were detected, retry with accurate mode (sidecar-backed OCR).
    if (extraction.codes.length === 0) {
      try {
        const accurate = await extractTextFromFile(req.file.path, 'accurate');
        // Prefer the richer result.
        if (accurate.codes.length > extraction.codes.length || accurate.text.length > extraction.text.length) {
          extraction = accurate;
        }
      } catch {
        // Keep fast-mode result if accurate path is unavailable.
      }
    }

    const { text, codes } = extraction;

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    // Save scan record
    const scan = await prisma.routineScan.create({
      data: {
        userId: req.userId!,
        fileUrl: secureUrl,
        extractedText: text,
        parsedCodes: codes,
        status: 'DONE',
      },
    });

    resp.success(res, { scanId: scan.id, extractedCodes: codes, rawText: text });
  } catch (err) {
    next(err);
  }
}

export async function getSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.userId! },
      include: {
        course: {
          include: {
            schedule: true,
          },
        },
      },
    });

    // Also include courses from communities the user teaches
    const taughtCommunities = await prisma.communityMember.findMany({
      where: { userId: req.userId!, role: 'TUTOR' },
      include: {
        community: {
          include: {
            course: { include: { schedule: true } },
          },
        },
      },
    });

    const slotMap = new Map<string, any>();

    for (const e of enrollments) {
      for (const slot of e.course.schedule) {
        slotMap.set(slot.id, {
          ...slot,
          courseCode: e.course.courseCode,
          courseName: e.course.courseName,
          courseId: e.course.id,
        });
      }
    }

    for (const cm of taughtCommunities) {
      for (const slot of cm.community.course.schedule) {
        if (!slotMap.has(slot.id)) {
          slotMap.set(slot.id, {
            ...slot,
            courseCode: cm.community.course.courseCode,
            courseName: cm.community.course.courseName,
            courseId: cm.community.course.id,
          });
        }
      }
    }

    resp.success(res, Array.from(slotMap.values()));
  } catch (err) {
    next(err);
  }
}

export async function bulkCreateCourses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { courses } = req.body;
    const results = [];

    for (const courseData of courses) {
      // Create or find course
      let course = await prisma.course.findFirst({
        where: { courseCode: courseData.courseCode },
      });

      if (!course) {
        course = await prisma.course.create({
          data: {
            courseCode: courseData.courseCode,
            courseName: courseData.courseName,
          },
        });
      }

      // Create enrollment
      await prisma.enrollment.upsert({
        where: {
          userId_courseId: { userId: req.userId!, courseId: course.id },
        },
        create: { userId: req.userId!, courseId: course.id },
        update: {},
      });

      // Create schedule slots
      for (const slot of courseData.slots) {
        await prisma.scheduleSlot.create({
          data: {
            courseId: course.id,
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            type: slot.type || 'CLASS',
            room: slot.room,
          },
        });
      }

      results.push(course);
    }

    resp.created(res, results);
  } catch (err) {
    next(err);
  }
}

export async function updateSlot(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const slot = await prisma.scheduleSlot.update({
      where: { id },
      data: req.body,
    });
    resp.success(res, slot);
  } catch (err) {
    next(err);
  }
}

export async function deleteSlot(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.scheduleSlot.delete({ where: { id: req.params.id } });
    resp.success(res, { message: 'Slot deleted' });
  } catch (err) {
    next(err);
  }
}

function timeOverlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function slotDurationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

async function getUserCourseIds(userId: string): Promise<string[]> {
  const [enrollments, taughtCommunities] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId },
      select: { courseId: true },
    }),
    prisma.communityMember.findMany({
      where: { userId, role: 'TUTOR' },
      select: { community: { select: { courseId: true } } },
    }),
  ]);
  const courseIds = new Set<string>();
  enrollments.forEach((e) => courseIds.add(e.courseId));
  taughtCommunities.forEach((cm) => courseIds.add(cm.community.courseId));
  return Array.from(courseIds);
}

export async function moveSlot(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { dayOfWeek, resolveConflicts } = req.body;

    const slot = await prisma.scheduleSlot.findUnique({ where: { id } });
    if (!slot) {
      return resp.error(res, 404, 'NOT_FOUND', 'Slot not found');
    }

    // Find all courses the user is associated with (enrolled + taught via communities)
    const enrolledCourseIds = await getUserCourseIds(req.userId!);

    // Find conflicting slots on the target day
    const slotsOnDay = await prisma.scheduleSlot.findMany({
      where: {
        courseId: { in: enrolledCourseIds },
        dayOfWeek: dayOfWeek,
        id: { not: id },
      },
    });

    const conflicts = slotsOnDay.filter((s) =>
      timeOverlaps(slot.startTime, slot.endTime, s.startTime, s.endTime)
    );

    // No conflicts — just move
    if (conflicts.length === 0) {
      const updated = await prisma.scheduleSlot.update({
        where: { id },
        data: { dayOfWeek },
      });
      return resp.success(res, { slot: updated, conflicts: [], resolved: true });
    }

    // Conflicts exist but no resolution strategy — return conflicts for UI to decide
    if (!resolveConflicts) {
      return resp.success(res, {
        slot,
        targetDay: dayOfWeek,
        conflicts: conflicts.map((c) => ({
          id: c.id,
          courseId: c.courseId,
          startTime: c.startTime,
          endTime: c.endTime,
          type: c.type,
          room: c.room,
        })),
        resolved: false,
      });
    }

    if (resolveConflicts === 'override') {
      const updated = await prisma.scheduleSlot.update({
        where: { id },
        data: { dayOfWeek },
      });
      return resp.success(res, {
        slot: updated,
        conflicts: conflicts.map((c) => ({ id: c.id, startTime: c.startTime, endTime: c.endTime })),
        resolved: true,
        warning: 'Time conflicts exist',
      });
    }

    if (resolveConflicts === 'swap' && conflicts.length === 1) {
      const conflicting = conflicts[0];
      // Swap days between source slot and conflicting slot
      await Promise.all([
        prisma.scheduleSlot.update({ where: { id }, data: { dayOfWeek } }),
        prisma.scheduleSlot.update({ where: { id: conflicting.id }, data: { dayOfWeek: slot.dayOfWeek } }),
      ]);
      const updated = await prisma.scheduleSlot.findUnique({ where: { id } });
      return resp.success(res, { slot: updated, conflicts: [], resolved: true });
    }

    if (resolveConflicts === 'shift') {
      // Move the slot to the target day first
      await prisma.scheduleSlot.update({ where: { id }, data: { dayOfWeek } });

      // Shift each conflicting slot to the next available time
      for (const conflict of conflicts) {
        const duration = slotDurationMinutes(conflict.startTime, conflict.endTime);
        // Gather all slots on that day to find a gap
        const allOnDay = await prisma.scheduleSlot.findMany({
          where: {
            courseId: { in: enrolledCourseIds },
            dayOfWeek: dayOfWeek,
            id: { not: conflict.id },
          },
          orderBy: { startTime: 'asc' },
        });

        // Try to find a gap after the conflict's current end time
        let newStart = conflict.endTime;
        let found = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const newEnd = addMinutes(newStart, duration);
          const hasOverlap = allOnDay.some((s) => timeOverlaps(newStart, newEnd, s.startTime, s.endTime));
          if (!hasOverlap && newEnd <= '23:59') {
            await prisma.scheduleSlot.update({
              where: { id: conflict.id },
              data: { startTime: newStart, endTime: newEnd },
            });
            found = true;
            break;
          }
          newStart = addMinutes(newStart, 30);
        }

        if (!found) {
          // Fallback: keep conflict in place, override
        }
      }

      const updated = await prisma.scheduleSlot.findUnique({ where: { id } });
      return resp.success(res, { slot: updated, conflicts: [], resolved: true });
    }

    // Default: override for multi-conflict swap
    const updated = await prisma.scheduleSlot.update({
      where: { id },
      data: { dayOfWeek },
    });
    resp.success(res, { slot: updated, conflicts: conflicts.map((c) => ({ id: c.id })), resolved: true });
  } catch (err) {
    next(err);
  }
}

export async function deleteCourse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Remove enrollment only (don't delete the course itself since others may use it)
    await prisma.enrollment.deleteMany({
      where: { userId: req.userId!, courseId: req.params.id },
    });
    resp.success(res, { message: 'Course removed from routine' });
  } catch (err) {
    next(err);
  }
}
