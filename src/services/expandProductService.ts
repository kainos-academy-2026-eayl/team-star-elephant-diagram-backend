import type { ExpandedProductData } from '../models/product';
import type { ProductRepository } from '../repositories/productRepository';

export class ProductNotFoundError extends Error {
  constructor(productId: number) {
    super(`Product with ID ${productId} not found`);
  }
}

export class ExpandProductService {
  constructor(private readonly productRepository: ProductRepository) { }

  async getProductExpanded(productId: number): Promise<ExpandedProductData> {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return product;
  }
}
