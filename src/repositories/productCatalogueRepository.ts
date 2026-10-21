export interface ProductCatalogueRepository {
  findAll(): Promise<readonly unknown[]>;
}

export const productCatalogueRepository: ProductCatalogueRepository = {
  async findAll() {
    return [];
  },
};
