export interface SeatReservation {
  seatId: string;
  userId: string;
  spaceId: string;
  reservedAt: Date;
  expiresAt: Date;
  status: 'reserved' | 'released' | 'confirmed';
}

export class ConcurrentSeatReservationService {
  private reservations = new Map<string, SeatReservation>();
  private locks = new Map<string, Promise<void>>();

  async reserveSeat(
    seatId: string,
    userId: string,
    spaceId: string,
    ttlSeconds: number = 300
  ): Promise<SeatReservation | null> {
    const lockKey = `lock:${seatId}`;
    
    let currentLock = this.locks.get(lockKey) || Promise.resolve();
    const newLock = currentLock.then(() => {
      const existing = this.reservations.get(seatId);
      
      if (existing && existing.expiresAt > new Date()) {
        return null;
      }

      const reservation: SeatReservation = {
        seatId,
        userId,
        spaceId,
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        status: 'reserved',
      };

      this.reservations.set(seatId, reservation);
      return reservation;
    });

    this.locks.set(lockKey, newLock);
    return newLock;
  }

  async releaseSeat(seatId: string): Promise<boolean> {
    const reservation = this.reservations.get(seatId);
    if (reservation) {
      reservation.status = 'released';
      this.reservations.delete(seatId);
      return true;
    }
    return false;
  }
}
