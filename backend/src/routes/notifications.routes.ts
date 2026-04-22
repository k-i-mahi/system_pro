import { Router } from 'express';
import * as notifCtrl from '../controllers/notifications.controller.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

router.get('/', notifCtrl.listNotifications);
router.get('/unread-count', notifCtrl.getUnreadCount);
router.patch('/:id/read', notifCtrl.markRead);
router.patch('/read-all', notifCtrl.markAllRead);
router.delete('/:id', notifCtrl.deleteNotification);

export default router;
