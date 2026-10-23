import { OrderStatus, PaymentProvider } from "@prisma/client";

export interface CartAllocationItem {
  nomineeId: string;
  nomineeCode: string;
  nomineeName: string;
  categoryId: string;
  categoryTitle: string;
  avatarUrl?: string | null;
  numberOfVotes: number;
}

export interface VotingCartState {
  eventId: string;
  items: CartAllocationItem[];
  voterPhone: string;
  voterEmail: string;
}

export interface CalculatedAllocation {
  nomineeId: string;
  nomineeCode: string;
  nomineeName: string;
  categoryId: string;
  categoryTitle: string;
  numberOfVotes: number;
  unitPriceInPesewas: number;
  subtotalInPesewas: number;
}

export interface CalculatedOrderSummary {
  eventId: string;
  totalVotes: number;
  unitPriceInPesewas: number;
  totalAmountInPesewas: number;
  allocations: CalculatedAllocation[];
}

export interface CreateVotingOrderParams {
  eventId: string;
  voterPhone: string;
  voterEmail: string;
  allocations: Array<{
    nomineeId: string;
    numberOfVotes: number;
  }>;
  idempotencyKey?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VotingOrderDto {
  id: string;
  orderNumber: string;
  eventId: string;
  maskedPhone: string;
  voterEmail?: string | null;
  totalVotes: number;
  unitPriceInPesewas: number;
  totalAmountInPesewas: number;
  status: OrderStatus;
  initiatedAt: Date;
  paidAt?: Date | null;
  allocations: Array<{
    id: string;
    nomineeId: string;
    nomineeName: string;
    nomineeCode: string;
    categoryTitle: string;
    numberOfVotes: number;
    subtotalInPesewas: number;
  }>;
}

export interface PaymentGatewayAdapter {
  provider: PaymentProvider;
  initializePayment(params: {
    orderNumber: string;
    amountInPesewas: number;
    currency: string;
    customerEmail?: string;
    customerPhone: string;
    orderType: "VOTING" | "TICKET";
    callbackUrl: string;
  }): Promise<{
    gatewayReference: string;
    checkoutUrl: string;
  }>;
  verifyPayment(gatewayReference: string): Promise<{
    success: boolean;
    amountInPesewas: number;
    currency: string;
    status: OrderStatus;
    rawPayload?: unknown;
  }>;
}
