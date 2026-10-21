export interface ProductCatalogueRepository {
  findAll(): Promise<readonly unknown[]>;
}

