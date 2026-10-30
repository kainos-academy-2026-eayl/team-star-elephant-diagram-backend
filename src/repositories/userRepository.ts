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
  findById(userId: number): Promise<User | null>;
}

export const prismaUserRepository: UserRepository = {
  findById(userId) {
    return prisma.user.findUnique({ where: { userId } });
  },
  async create({ forename, surname, email, passwordHash, createdAt, modifiedAt, addressLine1, addressLine2, city, postcode }) {
    try {
      return await prisma.user.create({
        data: { forename, surname, email, passwordHash, createdAt, modifiedAt, addressLine1, addressLine2, city, postcode },
        select: { userId: true, forename: true, surname: true, email: true, createdAt: true, modifiedAt: true, addressLine1: true, addressLine2: true, city: true, postcode: true },
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
