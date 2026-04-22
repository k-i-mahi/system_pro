import { Router } from 'express';
import multer from 'multer';
import * as communityCtrl from '../controllers/community.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import {
  createThreadSchema,
  createPostSchema,
  createCommunitySchema,
  joinCommunitySchema,
  createAnnouncementSchema,
  recordAttendanceSchema,
} from '../validators/community.validator.js';

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.use(authMiddleware);

// ─── Thread / Discussion routes (existing) ─────────────────
router.get('/threads', communityCtrl.listThreads);
router.post('/threads', validate(createThreadSchema), communityCtrl.createThread);
router.get('/threads/:id', communityCtrl.getThread);
router.post('/threads/:id/posts', validate(createPostSchema), communityCtrl.createPost);
router.delete('/threads/:id', communityCtrl.deleteThread);
router.post('/threads/:id/like', communityCtrl.likeThread);
router.delete('/threads/:id/like', communityCtrl.unlikeThread);

// ─── Community / Classroom routes ──────────────────────────
router.post('/', requireRole('TUTOR', 'ADMIN'), validate(createCommunitySchema), communityCtrl.createCommunity);
router.get('/', communityCtrl.listCommunities);
router.get('/:id', communityCtrl.getCommunity);
router.post('/:id/join', validate(joinCommunitySchema), communityCtrl.joinCommunity);
router.delete('/:id/leave', communityCtrl.leaveCommunity);
router.delete('/:id/members/:userId', requireRole('TUTOR', 'ADMIN'), communityCtrl.removeMember);

// ─── Announcements ─────────────────────────────────────────
router.post('/:id/announcements', requireRole('TUTOR', 'ADMIN'), validate(createAnnouncementSchema), communityCtrl.createAnnouncement);
router.get('/:id/announcements', communityCtrl.listAnnouncements);
router.delete('/:id/announcements/:announcementId', communityCtrl.deleteAnnouncement);

// ─── Marks ─────────────────────────────────────────────────
router.post('/:id/marks/upload', requireRole('TUTOR', 'ADMIN'), uploadLimiter, upload.single('file'), communityCtrl.uploadMarks);
router.get('/:id/marks/history', communityCtrl.getMarksHistory);
router.get('/:id/marks/scores', communityCtrl.getCommunityScores);

// ─── Attendance ────────────────────────────────────────────
router.post('/:id/attendance', requireRole('TUTOR', 'ADMIN'), validate(recordAttendanceSchema), communityCtrl.recordAttendance);
router.get('/:id/attendance', communityCtrl.getCommunityAttendance);
router.get('/:id/attendance/me', communityCtrl.getMyAttendance);

export default router;
