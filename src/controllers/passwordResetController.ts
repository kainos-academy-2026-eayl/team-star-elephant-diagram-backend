import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
	InvalidPasswordResetError,
	PasswordResetUnavailableError,
	type PasswordResetService,
} from '../services/passwordResetService';
import { forgotPasswordSchema, resetPasswordSchema } from '../validators/passwordResetSchema';

export function passwordResetController(service: PasswordResetService): Router {
	const router = Router();
	router.use(['/forgot-password', '/reset-password'], (_req, res, next) => {
		res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
		next();
	});
	const limiter = rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 10,
		standardHeaders: 'draft-8',
		legacyHeaders: false,
		message: { error: 'Too many password reset attempts. Please try again later.' },
	});
	router.post('/forgot-password', limiter, async (req, res) => {
		const validation = forgotPasswordSchema.safeParse(req.body);
		if (!validation.success) {
			res.status(400).json({
				error: 'Invalid email address',
				details: z.flattenError(validation.error).fieldErrors,
			});
			return;
		}
		try {
			await service.request(validation.data.email);
			res.json({ status: 'ok' });
		} catch (error) {
			console.error('Password reset request failed', error);
			res.status(error instanceof PasswordResetUnavailableError ? 503 : 500)
				.json({ error: 'Password reset is temporarily unavailable. Please try again.' });
		}
	});
	router.post('/reset-password', limiter, async (req, res) => {
		const validation = resetPasswordSchema.safeParse(req.body);
		if (!validation.success) {
			res.status(400).json({
				error: 'Invalid password reset details',
				details: z.flattenError(validation.error).fieldErrors,
			});
			return;
		}
		try {
			await service.reset(validation.data.token, validation.data.password);
			res.json({ status: 'ok' });
		} catch (error) {
			if (error instanceof InvalidPasswordResetError) {
				res.status(400).json({ error: error.message });
				return;
			}
			console.error('Password reset failed', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});
	return router;
}
