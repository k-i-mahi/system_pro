import { Router } from 'express';
import * as aiTutorCtrl from '../controllers/ai-tutor.controller.js';
import { askCourse } from '../controllers/ask-course.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { chatSchema, generateQuizSchema, submitQuizSchema, searchResourcesSchema } from '../validators/ai-tutor.validator.js';

const router = Router();

router.use(authMiddleware);
router.use(aiLimiter);

router.post('/chat', validate(chatSchema), aiTutorCtrl.chat);
router.post('/generate-quiz', validate(generateQuizSchema), aiTutorCtrl.generateQuiz);
router.post('/submit-quiz', validate(submitQuizSchema), aiTutorCtrl.submitQuiz);
router.get('/search-resources', validate(searchResourcesSchema, 'query'), aiTutorCtrl.searchResources);
router.post('/ask-course', askCourse);

export default router;
