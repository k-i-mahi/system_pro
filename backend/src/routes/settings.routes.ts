import { Router } from 'express';
import * as settingsCtrl from '../controllers/settings.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { updateGeneralSchema, updatePasswordSchema, updateNotificationsSchema } from '../validators/settings.validator.js';

const router = Router();

router.use(authMiddleware);

router.get('/', settingsCtrl.getSettings);
router.patch('/general', validate(updateGeneralSchema), settingsCtrl.updateGeneral);
router.patch('/password', validate(updatePasswordSchema), settingsCtrl.updatePassword);
router.patch('/notifications', validate(updateNotificationsSchema), settingsCtrl.updateNotifications);

export default router;
