import { supabaseAdmin } from "../supabaseAdmin.ts";

type NoticeTransport = {
  getSessionStatus(userId: string): string;
  sendMessage(userId: string, jid: string, text: string): Promise<{ key?: { id?: string | null } } | null | undefined>;
};

type Claim = {
  id: string;
  user_id: string;
  order_id: string;
  kind: "proof_review" | "rejection";
  recipient: string | null;
  order_number: string;
  rejected_reason: string | null;
  claim_token: string;
};

type Outcome =
  | { status: "sent"; receipt: string }
  | { status: "retry"; reason: "whatsapp_offline" }
  | { status: "failed"; reason: "missing_recipient" }
  | { status: "uncertain"; reason: "ack_timeout" | "no_receipt" | "transport_unknown" };

function message(claim: Claim) {
  if (claim.kind === "proof_review") {
    return `AgentX: o pedido ${claim.order_number} tem um comprovativo pendente. Abre Vendedor → Comprovativos e confirma o recebimento no prestador.`;
  }
  const reason = claim.rejected_reason?.trim();
  return `O comprovativo do pedido ${claim.order_number} foi rejeitado.${reason ? " Motivo: " + reason : ""} Envia um novo comprovativo ou fala com a equipa.`;
}

export async function dispatchSellerNotice(transport: NoticeTransport, claim: Claim, timeout = 45_000): Promise<Outcome> {
  if (transport.getSessionStatus(claim.user_id) !== "connected") return { status: "retry", reason: "whatsapp_offline" };
  if (!claim.recipient || !/^[1-9]\d{7,14}$/.test(claim.recipient)) return { status: "failed", reason: "missing_recipient" };

  let timer: NodeJS.Timeout | undefined;
  const deadline = Symbol("notice deadline");
  try {
    const result = await Promise.race([
      transport.sendMessage(claim.user_id, `${claim.recipient}@s.whatsapp.net`, message(claim)),
      new Promise<typeof deadline>((resolve) => {
        timer = setTimeout(() => resolve(deadline), timeout);
        timer.unref();
      }),
    ]);
    if (result === deadline) return { status: "uncertain", reason: "ack_timeout" };
    const receipt = result?.key?.id?.trim();
    if (receipt && receipt.length <= 200) return { status: "sent", receipt };
    return { status: "uncertain", reason: "no_receipt" };
  } catch (error) {
    if (error instanceof Error && error.message === "WhatsApp session not connected.") {
      return { status: "retry", reason: "whatsapp_offline" };
    }
    return { status: "uncertain", reason: "transport_unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export async function processSellerNotices(transport: NoticeTransport, now = new Date(), scope?: { userId: string; noticeId?: string }) {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_seller_notices", {
    p_now: now.toISOString(),
    ...(scope ? { p_user: scope.userId, p_notice: scope.noticeId ?? null } : {}),
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;

  await Promise.all(((data ?? []) as Claim[]).map(async (claim) => {
    const outcome = await dispatchSellerNotice(transport, claim);
    const { data: recorded, error: finishError } = await supabaseAdmin.rpc("agentx_finish_seller_notice", {
      p_user: claim.user_id, p_notice: claim.id, p_claim: claim.claim_token, p_outcome: outcome.status,
      p_reason: "reason" in outcome ? outcome.reason : null,
      p_receipt: "receipt" in outcome ? outcome.receipt : null,
      p_now: new Date().toISOString(),
    }).abortSignal(AbortSignal.timeout(8_000));
    if (finishError || recorded !== true) console.warn("[SellerNotices] Notice acknowledgement could not be recorded:", finishError?.code);
  }));
}

export async function retrySellerNotice(actorId: string, organizationId: string | null, noticeId: string) {
  const { data, error } = await supabaseAdmin.rpc("agentx_retry_seller_notice", {
    p_actor: actorId, p_org: organizationId, p_notice: noticeId,
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Notice retry was not acknowledged");
  return data;
}
