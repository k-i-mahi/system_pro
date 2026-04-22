import { Router } from 'express';
import * as authCtrl from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import {
  registerSchema, loginSchema, refreshSchema,
  forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), authCtrl.register);
router.post('/login', authLimiter, validate(loginSchema), authCtrl.login);
router.post('/refresh', validate(refreshSchema), authCtrl.refresh);
router.post('/logout', authMiddleware, authCtrl.logout);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), authCtrl.forgotPassword);
router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), authCtrl.verifyOtp);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), authCtrl.resetPassword);
router.get('/me', authMiddleware, authCtrl.getMe);

export default router;
