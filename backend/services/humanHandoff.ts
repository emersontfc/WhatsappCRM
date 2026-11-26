import { normalizeContactPhone, readContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

type LinkedIdentity = { id?: string; phoneNumber?: string; lid?: string } | null | undefined;
type HandoffTransport = {
  getSessionStatus(userId: string): string;
  getMe(userId: string): LinkedIdentity;
  sendMessage(userId: string, jid: string, text: string): Promise<{ key?: { id?: string | null } } | null | undefined>;
};
type RecipientFields = {
  contact_phone: string | null;
  contact_lid: string | null;
  admin_phone: string | null;
  admin_phones: string | null;
};
type Claim = RecipientFields & { id: string; user_id: string; contact_id: string; claim_token: string };
type Outcome = "sent" | "retry" | "uncertain";

const notice = "AgentX: há uma conversa à espera de atendimento humano. Abre Mensagens → Humano para assumir o atendimento.";

function privateJid(value?: string | null) {
  const match = /^(\d{5,20})(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  if (match[2].toLowerCase() === "lid") return `${match[1]}@lid`;
  const phone = normalizeContactPhone(value);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

export function humanHandoffRecipient(fields: RecipientFields, linked: LinkedIdentity) {
  const contactLid = /^\d{5,20}$/.test(fields.contact_lid ?? "") ? `${fields.contact_lid}@lid` : privateJid(fields.contact_lid);
  const contactPhone = normalizeContactPhone(fields.contact_phone);
  const customer = new Set([contactLid, contactPhone ? `${contactPhone}@s.whatsapp.net` : null]);
  const linkedPhone = normalizeContactPhone(linked?.phoneNumber);
  const own = [linkedPhone ? `${linkedPhone}@s.whatsapp.net` : null, privateJid(linked?.id), privateJid(linked?.lid)];

  const candidates = [fields.admin_phone, ...(fields.admin_phones ?? "").split(/[\n,;]+/)];
  for (const value of candidates) {
    if (!value || value.includes("@")) continue;
    const phone = readContactPhone(value);
    if (!phone) continue;
    const jid = `${phone}@s.whatsapp.net`;
    if (!customer.has(jid) && !customer.has(`${phone}@lid`) && !own.includes(jid) && !own.includes(`${phone}@lid`)) return jid;
  }

  // If a known customer identity is the linked account, do not fall back to one of its other address forms.
  if (own.some((identity) => identity && customer.has(identity))) return null;
  return own.find((identity): identity is string => Boolean(identity)) ?? null;
}

export async function requestHumanHandoff(userId: string, contactId: string, sourceMessageId?: string,
  cause: "requested" | "agent_unavailable" = "requested"): Promise<"queued" | "already" | "missing"> {
  const { data, error } = await supabaseAdmin.rpc("agentx_request_human_handoff", {
    p_user: userId, p_contact: contactId, p_source_message_id: sourceMessageId?.trim() || null, p_cause: cause,
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  if (data !== "queued" && data !== "already" && data !== "missing") throw new Error("Human handoff was not acknowledged");
  return data;
}

async function sendHandoff(transport: HandoffTransport, claim: Claim): Promise<{ outcome: Outcome; receipt?: string }> {
  const userId = claim.user_id;
  let recipient: string | null;
  try {
    if (transport.getSessionStatus(userId) !== "connected") return { outcome: "retry" };
    recipient = humanHandoffRecipient(claim, transport.getMe(userId));
    if (!recipient) return { outcome: "retry" };
  } catch {
    return { outcome: "retry" }; // The transport has not received a send request.
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      transport.sendMessage(userId, recipient, notice),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Handoff acknowledgement timed out")), 45_000);
        timer.unref();
      }),
    ]);
    const receipt = result?.key?.id?.trim();
    if (receipt && receipt.length <= 200) return { outcome: "sent", receipt };
  } catch (error) {
    if (error instanceof Error && ["WhatsApp session not connected.", "WhatsApp não conectado"].includes(error.message)) {
      return { outcome: "retry" };
    }
  } finally {
    clearTimeout(timer);
  }
  return { outcome: "uncertain" };
}

export async function processHumanHandoffs(transport: HandoffTransport, now = new Date(), scope?: { userId: string; contactId: string }) {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_human_handoffs", {
    p_now: now.toISOString(), ...(scope ? { p_user: scope.userId, p_contact: scope.contactId } : {}),
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  await Promise.all(((data ?? []) as Claim[]).map(async (claim) => {
    const result = await sendHandoff(transport, claim);
    const { data: recorded, error: finishError } = await supabaseAdmin.rpc("agentx_finish_human_handoff", {
      p_user: claim.user_id, p_handoff: claim.id, p_claim: claim.claim_token,
      p_outcome: result.outcome, p_receipt: result.receipt ?? null, p_now: new Date().toISOString(),
    }).abortSignal(AbortSignal.timeout(8_000));
    if (finishError || !recorded) console.warn("[Handoff] The send result could not be recorded", { code: finishError?.code });
  }));
}
