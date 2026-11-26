import { sellerTeamRoles, type SellerTask, type SellerTeamCompany, type SellerTeamRole } from "../../shared/sellerTeam.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export const sellerTeamId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type SellerTeamAccess = Omit<SellerTeamCompany, "linked"> & { accountId: string };
type WorkAccount = Pick<SellerTeamAccess, "accountId" | "role">;

export function isSellerTeamRole(value: unknown): value is SellerTeamRole {
  return typeof value === "string" && Object.hasOwn(sellerTeamRoles, value);
}

export function parseSellerTeamAccess(data: any): SellerTeamAccess | null {
  return data && typeof data.account_id === "string" && sellerTeamId.test(data.account_id) &&
    typeof data.organization_id === "string" && sellerTeamId.test(data.organization_id) &&
    typeof data.name === "string" && isSellerTeamRole(data.role)
    ? { organizationId: data.organization_id, accountId: data.account_id, role: data.role, name: data.name }
    : null;
}

export async function resolveSellerTeamAccess(actorId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin.rpc("agentx_seller_team_access", { p_actor: actorId, p_org: organizationId })
    .abortSignal(AbortSignal.timeout(6_000));
  if (error?.code === "42501" || error?.code === "P0002") return null;
  if (error) throw error;
  const access = parseSellerTeamAccess(data);
  return access?.organizationId === organizationId ? access : null;
}

export async function sellerTeamTasks({ accountId, role }: WorkAccount): Promise<SellerTask[]> {
  const financial = role !== "operator";
  const sales = role !== "finance_admin";
  const signal = AbortSignal.timeout(8_000);
  const [reviews, deliveries, notices, intake, handoffs] = await Promise.all([
    supabaseAdmin.from("orders").select("id,order_number,updated_at")
      .eq("user_id", accountId).eq("status", "verification_pending")
      .order("updated_at", { ascending: false }).limit(30).abortSignal(signal),
    sales ? supabaseAdmin.from("orders").select("id,order_number,updated_at,delivery_started_at,delivery_error")
      .eq("user_id", accountId).eq("status", "paid")
      .order("updated_at", { ascending: false }).limit(30).abortSignal(signal) : null,
    financial ? supabaseAdmin.from("agentx_seller_notices")
      .select("id,kind,status,reason,updated_at,order_revision,orders!inner(order_number,status,updated_at),payment_verifications(status)")
      .eq("user_id", accountId).eq("orders.user_id", accountId).in("orders.status", ["verification_pending", "rejected"])
      .in("status", ["retry", "failed", "uncertain"])
      .order("updated_at", { ascending: false }).limit(30).abortSignal(signal) : null,
    financial ? supabaseAdmin.from("agentx_direct_proof_intake_events").select("id,contact_id,reason,created_at,contacts!inner(name,phone)")
      .eq("user_id", accountId).eq("contacts.user_id", accountId).is("resolved_at", null)
      .order("created_at", { ascending: false }).limit(30).abortSignal(signal) : null,
    role === "owner" ? supabaseAdmin.from("agentx_human_handoffs").select("id,contact_id,status,updated_at,contacts!inner(ai_paused)")
      .eq("user_id", accountId).eq("contacts.user_id", accountId).eq("contacts.ai_paused", true)
      .in("status", ["retry", "failed", "uncertain"]).order("updated_at", { ascending: false }).limit(30).abortSignal(signal) : null
  ]);
  const failure = [reviews, deliveries, notices, intake, handoffs].find((result) => result?.error);
  if (failure?.error) throw failure.error;

  const reviewTasks: SellerTask[] = (reviews.data ?? []).map((row) => ({
    id: row.id, kind: "payment", title: "Comprovativo por rever", orderNumber: row.order_number,
    detail: financial ? "Confere o recebimento no prestador antes de aprovar." : "O responsável financeiro tem o pedido em fila.",
    updatedAt: row.updated_at, action: financial ? "review" : "orders"
  }));
  const deliveryTasks: SellerTask[] = (deliveries?.data ?? []).map((row) => ({
    id: row.id, kind: "delivery", title: row.delivery_started_at ? "Entrega por confirmar" : "Entrega pendente",
    detail: row.delivery_started_at ? "Confere a conversa antes de registar o resultado da entrega."
      : row.delivery_error ? "Abre o pedido para resolver o problema e verificar se é possível tentar novamente."
        : "Abre o pedido pago para tratar da entrega.",
    orderNumber: row.order_number, updatedAt: row.updated_at, action: "delivery"
  }));
  const noticeTasks: SellerTask[] = (notices?.data ?? []).flatMap((row): SellerTask[] => {
    const related = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const proof = Array.isArray(row.payment_verifications) ? row.payment_verifications[0] : row.payment_verifications;
    if (row.kind === "proof_review" ? related?.status !== "verification_pending" || proof?.status !== "pending"
      : related?.status !== "rejected" || related?.updated_at !== row.order_revision) return [];
    const canRetry = row.status === "failed" && ["whatsapp_offline", "missing_recipient"].includes(row.reason);
    return [{
      id: row.id, kind: "notice", title: row.kind === "proof_review" ? "Aviso de comprovativo" : "Aviso ao cliente",
      detail: row.status === "uncertain" ? "O WhatsApp não confirmou o envio. Confere a conversa antes de enviar outro aviso."
        : row.status === "retry" ? "O servidor vai tentar enviar novamente."
          : row.reason === "missing_recipient" ? "Confere o número de destino para poderes voltar a tentar."
            : "O aviso ficou por enviar. Confere a ligação do WhatsApp.",
      orderNumber: related?.order_number, updatedAt: row.updated_at, action: canRetry ? "retry_notice" : "orders"
    }];
  });
  const intakeTasks: SellerTask[] = (intake?.data ?? []).map((row) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    return {
      id: row.id, kind: "private_proof", title: "Comprovativo sem pedido identificado",
      detail: row.reason === "ambiguous_order" ? "Há mais de um pedido possível. Pede ao cliente o código AGX e o reenvio do ficheiro."
        : "Confere o pedido com o cliente e pede o reenvio do ficheiro com o código AGX.",
      contactId: role === "owner" ? row.contact_id : undefined,
      contactLabel: contact?.name?.trim() || contact?.phone || undefined, updatedAt: row.created_at, action: "close_intake"
    };
  });
  const handoffTasks: SellerTask[] = (handoffs?.data ?? []).map((row) => ({
    id: row.id, kind: "handoff", title: "Atendimento humano",
    detail: row.status === "retry" ? "A conversa está pausada. O servidor vai tentar avisar novamente."
      : "A conversa está pausada e o aviso ao responsável ficou por confirmar.",
    contactId: row.contact_id, updatedAt: row.updated_at, action: "conversation"
  }));
  return [...reviewTasks, ...deliveryTasks, ...noticeTasks, ...intakeTasks, ...handoffTasks]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
