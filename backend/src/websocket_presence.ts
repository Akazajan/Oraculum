// Websocket presence tracking for live collaboration
import { Injectable } from '@nestjs/common';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UserPresence {
  userId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: number;
}

@Injectable()
export class PresenceTrackerService {
  private users = new Map<string, UserPresence>();
  private presence$ = new BehaviorSubject<UserPresence[]>([]);

  trackUser(userId: string, status: 'online' | 'away' | 'offline'): void {
    this.users.set(userId, { userId, status, lastSeen: Date.now() });
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
