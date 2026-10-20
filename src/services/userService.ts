import bcrypt from 'bcryptjs'
import type { CreatedUser, UserRepository } from '../repositories/userRepository'
import type { RegisterInput } from '../validators/registerSchema'

const BCRYPT_COST = 12

export class UserService {
  constructor(private readonly users: UserRepository) {}

  async register({ email, password }: RegisterInput): Promise<CreatedUser> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    return this.users.create(email, passwordHash)
  }
}
