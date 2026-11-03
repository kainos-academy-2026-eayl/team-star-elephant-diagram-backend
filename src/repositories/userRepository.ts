import { Prisma } from '@prisma/client';
import type { CreatedUser, NewUser, User, UserStatus } from '../models/user';
import prisma from '../prismaClient';

export type UserSummaryRecord = Pick<User, 'userId' | 'forename' | 'surname' | 'email' | 'createdAt' | 'status'>;

export interface UserListQuery {
  search?: string | undefined;
  skip: number;
  take: number;
}

export interface UserListResult {
  users: UserSummaryRecord[];
  total: number;
}

export interface UserOrderRecord {
  orderId: number;
  orderPlacedAt: Date;
  orderStatus: string;
  cost: { toString(): string };
}

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
  list(query: UserListQuery): Promise<UserListResult>;
  findRecentOrders(userId: number, take: number): Promise<UserOrderRecord[]>;
  updateStatus(userId: number, status: UserStatus): Promise<Pick<User, 'userId' | 'status'> | null>;
}

const userSummarySelect = { userId: true, forename: true, surname: true, email: true, createdAt: true, status: true } as const;

// Every whitespace-separated term must match forename, surname or email, so "ada lovelace" finds Ada Lovelace.
function searchFilter(search: string | undefined): Prisma.UserWhereInput {
  const terms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    AND: terms.map((term) => ({
      OR: [
        { forename: { contains: term, mode: 'insensitive' } },
        { surname: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ],
    })),
  };
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
  async list({ search, skip, take }): Promise<UserListResult> {
    const where = searchFilter(search);
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: userSummarySelect,
        orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);
    return { users, total };
  },
  findRecentOrders(userId, take) {
    return prisma.order.findMany({
      where: { userId },
      select: { orderId: true, orderPlacedAt: true, orderStatus: true, cost: true },
      orderBy: [{ orderPlacedAt: 'desc' }, { orderId: 'desc' }],
      take,
    });
  },
  async updateStatus(userId, status) {
    try {
      return await prisma.user.update({ where: { userId }, data: { status }, select: { userId: true, status: true } });
    } catch (error) {
      // P2025 = record to update not found
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  },
};
