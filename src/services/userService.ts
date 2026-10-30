import argon2 from 'argon2';
import type { CreatedUser, User } from '../models/user';
import type { UserRepository } from '../repositories/userRepository';
import type { RegisterInput } from '../validators/registerSchema';
import type { LoginRequest } from '../validators/loginSchema';
import * as jose from 'jose';

export class InvalidUserCredentialsError extends Error {
	constructor() {
		super('Invalid email or password');
		this.name = 'InvalidUserCredentialsError';
	}
}

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

function getJwtSecret(): Uint8Array {
	const secret = process.env.JWT_SECRET;
	if (!secret) {
		throw new Error('JWT_SECRET environment variable is not set');
	}
	if (secret.length < 32) {
		throw new Error('JWT_SECRET must be at least 32 characters for security (minimum high-entropy requirement)');
	}
	return new TextEncoder().encode(secret);
}

export class UserService {
	private readonly jwtSecret: Uint8Array;

	constructor(private readonly users: UserRepository) {
		this.jwtSecret = getJwtSecret();
	}

	async register({ forename, surname, email, password }: RegisterInput): Promise<CreatedUser> {
		const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
		const now = new Date();
		return this.users.create({ forename, surname, email, passwordHash, createdAt: now, modifiedAt: now, addressLine1: '', addressLine2: '', city: '', postcode: '' });
	}

	async authenticate(data: LoginRequest): Promise<User> {
		const user = await this.users.findByEmail(data.email);
		if (!user) {
			throw new InvalidUserCredentialsError();
		}
		let passwordMatches = false;
		try {
			passwordMatches = await argon2.verify(user.passwordHash, data.password);
		} catch {
			// A malformed stored hash must be indistinguishable from a wrong password.
			passwordMatches = false;
		}
		if (!passwordMatches) {
			throw new InvalidUserCredentialsError();
		}
		// Suspended accounts get the same response as bad credentials so suspension is not disclosed.
		if (user.status === 'SUSPENDED') {
			throw new InvalidUserCredentialsError();
		}
		return user;
	}

	async findById(userId: number): Promise<User | null> {
		return this.users.findById(userId);
	}

	async login(data: LoginRequest): Promise<string> {
		const user = await this.authenticate(data);
		const token = await new jose.SignJWT({ userId: user.userId, email: user.email })
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime('15m')
			.sign(this.jwtSecret);
		return token;
	}

	async verifyToken(token: string) {
		return jose.jwtVerify(token, this.jwtSecret);
	}
}
