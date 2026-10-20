import argon2 from 'argon2'
import type { CreatedUser, UserRepository } from '../repositories/userRepository'
import type { RegisterInput } from '../validators/registerSchema'

// OWASP Password Storage Cheat Sheet minimum for argon2id: 19 MiB memory, 2 iterations, 1 degree of parallelism
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export class UserService {
  constructor(private readonly users: UserRepository) {}

  async register({ forename, surname, email, password }: RegisterInput): Promise<CreatedUser> {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS)
    const now = new Date()
    return this.users.create({ forename, surname, email, passwordHash, createdAt: now, modifiedAt: now })
  }
}
