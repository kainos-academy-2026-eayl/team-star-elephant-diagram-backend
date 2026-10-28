import { Prisma } from '@prisma/client';
import type { CreatedUser, NewUser, User } from '../models/user';
import prisma from '../prismaClient';

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email is already registered');
    this.name = 'DuplicateEmailError';
  }
}

export interface UserRepository {
  create(user: NewUser): Promise<CreatedUser>;
  findByEmail(email: string): Promise<User | null>;
}

export const prismaUserRepository: UserRepository = {
  async create({ forename, surname, email, passwordHash, createdAt, modifiedAt }) {
    try {
      return await prisma.user.create({
        data: { forename, surname, email, passwordHash, createdAt, modifiedAt },
        select: { userId: true, forename: true, surname: true, email: true, createdAt: true, modifiedAt: true },
      });
    } catch (error) {
      // P2002 = unique constraint violation; the DB constraint is the source of truth so concurrent requests can't create duplicates
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  },
  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  },
};
