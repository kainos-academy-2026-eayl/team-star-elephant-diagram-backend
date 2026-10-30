export interface BasketItem {
    productId: number;
    productName: string;
    quantity: number;
    unitPrice: number;
    imageURL: string;
}

export interface Basket {
    items: BasketItem[];
    subtotal: number;
}
