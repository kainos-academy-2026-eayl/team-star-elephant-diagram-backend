import type { Product } from '../models/product';
import prisma from '../prismaClient';

export interface ProductRepository {
  findAll(): Promise<readonly Product[]>;
}

export const productRepository: ProductRepository = {
  async findAll() {
    const products = await prisma.product.findMany({ orderBy: { productId: 'asc' } });
    return products.map((product) => ({ ...product, price: product.price.toNumber() }));
  },
};
