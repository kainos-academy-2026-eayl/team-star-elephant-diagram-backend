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
  inventory: ProductInventory;
}


