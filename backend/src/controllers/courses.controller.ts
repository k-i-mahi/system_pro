import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { uploadFile, deleteFile } from '../services/cloudinary.service.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import fs from 'fs';
import { enqueueIngest } from '../jobs/queues.js';
import type { OcrQuality } from '@prisma/client';

export async function listCourses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, level, category, sort, page, limit } = req.query as any;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 12;

    const where: any = {};
    if (search) {
      where.OR = [
        { courseName: { contains: search, mode: 'insensitive' } },
        { courseCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (level && level !== 'All') where.level = level;
    if (category && category !== 'All') where.category = category;

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'az') orderBy = { courseName: 'asc' };
    else if (sort === 'za') orderBy = { courseName: 'desc' };
    else if (sort === 'popular') orderBy = { studentCount: 'desc' };

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.course.count({ where }),
    ]);

    resp.success(res, courses, { page: pageNum, limit: limitNum, total });
  } catch (err) {
    next(err);
  }
}

export async function myCourses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.userId! },
      include: {
        course: {
          include: {
            topics: {
              select: { id: true, status: true },
            },
          },
        },
      },
    });

    const courses = enrollments.map((e) => {
      const total = e.course.topics.length;
      const done = e.course.topics.filter((t) => t.status === 'DONE').length;
      return {
        ...e.course,
        progress: total > 0 ? Math.round((done / total) * 100) : 0,
        completedTopics: done,
        totalTopics: total,
        enrollmentId: e.id,
        ctScore1: e.ctScore1,
        ctScore2: e.ctScore2,
        ctScore3: e.ctScore3,
        labScore: e.labScore,
      };
    });

    resp.success(res, courses);
  } catch (err) {
    next(err);
  }
}

export async function getCourseDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.courseId },
      include: {
        topics: {
          include: {
            materials: true,
            topicProgress: req.userId ? {
              where: { userId: req.userId },
            } : false,
          },
          orderBy: { orderIndex: 'asc' },
        },
        _count: { select: { enrollments: true } },
        enrollments: req.userId ? {
          where: { userId: req.userId },
          select: {
            id: true,
            ctScore1: true,
            ctScore2: true,
            ctScore3: true,
            labScore: true,
          },
        } : false,
      },
    });

    if (!course) {
      return resp.error(res, 404, 'NOT_FOUND', 'Course not found');
    }

    const enrollment = course.enrollments?.[0] ?? null;
    const { enrollments: _e, ...courseData } = course as any;

    resp.success(res, { ...courseData, enrollment });
  } catch (err) {
    next(err);
  }
}

export async function createTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { courseId } = req.params;
    const maxOrder = await prisma.topic.findFirst({
      where: { courseId },
      orderBy: { orderIndex: 'desc' },
      select: { orderIndex: true },
    });

    const topic = await prisma.topic.create({
      data: {
        ...req.body,
        courseId,
        orderIndex: req.body.orderIndex ?? (maxOrder ? maxOrder.orderIndex + 1 : 0),
      },
      include: { materials: true },
    });

    resp.created(res, topic);
  } catch (err) {
    next(err);
  }
}

export async function updateTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const topic = await prisma.topic.update({
      where: { id: req.params.topicId },
      data: req.body,
      include: { materials: true },
    });
    resp.success(res, topic);
  } catch (err) {
    next(err);
  }
}

export async function deleteTopic(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.topic.delete({ where: { id: req.params.topicId } });
    resp.success(res, { message: 'Topic deleted' });
  } catch (err) {
    next(err);
  }
}

export async function reorderTopics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicIds } = req.body;
    const updates = topicIds.map((id: string, index: number) =>
      prisma.topic.update({ where: { id }, data: { orderIndex: index } })
    );
    await prisma.$transaction(updates);
    resp.success(res, { message: 'Topics reordered' });
  } catch (err) {
    next(err);
  }
}

export async function uploadMaterial(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return resp.error(res, 400, 'NO_FILE', 'Please upload a file');
    }

    const { topicId, courseId } = req.params;
    const { title, fileType, quality } = req.body as { title?: string; fileType?: string; quality?: string };

    const { publicId, secureUrl } = await uploadFile(
      req.file.path,
      `materials/${courseId}`
    );

    fs.unlink(req.file.path, () => {});

    const ocrQuality: OcrQuality = quality === 'accurate' ? 'ACCURATE' : 'FAST';

    const material = await prisma.material.create({
      data: {
        topicId,
        title: title || req.file.originalname,
        fileUrl: secureUrl,
        fileType: (fileType as any) || 'PDF',
        publicId,
        ocrQuality,
      },
    });

    // Update topic progress (+2% expertise for material upload)
    if (req.userId) {
      await prisma.topicProgress.upsert({
        where: { userId_topicId: { userId: req.userId, topicId } },
        create: { userId: req.userId, topicId, expertiseLevel: 0.02 },
        update: { expertiseLevel: { increment: 0.02 } },
      });

      // Fire-and-forget ingestion: extract → chunk → embed in a BullMQ worker so
      // the HTTP response returns immediately. The material surface a PENDING /
      // PROCESSING / DONE status that the UI polls.
      if (material.fileType !== 'LINK') {
        await enqueueIngest({
          materialId: material.id,
          userId: req.userId,
          quality: quality === 'accurate' ? 'accurate' : 'fast',
        });
      }
    }

    resp.created(res, material);
  } catch (err) {
    next(err);
  }
}

export async function addMaterialLink(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId } = req.params;
    const { title, fileUrl } = req.body;

    const material = await prisma.material.create({
      data: {
        topicId,
        title,
        fileUrl,
        fileType: 'LINK',
      },
    });

    resp.created(res, material);
  } catch (err) {
    next(err);
  }
}

export async function deleteMaterial(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const material = await prisma.material.findUnique({
      where: { id: req.params.materialId },
    });

    if (!material) {
      return resp.error(res, 404, 'NOT_FOUND', 'Material not found');
    }

    if (material.publicId) {
      await deleteFile(material.publicId);
    }

    await prisma.material.delete({ where: { id: req.params.materialId } });
    resp.success(res, { message: 'Material deleted' });
  } catch (err) {
    next(err);
  }
}
