import { Router, type Request, type Response } from 'express';
import type { Options as RateLimitOptions } from 'express-rate-limit';
import { z } from 'zod';
import { createAuthRateLimiter } from '../middleware/authRateLimiter';
import { DuplicateEmailError, type ShippingAddress } from '../repositories/userRepository';
import { InvalidUserCredentialsError, type UserService } from '../services/userService';
import type { AuthSessionService } from '../services/authSessionService';
import type { TokenService } from '../services/tokenService';
import { sendTokens } from './authController';
import { loginSchema } from '../validators/loginSchema';
import { registerSchema } from '../validators/registerSchema';

export function userController(
    userService: UserService,
    sessions: AuthSessionService,
    tokens: TokenService,
    rateLimitOptions: Partial<RateLimitOptions> = {},
): Router {
    const router = Router();

    router.post('/register', createAuthRateLimiter(rateLimitOptions), async (req: Request, res: Response) => {
        const registerValidation = registerSchema.safeParse(req.body);
        if (!registerValidation.success) {
            res.status(400).json({ error: 'Invalid registration details', details: z.flattenError(registerValidation.error).fieldErrors });
            return;
        }

        try {
            await userService.register(registerValidation.data);
            res.status(201).json({ status: 'created' });
        } catch (error) {
            if (error instanceof DuplicateEmailError) {
                res.status(400).json({ error: error.message });
                return;
            }
            console.error('Registration failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/login', createAuthRateLimiter(rateLimitOptions), async (req: Request, res: Response) => {
        const loginValidation = loginSchema.safeParse(req.body);
        if (!loginValidation.success) {
            res.status(400).json({
                error: 'Invalid login details',
                details: z.flattenError(loginValidation.error).fieldErrors,
            });
            return;
        }
        try {
            const user = await userService.authenticate(loginValidation.data);
            const credentials = await sessions.create({ kind: 'customer', userId: user.userId, email: user.email });
            res.status(200).json({
                status: 'Success',
                ...sendTokens(res, credentials),
                token: credentials.accessToken,
            });
        } catch (error) {
            if (error instanceof InvalidUserCredentialsError) {
                res.status(401).json({ error: error.message });
                return;
            }
            console.error('Customer login failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/profile', async (req, res) => {
        const header = req.get('authorization') ?? '';
        const payload = header.startsWith('Bearer ') ? await tokens.verifyCustomerAccessToken(header.slice(7)) : null;
        if (!payload || typeof payload.userId !== 'number') {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }
        try {
            const user = await userService.findById(payload.userId);
            if (!user) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            res.set('Cache-Control', 'no-store').json({
                user: {
                    firstName: user.forename,
                    lastName: user.surname,
                    email: user.email,
                    memberSince: user.createdAt.toISOString().slice(0, 10),
                    userId: user.userId,
                    addressLine1: user.addressLine1,
                    addressLine2: user.addressLine2,
                    city: user.city,
                    postcode: user.postcode,
                },
                orders: [],
                ordersUnavailable: true,
            });
        } catch (error) {
            console.error('Profile lookup failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/profile/shipping-address', async (req, res) => {
        const header = req.get('authorization') ?? '';
        const payload = header.startsWith('Bearer ') ? await tokens.verifyCustomerAccessToken(header.slice(7)) : null;
        if (!payload || typeof payload.userId !== 'number') {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const addressValidation = z.object({
            addressLine1: z.string().min(1).max(100),
            addressLine2: z.string().max(100).optional(),
            city: z.string().min(1).max(50),
            postcode: z.string().min(1).max(20),
        }).safeParse(req.body);

        if (!addressValidation.success) {
            res.status(400).json({ error: 'Invalid address details', details: z.flattenError(addressValidation.error).fieldErrors });
            return;
        }

        try {
            const validatedData = addressValidation.data;
            const address: ShippingAddress = {
                addressLine1: validatedData.addressLine1,
                city: validatedData.city,
                postcode: validatedData.postcode,
            };
            if (validatedData.addressLine2) {
                address.addressLine2 = validatedData.addressLine2;
            }
            const updatedUser = await userService.updateShippingAddress(payload.userId, address);
            if (!updatedUser) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }
            res.status(200).json({
                status: 'updated',
                user: {
                    addressLine1: updatedUser.addressLine1,
                    addressLine2: updatedUser.addressLine2,
                    city: updatedUser.city,
                    postcode: updatedUser.postcode,
                },
            });
        } catch (error) {
            console.error('Address update failed', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
