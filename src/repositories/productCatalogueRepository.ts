import prisma from '../prismaClient';

export interface ProductCatalogueRepository {
  findAll(): Promise<readonly unknown[]>;
}

export const productCatalogueRepository: ProductCatalogueRepository = {
  async findAll() {
    const products = await prisma.product.findMany({ orderBy: { prod_id: 'asc' } });
    return products.map((product) => ({ ...product, price: product.price.toNumber() }));
  },
};
