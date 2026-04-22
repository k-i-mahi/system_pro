import { Router } from 'express';
import multer from 'multer';
import * as coursesCtrl from '../controllers/courses.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { createTopicSchema, updateTopicSchema, reorderTopicsSchema } from '../validators/courses.validator.js';

const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });
const router = Router();

router.use(authMiddleware);

router.get('/', coursesCtrl.listCourses);
router.get('/my-courses', coursesCtrl.myCourses);
router.get('/:courseId', coursesCtrl.getCourseDetail);

// Topics
router.post('/:courseId/topics', validate(createTopicSchema), coursesCtrl.createTopic);
router.put('/:courseId/topics/:topicId', validate(updateTopicSchema), coursesCtrl.updateTopic);
router.delete('/:courseId/topics/:topicId', coursesCtrl.deleteTopic);
router.put('/:courseId/topics/reorder', validate(reorderTopicsSchema), coursesCtrl.reorderTopics);

// Materials
router.post('/:courseId/topics/:topicId/materials', uploadLimiter, upload.single('file'), coursesCtrl.uploadMaterial);
router.post('/:courseId/topics/:topicId/materials/link', coursesCtrl.addMaterialLink);
router.delete('/:courseId/topics/:topicId/materials/:materialId', coursesCtrl.deleteMaterial);

export default router;
