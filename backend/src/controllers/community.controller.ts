import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { createNotification } from '../services/notification.service.js';
import { parseSpreadsheet } from '../services/spreadsheet.service.js';
import { uploadFile } from '../services/cloudinary.service.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import fs from 'fs';

export async function listThreads(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tab, courseId, tag, page, limit } = req.query as any;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    const where: any = {};

    if (tab === 'my-courses' && req.userId) {
      const enrollments = await prisma.enrollment.findMany({
        where: { userId: req.userId },
        select: { courseId: true },
      });
      where.courseId = { in: enrollments.map((e) => e.courseId) };
    }

    if (courseId) where.courseId = courseId;
    if (tag) where.tags = { has: tag };

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, avatarUrl: true } },
          course: { select: { courseCode: true } },
          _count: { select: { posts: true, likes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.thread.count({ where }),
    ]);

    resp.success(res, threads, { page: pageNum, limit: limitNum, total });
  } catch (err) {
    next(err);
  }
}

export async function createThread(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const thread = await prisma.thread.create({
      data: {
        ...req.body,
        creatorId: req.userId!,
      },
      include: {
        creator: { select: { id: true, name: true, avatarUrl: true } },
        course: { select: { courseCode: true } },
      },
    });
    resp.created(res, thread);
  } catch (err) {
    next(err);
  }
}

export async function getThread(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const thread = await prisma.thread.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, name: true, avatarUrl: true } },
        course: { select: { courseCode: true, courseName: true } },
        posts: {
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        likes: req.userId ? { where: { userId: req.userId } } : false,
        _count: { select: { posts: true, likes: true } },
      },
    });

    if (!thread) {
      return resp.error(res, 404, 'NOT_FOUND', 'Thread not found');
    }

    resp.success(res, thread);
  } catch (err) {
    next(err);
  }
}

export async function createPost(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const post = await prisma.threadPost.create({
      data: {
        threadId: req.params.id,
        authorId: req.userId!,
        content: req.body.content,
        fileUrl: req.body.fileUrl,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    resp.created(res, post);
  } catch (err) {
    next(err);
  }
}

export async function deleteThread(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
    if (!thread) return resp.error(res, 404, 'NOT_FOUND', 'Thread not found');
    if (thread.creatorId !== req.userId) {
      return resp.error(res, 403, 'FORBIDDEN', 'You can only delete your own threads');
    }

    await prisma.thread.delete({ where: { id: req.params.id } });
    resp.success(res, { message: 'Thread deleted' });
  } catch (err) {
    next(err);
  }
}

export async function likeThread(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.threadLike.create({
      data: { threadId: req.params.id, userId: req.userId! },
    });
    resp.success(res, { liked: true });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return resp.success(res, { liked: true, message: 'Already liked' });
    }
    next(err);
  }
}

export async function unlikeThread(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.threadLike.deleteMany({
      where: { threadId: req.params.id, userId: req.userId! },
    });
    resp.success(res, { liked: false });
  } catch (err) {
    next(err);
  }
}

// ─── Community / Classroom CRUD ────────────────────────────

export async function createCommunity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, description, courseCode, session, department, university } = req.body;

    // Find or create the course by courseCode
    let course = await prisma.course.findFirst({ where: { courseCode } });
    if (!course) {
      course = await prisma.course.create({
        data: { courseCode, courseName: courseCode },
      });
    }

    const community = await prisma.community.create({
      data: {
        name,
        description,
        courseId: course.id,
        courseCode,
        session,
        department,
        university,
        createdBy: req.userId!,
        members: {
          create: { userId: req.userId!, role: 'TUTOR' },
        },
      },
      include: {
        course: { select: { courseCode: true, courseName: true } },
        creator: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { members: true } },
      },
    });

    // Auto-enroll tutor so the course appears in their schedule
    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: req.userId!, courseId: course.id } },
      create: { userId: req.userId!, courseId: course.id },
      update: {},
    });

    resp.created(res, community);
  } catch (err) {
    next(err);
  }
}

export async function listCommunities(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tab, page, limit } = req.query as any;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { role: true, rollNumber: true, session: true, department: true, universityName: true },
    });

    let where: any = {};

    if (tab === 'my') {
      // Communities user is a member of
      where.members = { some: { userId: req.userId! } };
    } else if (tab === 'eligible') {
      // Communities at the same university that the user hasn't joined
      // (session + department are verified at join time)
      where = {
        AND: [
          { university: user?.universityName },
          { members: { none: { userId: req.userId! } } },
        ],
      };
    }

    const [communities, total] = await Promise.all([
      prisma.community.findMany({
        where,
        include: {
          course: { select: { courseCode: true, courseName: true } },
          creator: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.community.count({ where }),
    ]);

    resp.success(res, communities, { page: pageNum, limit: limitNum, total });
  } catch (err) {
    next(err);
  }
}

export async function getCommunity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({
      where: { id: req.params.id },
      include: {
        course: { select: { id: true, courseCode: true, courseName: true } },
        creator: { select: { id: true, name: true, avatarUrl: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true, rollNumber: true, email: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { members: true, announcements: true } },
      },
    });

    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }

    resp.success(res, community);
  } catch (err) {
    next(err);
  }
}

export async function joinCommunity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { rollNumber, session, department } = req.body;

    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { universityName: true },
    });

    // Validate matching criteria — university from profile, session/department from request
    if (user?.universityName !== community.university) {
      return resp.error(res, 403, 'FORBIDDEN', 'University does not match this classroom');
    }
    if (session !== community.session) {
      return resp.error(res, 403, 'FORBIDDEN', 'Session does not match this classroom');
    }
    if (department !== community.department) {
      return resp.error(res, 403, 'FORBIDDEN', 'Department does not match this classroom');
    }

    // Store roll number, session, department on the user profile
    await prisma.user.update({
      where: { id: req.userId! },
      data: { rollNumber, session, department },
    });

    const member = await prisma.communityMember.create({
      data: {
        communityId: req.params.id,
        userId: req.userId!,
        role: 'STUDENT',
      },
    });

    // Auto-enroll in the course if not already enrolled
    await prisma.enrollment.upsert({
      where: {
        userId_courseId: { userId: req.userId!, courseId: community.courseId },
      },
      create: { userId: req.userId!, courseId: community.courseId },
      update: {},
    });

    resp.created(res, member);
  } catch (err: any) {
    if (err.code === 'P2002') {
      return resp.error(res, 409, 'CONFLICT', 'Already a member of this community');
    }
    next(err);
  }
}

export async function leaveCommunity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.communityMember.deleteMany({
      where: { communityId: req.params.id, userId: req.userId! },
    });
    resp.success(res, { message: 'Left community' });
  } catch (err) {
    next(err);
  }
}

export async function removeMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }
    if (community.createdBy !== req.userId) {
      return resp.error(res, 403, 'FORBIDDEN', 'Only the community creator can remove members');
    }

    await prisma.communityMember.deleteMany({
      where: { communityId: req.params.id, userId: req.params.userId },
    });
    resp.success(res, { message: 'Member removed' });
  } catch (err) {
    next(err);
  }
}

// ─── Announcements ─────────────────────────────────────────

export async function createAnnouncement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }
    if (community.createdBy !== req.userId) {
      return resp.error(res, 403, 'FORBIDDEN', 'Only the community tutor can post announcements');
    }

    const announcement = await prisma.announcement.create({
      data: {
        communityId: req.params.id,
        authorId: req.userId!,
        title: req.body.title,
        body: req.body.body,
        fileUrl: req.body.fileUrl,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Broadcast notification to all student members
    const members = await prisma.communityMember.findMany({
      where: { communityId: req.params.id, role: 'STUDENT' },
      select: { userId: true },
    });

    await Promise.all(
      members.map((m) =>
        createNotification({
          userId: m.userId,
          type: 'ANNOUNCEMENT',
          title: `New announcement in ${community.name}`,
          body: req.body.title,
          metadata: { communityId: community.id, announcementId: announcement.id },
        })
      )
    );

    resp.created(res, announcement);
  } catch (err) {
    next(err);
  }
}

export async function listAnnouncements(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit } = req.query as any;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where: { communityId: req.params.id },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.announcement.count({ where: { communityId: req.params.id } }),
    ]);

    resp.success(res, announcements, { page: pageNum, limit: limitNum, total });
  } catch (err) {
    next(err);
  }
}

export async function deleteAnnouncement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id: req.params.announcementId },
    });
    if (!announcement) {
      return resp.error(res, 404, 'NOT_FOUND', 'Announcement not found');
    }
    if (announcement.authorId !== req.userId) {
      return resp.error(res, 403, 'FORBIDDEN', 'Only the author can delete this announcement');
    }

    await prisma.announcement.delete({ where: { id: req.params.announcementId } });
    resp.success(res, { message: 'Announcement deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── Marks / Spreadsheet Upload ────────────────────────────

export async function uploadMarks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return resp.error(res, 400, 'NO_FILE', 'Please upload a spreadsheet file (.csv, .xlsx, .xls)');
    }

    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      fs.unlink(req.file.path, () => {});
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }
    if (community.createdBy !== req.userId) {
      fs.unlink(req.file.path, () => {});
      return resp.error(res, 403, 'FORBIDDEN', 'Only the community tutor can upload marks');
    }

    // Upload file to Cloudinary for audit trail
    const { secureUrl } = await uploadFile(req.file.path, 'mark-uploads');

    // Parse spreadsheet
    const buffer = fs.readFileSync(req.file.path);
    const { records, errors } = parseSpreadsheet(buffer);

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    if (records.length === 0) {
      const markUpload = await prisma.markUpload.create({
        data: {
          communityId: community.id,
          uploadedBy: req.userId!,
          fileUrl: secureUrl,
          processedCount: 0,
          errorCount: errors.length,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
      return resp.success(res, { upload: markUpload, processed: 0, updated: 0, errors });
    }

    // Match students and update scores
    let updated = 0;
    const matchErrors: typeof errors = [];

    for (const record of records) {
      // Find student by rollNumber and university
      const student = await prisma.user.findFirst({
        where: {
          rollNumber: record.rollNumber,
          universityName: community.university,
        },
        select: { id: true },
      });

      if (!student) {
        matchErrors.push({
          row: record.row,
          rollNumber: record.rollNumber,
          reason: 'No matching student found',
        });
        continue;
      }

      // Find enrollment for this course
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          userId_courseId: { userId: student.id, courseId: community.courseId },
        },
      });

      if (!enrollment) {
        matchErrors.push({
          row: record.row,
          rollNumber: record.rollNumber,
          reason: 'Student not enrolled in this course',
        });
        continue;
      }

      // Update scores
      const updateData: any = {};
      if (record.ctScore1 !== undefined) updateData.ctScore1 = record.ctScore1;
      if (record.ctScore2 !== undefined) updateData.ctScore2 = record.ctScore2;
      if (record.ctScore3 !== undefined) updateData.ctScore3 = record.ctScore3;
      if (record.labScore !== undefined) updateData.labScore = record.labScore;

      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: updateData,
      });

      updated++;
    }

    const allErrors = [...errors, ...matchErrors];
    const markUpload = await prisma.markUpload.create({
      data: {
        communityId: community.id,
        uploadedBy: req.userId!,
        fileUrl: secureUrl,
        processedCount: records.length,
        errorCount: allErrors.length,
        errors: allErrors as unknown as Prisma.InputJsonValue,
      },
    });

    resp.success(res, {
      upload: markUpload,
      processed: records.length,
      updated,
      errors: allErrors,
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

export async function getMarksHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const uploads = await prisma.markUpload.findMany({
      where: { communityId: req.params.id },
      include: {
        uploader: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    resp.success(res, uploads);
  } catch (err) {
    next(err);
  }
}

export async function getCommunityScores(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: community.courseId },
      include: {
        user: { select: { id: true, name: true, rollNumber: true, email: true } },
      },
    });

    const scores = enrollments.map((e) => ({
      userId: e.user.id,
      name: e.user.name,
      rollNumber: e.user.rollNumber,
      email: e.user.email,
      ctScore1: e.ctScore1,
      ctScore2: e.ctScore2,
      ctScore3: e.ctScore3,
      labScore: e.labScore,
    }));

    resp.success(res, scores);
  } catch (err) {
    next(err);
  }
}

// ─── Attendance ────────────────────────────────────────────

export async function recordAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }
    if (community.createdBy !== req.userId) {
      return resp.error(res, 403, 'FORBIDDEN', 'Only the community tutor can record attendance');
    }

    const { slotId, date, records } = req.body;
    const attendanceDate = new Date(date);

    const results = [];
    for (const record of records) {
      const attendance = await prisma.attendanceRecord.upsert({
        where: {
          userId_slotId_date: {
            userId: record.userId,
            slotId,
            date: attendanceDate,
          },
        },
        create: {
          userId: record.userId,
          slotId,
          date: attendanceDate,
          present: record.present,
        },
        update: {
          present: record.present,
        },
      });
      results.push(attendance);

      // Notify students marked absent
      if (!record.present) {
        createNotification({
          userId: record.userId,
          type: 'ATTENDANCE_ALERT',
          title: 'Marked absent',
          body: `You were marked absent in ${community.name} on ${attendanceDate.toLocaleDateString()}`,
          metadata: { communityId: community.id, slotId, date },
        });
      }
    }

    resp.success(res, { recorded: results.length });
  } catch (err) {
    next(err);
  }
}

export async function getCommunityAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }

    const { slotId, from, to } = req.query as any;
    const where: any = {
      slot: { courseId: community.courseId },
    };
    if (slotId) where.slotId = slotId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, rollNumber: true } },
        slot: { select: { dayOfWeek: true, startTime: true, endTime: true, type: true } },
      },
      orderBy: { date: 'desc' },
    });

    resp.success(res, records);
  } catch (err) {
    next(err);
  }
}

export async function getMyAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const community = await prisma.community.findUnique({ where: { id: req.params.id } });
    if (!community) {
      return resp.error(res, 404, 'NOT_FOUND', 'Community not found');
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        userId: req.userId!,
        slot: { courseId: community.courseId },
      },
      include: {
        slot: { select: { dayOfWeek: true, startTime: true, endTime: true, type: true } },
      },
      orderBy: { date: 'desc' },
    });

    const total = records.length;
    const present = records.filter((r) => r.present).length;

    resp.success(res, {
      records,
      summary: { total, present, absent: total - present, percentage: total > 0 ? Math.round((present / total) * 100) : 0 },
    });
  } catch (err) {
    next(err);
  }
}
