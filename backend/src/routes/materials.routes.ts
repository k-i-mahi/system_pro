import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../config/database.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

/** GET /api/materials/:id — minimal metadata needed by MaterialPreviewPane. */
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const material = await prisma.material.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        fileType: true,
        ingestStatus: true,
        hasEmbeddings: true,
        chunkCount: true,
        topic: { select: { id: true, title: true, courseId: true } },
      },
    });
    if (!material) return resp.error(res, 404, 'NOT_FOUND', 'Material not found');
    return resp.success(res, material);
  } catch (err) {
    next(err);
  }
});

export default router;
