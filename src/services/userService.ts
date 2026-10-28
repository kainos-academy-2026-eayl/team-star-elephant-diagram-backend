import argon2 from 'argon2';
import type { CreatedUser } from '../models/user';
import type { UserRepository } from '../repositories/userRepository';
import type { RegisterInput } from '../validators/registerSchema';
import type { LoginRequest } from '../validators/loginSchema';
import * as jose from 'jose';

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class UserService {
  constructor(private readonly users: UserRepository) { }

  async register({ forename, surname, email, password}: RegisterInput): Promise<CreatedUser> {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const now = new Date();
    return this.users.create({ forename, surname, email, passwordHash, createdAt: now, modifiedAt: now, addressLine1: '', addressLine2: '', city: '', postcode: '' });
  }

  async login(data: LoginRequest): Promise<any> {
    const user = await this.users.findByEmail(data.email);
    if (!user) {
      throw new Error('Invalid email or password');
    }
    if (!await argon2.verify(user.passwordHash, data.password)) {
      throw new Error('Invalid email or password');
    }
    const token = await new jose.SignJWT({ userId: user.id, email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('secret'));
    console.log('Access Token:', token); //DEV DEBUG PRINT
    return token;
  }
  async verifyToken(token: string): Promise<any> {
    return jose.jwtVerify(token, new TextEncoder().encode('secret'));
  }
}
