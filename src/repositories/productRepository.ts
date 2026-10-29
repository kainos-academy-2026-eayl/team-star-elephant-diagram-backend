import type { ExpandedProductData, Product } from '../models/product';
import prisma from '../prismaClient';

export interface ProductRepository {
  findAll(): Promise<readonly Product[]>;
  findById(productId: number): Promise<ExpandedProductData | null>;
}

export const productRepository: ProductRepository = {
  async findAll() {
    const products = await prisma.product.findMany({ orderBy: { productId: 'asc' } });
    return products.map((product) => ({ ...product, price: product.price.toNumber() }));
  },

  async findById(productId) {
    const product = await prisma.product.findUnique({
      where: { productId },
      include: { inventory: { select: { quantity: true } } },
    });

    if (!product) {
      return null;
    }

    // A product may be stocked by several suppliers, each with its own inventory row.
    const quantity = product.inventory.reduce((total, row) => total + row.quantity, 0);

    return {
      productId: product.productId,
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price.toNumber(),
      imageURL: product.imageURL,
      inventory: { quantity },
    };
  },
};
