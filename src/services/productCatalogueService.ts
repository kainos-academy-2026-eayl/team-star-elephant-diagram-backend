import type { ProductCatalogueRepository } from '../repositories/productCatalogueRepository'

export class ProductCatalogueService {
  constructor(private readonly products: ProductCatalogueRepository) {}

  async getProducts(): Promise<readonly unknown[]> {
    return this.products.findAll()
  }
}
