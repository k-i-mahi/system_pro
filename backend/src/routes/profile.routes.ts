import { Router } from 'express';
import multer from 'multer';
import * as profileCtrl from '../controllers/profile.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { updateProfileSchema } from '../validators/profile.validator.js';

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

router.use(authMiddleware);

router.get('/', profileCtrl.getProfile);
router.patch('/', validate(updateProfileSchema), profileCtrl.updateProfile);
router.post('/avatar', upload.single('avatar'), profileCtrl.uploadAvatar);
router.delete('/', profileCtrl.deleteAccount);

export default router;
