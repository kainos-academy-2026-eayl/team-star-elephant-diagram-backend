import * as jose from 'jose';
import { randomUUID } from 'node:crypto';

export async function generateCustomerAccessToken(userId = 1, email = 'test@example.com', now = Date.now()) {
	const secret = new TextEncoder().encode(process.env.JWT_SECRET || process.env.CUSTOMER_ACCESS_TOKEN_SECRET);
	const expirationTime = Math.floor(now / 1000) + (15 * 60); // 15 minutes from now

	const token = await new jose.SignJWT({
		kind: 'customer',
		userId,
		email,
		tokenUse: 'access',
		sub: String(userId),
	})
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setIssuedAt(Math.floor(now / 1000))
		.setExpirationTime(expirationTime)
		.setIssuer('star-elephant')
		.setAudience('star-elephant-api')
		.setSubject(String(userId))
		.setJti(randomUUID())
		.sign(secret);

	return token;
}
