import type { Product } from '../models/product';
import type { ProductRepository } from '../repositories/productRepository';

export class ProductService {
  constructor(private readonly products: ProductRepository) { }

  async getProducts(): Promise<readonly Product[]> {
    return this.products.findAll();
  }
}
