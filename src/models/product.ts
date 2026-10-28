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
