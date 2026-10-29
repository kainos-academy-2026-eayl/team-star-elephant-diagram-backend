import type { PaymentDetail } from '../models/paymentdetail';
import type { PaymentRepository } from '../repositories/paymentRepository';

export class PaymentService {
  constructor(private readonly payments: PaymentRepository) { }

  async getPaymentDetails(): Promise<readonly PaymentDetail[]> {
    return this.payments.findpaymentDetails();
  }
}
