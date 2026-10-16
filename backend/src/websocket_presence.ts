// Websocket presence tracking for live collaboration
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UserPresence {
  userId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: number;
}

export interface PresenceUpdate {
  userId: string;
  status: 'online' | 'away' | 'offline';
}

@Injectable()
export class PresenceTrackerService {
  private users = new Map<string, UserPresence>();
  private presence$ = new BehaviorSubject<UserPresence[]>([]);

  /**
   * B54 — Requires an authenticated identity before accepting a
   * presence change. A client can only mutate its own presence entry.
   */
  trackUser(authenticatedUserId: string, update: PresenceUpdate): void {
    if (!authenticatedUserId || authenticatedUserId.trim() === '') {
      throw new UnauthorizedException(
        'Authenticated identity required for presence updates',
      );
    }

    if (update.userId !== authenticatedUserId) {
      throw new UnauthorizedException(
        `Cannot publish presence for another user (${update.userId})`,
      );
    }

    this.users.set(authenticatedUserId, {
      userId: authenticatedUserId,
      status: update.status,
      lastSeen: Date.now(),
    });
    this.updatePresence();
  }

  removeUser(userId: string): void {
    this.users.delete(userId);
    this.updatePresence();
  }

  getConnectedUsers(): Observable<UserPresence[]> {
    return this.presence$.asObservable();
  }

  private updatePresence(): void {
    const connected = Array.from(this.users.values())
      .filter(u => u.status === 'online');
    this.presence$.next(connected);
  }
}
