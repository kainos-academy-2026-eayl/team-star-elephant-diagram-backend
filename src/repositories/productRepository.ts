import type { CreateProductInput, ExpandedProductData, Product } from '../models/product';
import prisma from '../prismaClient';

export interface ProductRepository {
  findAll(): Promise<readonly Product[]>;
  findById(productId: number): Promise<ExpandedProductData | null>;
  findByIds(productIds: readonly number[]): Promise<readonly Pick<Product, 'productId' | 'name' | 'price' | 'imageURL'>[]>;
  create(product: CreateProductInput): Promise<Product>;
}

export const productRepository: ProductRepository = {
  async findAll() {
    const products = await prisma.product.findMany({ orderBy: { productId: 'asc' } });
    return products.map((product) => ({ ...product, price: product.price.toNumber() }));
  },

  async findById(productId) {
    const product = await prisma.product.findUnique({
      where: { productId },
      include: {
        inventory: { select: { quantity: true } },
        images: { orderBy: { position: 'asc' }, select: { url: true, altText: true } },
      },
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
      images: product.images,
      inventory: { quantity },
    };
  },

  async findByIds(productIds) {
    if (productIds.length === 0) {
      return [];
    }

    const products = await prisma.product.findMany({
      where: { productId: { in: [...productIds] } },
      select: { productId: true, name: true, price: true, imageURL: true },
    });
    return products.map((product) => ({ ...product, price: product.price.toNumber() }));
  },

  async create({ name, description, category, price, imageURL }) {
    const product = await prisma.product.create({ data: { name, description, category, price, imageURL } });
    return { ...product, price: product.price.toNumber() };
  },
};
