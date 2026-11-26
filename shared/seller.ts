export const sellerMethods = {
  mpesa: "M-Pesa",
  emola: "e-Mola",
  bank_transfer: "Transferência bancária",
} as const;

export type SellerMethod = keyof typeof sellerMethods;
export const sellerMethodKeys = Object.keys(sellerMethods) as SellerMethod[];

export interface PaymentDestination {
  recipient: string;
  name: string;
}

export type PaymentDestinations = Partial<Record<SellerMethod, PaymentDestination>>;
export interface OrderPayment extends PaymentDestination {
  method: SellerMethod;
}

export interface RecipientEvidence {
  recipientName?: string;
  recipientAccount?: string;
  recipientMatch?: "match" | "mismatch" | "unknown";
}

export function isSellerMethod(value: unknown): value is SellerMethod {
  return typeof value === "string" && Object.hasOwn(sellerMethods, value);
}

const reservationTime = new Intl.DateTimeFormat("pt-MZ", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Maputo" });

export function sellerReservationLabel(status: string, expiresAt?: string | null): string | null {
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(expires)) return null;
  if (status === "verification_pending") return "Stock reservado durante a revisão.";
  if (status !== "created" && status !== "awaiting_payment") return null;
  return expires <= Date.now() ? "Prazo da reserva terminado." : `Stock reservado até ${reservationTime.format(expires)} (hora de Maputo).`;
}

export interface SellerSettings {
  payment_method: SellerMethod;
  payment_recipient: string;
  recipient_name: string;
  payment_destinations: PaymentDestinations;
  notification_phone: string | null;
}

export interface SellerOverview {
  settings: SellerSettings | null;
  whatsappConnected: boolean;
  agentActive: boolean;
  products: number;
  readyProducts: number;
  pendingReviews: number;
  pendingDeliveries: number;
  orders: {
    id: string;
    order_number: string;
    customer_name: string | null;
    status: string;
    total_amount: number;
    currency: string;
    created_at: string;
    reservation_expires_at?: string | null;
  }[];
}
