import { Router } from 'express';
import authRoutes from './auth.routes.js';
import routineRoutes from './routine.routes.js';
import coursesRoutes from './courses.routes.js';
import aiTutorRoutes from './ai-tutor.routes.js';
import communityRoutes from './community.routes.js';
import notificationsRoutes from './notifications.routes.js';
import analyticsRoutes from './analytics.routes.js';
import settingsRoutes from './settings.routes.js';
import profileRoutes from './profile.routes.js';
import materialsRoutes from './materials.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/routine', routineRoutes);
router.use('/courses', coursesRoutes);
router.use('/ai-tutor', aiTutorRoutes);
router.use('/community', communityRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/settings', settingsRoutes);
router.use('/profile', profileRoutes);
router.use('/materials', materialsRoutes);

export default router;
