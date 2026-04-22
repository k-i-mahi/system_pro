import { Router } from 'express';
import multer from 'multer';
import * as routineCtrl from '../controllers/routine.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { bulkCreateCoursesSchema, updateSlotSchema, moveSlotSchema } from '../validators/routine.validator.js';

const ACCEPTED_MIMES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload an image, PDF, or DOCX file.'));
    }
  },
});
const router = Router();

router.use(authMiddleware);

router.post('/scan', uploadLimiter, upload.single('file'), routineCtrl.scanRoutine);
router.get('/', routineCtrl.getSchedule);
router.post('/courses', validate(bulkCreateCoursesSchema), routineCtrl.bulkCreateCourses);
router.put('/slots/:id', validate(updateSlotSchema), routineCtrl.updateSlot);
router.put('/slots/:id/move', validate(moveSlotSchema), routineCtrl.moveSlot);
router.delete('/slots/:id', routineCtrl.deleteSlot);
router.delete('/courses/:id', routineCtrl.deleteCourse);

export default router;
