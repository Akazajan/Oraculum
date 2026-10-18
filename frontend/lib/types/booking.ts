import type { KoboAmount, NairaAmount } from "./payment";

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED";

export type PlanType =
  | "HOURLY"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY";

export interface Booking {
  id: string;
  userId: string;
  workspaceId: string;
  planType: PlanType;
  startDate: string;
  endDate: string;
  totalAmount: KoboAmount;
  status: BookingStatus;
  seatCount: number;
  notes?: string;
  sorobanEscrowId?: string;
  createdAt: string;
  updatedAt: string;
  workspace?: {
    id: string;
    name: string;
    type: string;
  };
}

export interface CreateBookingDto {
  workspaceId: string;
  planType: PlanType;
  startDate: string;
  endDate: string;
  seatCount: number;
  notes?: string;
}

export interface PriceEstimate {
  totalAmount: KoboAmount;
  totalAmountNaira: NairaAmount;
  planType: PlanType;
  seatCount: number;
  startDate: string;
  endDate: string;
}
