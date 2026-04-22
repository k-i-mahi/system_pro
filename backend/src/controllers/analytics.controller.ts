import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';

export async function getOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });

    // ── Tutor overview: aggregate stats across their classes ──
    if (user?.role === 'TUTOR') {
      const communities = await prisma.community.findMany({
        where: { createdBy: userId },
        include: {
          course: true,
          members: { where: { role: 'STUDENT' } },
        },
      });

      const courseIds = communities.map((c) => c.courseId);
      const studentIds = [...new Set(communities.flatMap((c) => c.members.map((m) => m.userId)))];

      const [attendance, enrollments] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { userId: { in: studentIds }, slot: { courseId: { in: courseIds } } },
        }),
        prisma.enrollment.findMany({
          where: { userId: { in: studentIds }, courseId: { in: courseIds } },
        }),
      ]);

      const totalPresent = attendance.filter((a) => a.present).length;
      const avgClassAttendance = attendance.length > 0 ? Math.round((totalPresent / attendance.length) * 100) : 0;

      const ctScores = enrollments
        .flatMap((e) => [e.ctScore1, e.ctScore2, e.ctScore3])
        .filter((s): s is number => s != null);
      const avgClassCT = ctScores.length > 0 ? Math.round(ctScores.reduce((a, b) => a + b, 0) / ctScores.length) : 0;

      return resp.success(res, {
        role: 'TUTOR',
        totalCoursesTeaching: communities.length,
        totalStudents: studentIds.length,
        avgClassAttendance,
        avgClassCT,
      });
    }

    // ── Student overview (existing logic) ──
    const [enrollments, attendance, topicProgress, examAttempts] = await Promise.all([
      prisma.enrollment.findMany({
        where: { userId },
        include: { course: { include: { topics: true } } },
      }),
      prisma.attendanceRecord.findMany({ where: { userId } }),
      prisma.topicProgress.findMany({ where: { userId } }),
      prisma.examAttempt.findMany({ where: { userId } }),
    ]);

    const totalCourses = enrollments.length;

    const totalSlots = attendance.length;
    const presentCount = attendance.filter((a) => a.present).length;
    const avgAttendance = totalSlots > 0 ? Math.round((presentCount / totalSlots) * 100) : 0;

    const ctScores = enrollments
      .flatMap((e) => [e.ctScore1, e.ctScore2, e.ctScore3])
      .filter((s): s is number => s != null);
    const avgCT = ctScores.length > 0 ? Math.round(ctScores.reduce((a, b) => a + b, 0) / ctScores.length) : 0;

    const topicsMastered = topicProgress.filter((tp) => tp.expertiseLevel >= 0.8).length;
    const totalTopics = enrollments.reduce((sum, e) => sum + e.course.topics.length, 0);

    resp.success(res, { role: 'STUDENT', totalCourses, avgAttendance, avgCT, topicsMastered, totalTopics });
  } catch (err) {
    next(err);
  }
}

export async function getCourseAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const { courseId } = req.params;
    const [user, course] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.course.findUnique({ where: { id: courseId }, select: { courseType: true } }),
    ]);

    // ── Tutor: per-student breakdown for the course ──
    if (user?.role === 'TUTOR') {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId, user: { role: 'STUDENT' } },
        include: {
          user: { select: { id: true, name: true, rollNumber: true, email: true } },
        },
      });

      const studentIds = enrollments.map((e) => e.userId);

      const [attendance, topics] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { userId: { in: studentIds }, slot: { courseId } },
        }),
        prisma.topic.findMany({ where: { courseId }, select: { id: true } }),
      ]);

      // Group attendance by student
      const attendanceByStudent: Record<string, { total: number; present: number }> = {};
      for (const a of attendance) {
        if (!attendanceByStudent[a.userId]) attendanceByStudent[a.userId] = { total: 0, present: 0 };
        attendanceByStudent[a.userId].total++;
        if (a.present) attendanceByStudent[a.userId].present++;
      }

      const students = enrollments.map((e) => {
        const att = attendanceByStudent[e.userId];
        return {
          userId: e.userId,
          name: e.user.name,
          rollNumber: e.user.rollNumber,
          email: e.user.email,
          attendancePercent: att ? Math.round((att.present / att.total) * 100) : 0,
          totalClasses: att?.total ?? 0,
          present: att?.present ?? 0,
          ctScore1: e.ctScore1,
          ctScore2: e.ctScore2,
          ctScore3: e.ctScore3,
          labScore: e.labScore,
        };
      });

      // Class-wide averages
      const allCT = enrollments.flatMap((e) => [e.ctScore1, e.ctScore2, e.ctScore3]).filter((s): s is number => s != null);
      const avgCT = allCT.length > 0 ? Math.round(allCT.reduce((a, b) => a + b, 0) / allCT.length) : 0;
      const allLab = enrollments.map((e) => e.labScore).filter((s): s is number => s != null);
      const avgLab = allLab.length > 0 ? Math.round(allLab.reduce((a, b) => a + b, 0) / allLab.length) : 0;
      const totalAtt = attendance.length;
      const totalPresent = attendance.filter((a) => a.present).length;
      const classAttendancePercent = totalAtt > 0 ? Math.round((totalPresent / totalAtt) * 100) : 0;

      return resp.success(res, {
        role: 'TUTOR',
        courseType: course?.courseType ?? 'THEORY',
        students,
        classAverages: { avgCT, avgLab, attendancePercent: classAttendancePercent },
        totalStudents: enrollments.length,
      });
    }

    // ── Student: personal analytics (existing logic) ──

    const [enrollment, topics, attendance, exams] = await Promise.all([
      prisma.enrollment.findFirst({
        where: { userId, courseId },
      }),
      prisma.topic.findMany({
        where: { courseId },
        include: {
          topicProgress: { where: { userId } },
        },
        orderBy: { orderIndex: 'asc' },
      }),
      prisma.attendanceRecord.findMany({
        where: { userId, slot: { courseId } },
        include: { slot: true },
        orderBy: { date: 'asc' },
      }),
      prisma.examAttempt.findMany({
        where: { userId, topicId: { in: (await prisma.topic.findMany({ where: { courseId }, select: { id: true } })).map((t) => t.id) } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const topicAnalytics = topics.map((t) => {
      const raw = t.topicProgress[0]?.expertiseLevel ?? 0;
      const lastStudied = t.topicProgress[0]?.lastStudied;
      // Decay: expertise drops ~5% per week of inactivity
      let decayed = raw;
      if (lastStudied) {
        const daysSince = (Date.now() - new Date(lastStudied).getTime()) / (1000 * 60 * 60 * 24);
        decayed = raw * Math.pow(0.95, daysSince / 7);
      }
      return {
        id: t.id,
        title: t.title,
        expertiseLevel: Math.round(decayed * 1000) / 1000,
        rawExpertise: raw,
        studyMinutes: t.topicProgress[0]?.studyMinutes ?? 0,
        examScore: t.topicProgress[0]?.examScore,
        lastStudied,
      };
    });

    const attendanceData = attendance.map((a) => ({
      date: a.date,
      present: a.present,
      slotType: a.slot.type,
      dayOfWeek: a.slot.dayOfWeek,
    }));

    const presentCount = attendance.filter((a) => a.present).length;
    const attendancePercentage = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0;

    resp.success(res, {
      courseType: course?.courseType ?? 'THEORY',
      enrollment,
      topicAnalytics,
      attendanceData,
      attendancePercentage,
      examHistory: exams.map((e) => ({
        id: e.id,
        topicId: e.topicId,
        score: e.totalQ > 0 ? Math.round((e.score / e.totalQ) * 100) : 0,
        totalQ: e.totalQ,
        timeTaken: e.timeTaken,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { slotId, date, present } = req.body;
    const record = await prisma.attendanceRecord.upsert({
      where: {
        userId_slotId_date: { userId: req.userId!, slotId, date: new Date(date) },
      },
      create: { userId: req.userId!, slotId, date: new Date(date), present },
      update: { present },
    });
    resp.success(res, record);
  } catch (err) {
    next(err);
  }
}

export async function updateCtScore(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { enrollmentId, ctScore1, ctScore2, ctScore3 } = req.body;
    const data: any = {};
    if (ctScore1 !== undefined) data.ctScore1 = ctScore1;
    if (ctScore2 !== undefined) data.ctScore2 = ctScore2;
    if (ctScore3 !== undefined) data.ctScore3 = ctScore3;

    const enrollment = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data,
    });
    resp.success(res, enrollment);
  } catch (err) {
    next(err);
  }
}

export async function updateLabScore(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { enrollmentId, labScore } = req.body;
    const enrollment = await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { labScore },
    });
    resp.success(res, enrollment);
  } catch (err) {
    next(err);
  }
}

export async function getSuggestions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;

    // Tutors don't study — no suggestions
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role === 'TUTOR') {
      return resp.success(res, []);
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          include: {
            topics: {
              include: { topicProgress: { where: { userId } } },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    const suggestions: Array<{
      type: 'study' | 'exam' | 'review';
      priority: 'high' | 'medium' | 'low';
      title: string;
      description: string;
      courseId: string;
      topicId: string;
      courseName: string;
      topicName: string;
      expertiseLevel: number;
    }> = [];

    for (const enrollment of enrollments) {
      for (const topic of enrollment.course.topics) {
        const progress = topic.topicProgress[0];
        const raw = progress?.expertiseLevel ?? 0;
        const lastStudied = progress?.lastStudied;

        // Apply decay
        let expertise = raw;
        if (lastStudied) {
          const daysSince = (Date.now() - new Date(lastStudied).getTime()) / (1000 * 60 * 60 * 24);
          expertise = raw * Math.pow(0.95, daysSince / 7);
        }

        const base = {
          courseId: enrollment.courseId,
          topicId: topic.id,
          courseName: enrollment.course.courseName,
          topicName: topic.title,
          expertiseLevel: Math.round(expertise * 100) / 100,
        };

        // Never studied
        if (!progress) {
          suggestions.push({
            ...base,
            type: 'study',
            priority: 'high',
            title: `Start studying: ${topic.title}`,
            description: `You haven't started this topic in ${enrollment.course.courseName}`,
          });
          continue;
        }

        // Very low expertise
        if (expertise < 0.3) {
          suggestions.push({
            ...base,
            type: 'study',
            priority: 'high',
            title: `Review: ${topic.title}`,
            description: `Your mastery has dropped to ${Math.round(expertise * 100)}%`,
          });
        }
        // Moderate but decaying
        else if (expertise < 0.6) {
          suggestions.push({
            ...base,
            type: 'exam',
            priority: 'medium',
            title: `Take a quiz: ${topic.title}`,
            description: `Test yourself to boost mastery from ${Math.round(expertise * 100)}%`,
          });
        }
        // Not studied in a while but was good
        else if (lastStudied) {
          const daysSince = (Date.now() - new Date(lastStudied).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince > 14) {
            suggestions.push({
              ...base,
              type: 'review',
              priority: 'low',
              title: `Quick review: ${topic.title}`,
              description: `It's been ${Math.round(daysSince)} days since you last studied this`,
            });
          }
        }
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    resp.success(res, suggestions.slice(0, 20));
  } catch (err) {
    next(err);
  }
}
