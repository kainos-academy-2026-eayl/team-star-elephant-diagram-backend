import { z } from 'zod';

export const createProductSchema = z.object({
	imageURL: z.string({ error: 'Image URL is required' }).trim()
		.min(1, 'Image URL is required').max(255, 'Image URL must be at most 255 characters')
		.pipe(z.url({ protocol: /^https?$/, error: 'Image URL must be a valid http(s) URL' })),
	name: z.string({ error: 'Name is required' }).trim()
		.min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
	description: z.string({ error: 'Description is required' }).trim()
		.min(1, 'Description is required').max(255, 'Description must be at most 255 characters'),
	category: z.string({ error: 'Category is required' }).trim()
		.min(1, 'Category is required').max(100, 'Category must be at most 100 characters'),
	price: z.union([
		z.number(),
		z.string().trim().regex(/^\d+(\.\d+)?$/, 'Price must be a number').transform(Number),
	], { error: 'Price is required' }).pipe(z.number()
		.finite('Price must be a number').gt(0, 'Price must be greater than zero')
		.max(99_999_999.99, 'Price must be at most 99999999.99')
		.refine((price) => Math.round(price * 100) / 100 === price, 'Price must have at most 2 decimal places')),
});
