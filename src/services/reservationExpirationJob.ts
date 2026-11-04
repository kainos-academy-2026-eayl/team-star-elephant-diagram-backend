import type { ReservationService } from './reservationService';

export class ReservationExpirationJob {
	private intervalId: NodeJS.Timeout | null = null;
	private readonly CHECK_INTERVAL_SECONDS = 60; // Check every minute

	constructor(private readonly reservationService: ReservationService) {}

	start(): void {
		if (this.intervalId) {
			console.log('Reservation expiration job already running');
			return;
		}

		console.log(
			`Starting reservation expiration job (checking every ${this.CHECK_INTERVAL_SECONDS} seconds)`,
		);

		this.intervalId = setInterval(() => {
			this.expireReservations().catch((error) => {
				console.error('Error expiring reservations:', error);
			});
		}, this.CHECK_INTERVAL_SECONDS * 1000);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			console.log('Reservation expiration job stopped');
		}
	}

	private async expireReservations(): Promise<void> {
		try {
			const expiredCount = await this.reservationService.expireOldReservations();
			if (expiredCount > 0) {
				console.log(`Expired ${expiredCount} reservation(s) and restored inventory`);
			}
		} catch (error) {
			console.error('Failed to expire reservations:', error);
		}
	}
}
