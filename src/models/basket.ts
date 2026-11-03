export interface BasketItem {
    productId: number;
    productName: string;
    quantity: number;
    unitPrice: number;
    imageURL: string;
}

export interface Basket {
    userId: number;
    items: BasketItem[];
    subtotal: number;
}
