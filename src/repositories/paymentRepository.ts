import type { PaymentDetail } from '../models/paymentdetail';
import prisma from '../prismaClient';

export interface PaymentRepository {
    findpaymentDetails(): Promise<readonly PaymentDetail[]>;
}

export const paymentRepository: PaymentRepository = {
    async findpaymentDetails() {
        const payments = await prisma.paymentDetail.findMany({ orderBy: { paymentId: 'asc' } });
        return payments;
    },
};