import { Prisma } from '@prisma/client';
import prisma from '../prismaClient';

export interface CreatedUser {
  id: number;
  email: string;
  createdAt: Date;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('Email is already registered');
    this.name = 'DuplicateEmailError';
  }
}

export interface UserRepository {
  create(email: string, passwordHash: string): Promise<CreatedUser>;
}

export const prismaUserRepository: UserRepository = {
  async create(email, passwordHash) {
    try {
      return await prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, createdAt: true },
      });
    } catch (error) {
      // P2002 = unique constraint violation; the DB constraint is the source of truth so concurrent requests can't create duplicates
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  },
};
