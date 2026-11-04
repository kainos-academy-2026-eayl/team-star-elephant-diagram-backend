export interface Product {
  productId: number;
  name: string;
  category: string;
  description: string;
  price: number;
  createdAt: Date;
  modifiedAt: Date;
  imageURL: string;
}

export interface ProductInventory {
  quantity: number;
}

export interface ExpandedProductData {
  productId: number;
  name: string;
  category: string;
  description: string;
  price: number;
  imageURL: string;
  images: { url: string; altText: string | null }[];
  inventory: ProductInventory;
}

export type CreateProductInput = Pick<Product, 'name' | 'description' | 'category' | 'price' | 'imageURL'>;
