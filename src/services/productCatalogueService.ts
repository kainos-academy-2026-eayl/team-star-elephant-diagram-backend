import type { Product } from '../models/product';
import type { ProductCatalogueRepository } from '../repositories/productCatalogueRepository';

export class ProductCatalogueService {
  constructor(private readonly products: ProductCatalogueRepository) { }

  async getProducts(): Promise<readonly Product[]> {
    return this.products.findAll();
  }
}
