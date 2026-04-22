import { Router } from 'express';
import * as analyticsCtrl from '../controllers/analytics.controller.js';
import { getEvaluationMetrics } from '../controllers/evaluation.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { attendanceSchema, ctScoreSchema, labScoreSchema } from '../validators/profile.validator.js';

const router = Router();

router.use(authMiddleware);

router.get('/overview', analyticsCtrl.getOverview);
router.get('/suggestions', analyticsCtrl.getSuggestions);
router.get('/evaluation', getEvaluationMetrics);
router.get('/courses/:courseId', analyticsCtrl.getCourseAnalytics);
router.patch('/attendance', validate(attendanceSchema), analyticsCtrl.updateAttendance);
router.patch('/ct-score', validate(ctScoreSchema), analyticsCtrl.updateCtScore);
router.patch('/lab-score', validate(labScoreSchema), analyticsCtrl.updateLabScore);

export default router;
