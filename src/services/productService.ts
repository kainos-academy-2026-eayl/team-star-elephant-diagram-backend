import type { ExpandedProductData, Product } from '../models/product';
import type { ProductRepository } from '../repositories/productRepository';

export class ProductNotFoundError extends Error {
  constructor(productId: number) {
    super(`Product with ID ${productId} not found`);
  }
}

export class ProductService {
  constructor(private readonly products: ProductRepository) { }

  async getProducts(): Promise<readonly Product[]> {
    return this.products.findAll();
  }

  async getProductById(productId: number): Promise<ExpandedProductData> {
    const product = await this.products.findById(productId);

    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return product;
  }
}
