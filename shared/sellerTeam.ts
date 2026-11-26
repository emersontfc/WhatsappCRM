export const sellerTeamRoles = {
  owner: "Titular",
  operator: "Vendedor",
  finance_admin: "Responsável financeiro"
} as const;

export type SellerTeamRole = keyof typeof sellerTeamRoles;

export type SellerTeamCompany = {
  organizationId: string;
  name: string;
  role: SellerTeamRole;
  linked: boolean;
};

export type SellerTeamMember = { userId: string; email: string; role: SellerTeamRole };

export type SellerTask = {
  id: string;
  kind: "payment" | "delivery" | "notice" | "private_proof" | "handoff";
  title: string;
  detail: string;
  updatedAt: string;
  orderNumber?: string;
  action: "orders" | "review" | "delivery" | "retry_notice" | "close_intake" | "conversation";
  contactId?: string;
  contactLabel?: string;
};
