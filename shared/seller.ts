export const sellerMethods = {
  mpesa: "M-Pesa",
  emola: "e-Mola",
  bank_transfer: "Transferência bancária",
} as const;

export type SellerMethod = keyof typeof sellerMethods;

export function isSellerMethod(value: unknown): value is SellerMethod {
  return typeof value === "string" && Object.hasOwn(sellerMethods, value);
}

export interface SellerSettings {
  payment_method: SellerMethod;
  payment_recipient: string;
  recipient_name: string;
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
  }[];
}
