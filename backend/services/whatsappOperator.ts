import { readContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { executeToolByName } from "../tools/index.ts";
import { saveContactIdentity } from "./contactIdentity.ts";

type LinkedIdentity = { id?: string; lid?: string; phoneNumber?: string } | null | undefined;
type SenderEvidence = {
  remoteJidAlt?: string | null;
  resolveLid?: (jid: string) => Promise<string | null | undefined>;
};
type OperatorTransport = {
  getMe(userId: string): LinkedIdentity;
  sendMessage(userId: string, jid: string, text: string): Promise<unknown>;
};

function privateIdentity(jid?: string | null) {
  const match = /^(\d{1,20})(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/.exec(jid ?? "");
  if (!match) return null;
  return `${match[1]}@${match[2] === "c.us" ? "s.whatsapp.net" : match[2]}`;
}

function phoneFromOperatorJid(jid?: string | null) {
  return /^([1-9]\d{7,14})@s\.whatsapp\.net$/.exec(privateIdentity(jid) ?? "")?.[1] ?? null;
}

export function isOperatorSelfChat(jid: string, fromMe: boolean, identity: LinkedIdentity) {
  const target = privateIdentity(jid);
  return fromMe && Boolean(target && [privateIdentity(identity?.id), privateIdentity(identity?.lid)].includes(target));
}

export const operatorCommands = [
  "/agentx mensagens", "/agentx leads", "/agentx agenda",
  "/agentx pedidos", "/agentx comprovativos",
  "/agentx pausar 258851234567 | Motivo opcional",
  "/agentx retomar 258851234567",
  "/agentx status Texto da publicação",
  "/agentx agendar-status amanhã às 09:00 | Texto",
  "/agentx agendar 258841234567 | amanhã às 09:00 | Mensagem"
];

export function parseOperatorCommand(text: string) {
  const match = /^\/agentx(?:\s+([^\s]+)(?:\s+([\s\S]+))?)?\s*$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1]?.toLowerCase() || "ajuda", argument: match[2]?.trim() || "" };
}

async function authorizedOperator(transport: OperatorTransport, userId: string, jid: string, fromMe: boolean, evidence: SenderEvidence) {
  const sender = privateIdentity(jid);
  if (!sender) return null;
  if (fromMe === true) {
    const identity = transport.getMe(userId);
    if (!isOperatorSelfChat(jid, true, identity)) return null;
    return { phone: phoneFromOperatorJid(identity?.id) ?? phoneFromOperatorJid(sender) ?? readContactPhone(identity?.phoneNumber) ?? "" };
  }
  if (fromMe !== false) return null;

  // Only Baileys' direct sender address and its server-provided PN alternate
  // (or the linked account's own Signal LID mapping) establish the identity.
  let phone = phoneFromOperatorJid(sender);
  if (sender.endsWith("@lid")) {
    phone = phoneFromOperatorJid(evidence.remoteJidAlt) ?? phoneFromOperatorJid(await evidence.resolveLid?.(sender));
  }
  if (!phone) return null;

  const { data, error } = await supabaseAdmin.from("users").select("phone,admin_phones")
    .eq("id", userId).abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
  if (error) throw error;
  const configured = [data?.phone, ...(data?.admin_phones ?? "").split(/[\n,;]+/)];
  return configured.some((value) => !value?.includes("@") && readContactPhone(value) === phone) ? { phone } : null;
}

export async function handleOperatorCommand(
  transport: OperatorTransport, userId: string, jid: string, fromMe: boolean, text: string, messageId: string,
  evidence: SenderEvidence = {}
) {
  const parsed = parseOperatorCommand(text);
  if (!parsed || !messageId || messageId.length > 200) return false;
  const operator = await authorizedOperator(transport, userId, jid, fromMe, evidence);
  if (!operator) return false;

  const { data: claimed, error } = await supabaseAdmin.from("whatsapp_operator_commands")
    .upsert({ user_id: userId, message_id: messageId }, { onConflict: "user_id,message_id", ignoreDuplicates: true })
    .select("message_id").abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
  if (error) throw error;
  if (!claimed) return true;

  let reply: string;
  try {
    reply = await operatorReply(transport, userId, jid, operator.phone, parsed.command, parsed.argument, messageId);
  } catch {
    reply = parsed.command === "pausar" || parsed.command === "retomar"
      ? "Não foi possível concluir o comando. Confirma o estado da IA na aba Mensagens."
      : "Não foi possível concluir o comando. Consulte o painel antes de repetir um envio.";
  }
  await transport.sendMessage(userId, jid, `AgentX: ${reply}`);
  return true;
}

const orderStatuses: Record<string, string> = {
  created: "Novo", awaiting_payment: "Aguarda pagamento", verification_pending: "Aguarda revisão do comprovativo",
  paid: "Pago, entrega pendente", fulfilled: "Entregue", rejected: "Pagamento rejeitado",
  cancelled: "Cancelado", refunded: "Reembolsado", expired: "Expirado", failed: "Falhou"
};

const money = new Intl.NumberFormat("pt-MZ", { maximumFractionDigits: 2 });
const reviewInPanel = "Abre Vendedor → Comprovativos para verificar o recebimento no prestador e decidir.";

function orderLine(order: { order_number: string; total_amount: number | string | null; currency: string | null }) {
  const amount = Number(order.total_amount);
  const currency = /^[A-Z]{2,3}$/.test(order.currency ?? "") ? order.currency : "MT";
  return order.total_amount != null && Number.isFinite(amount)
    ? `${order.order_number} · ${money.format(amount)} ${currency}` : order.order_number;
}

async function changeConversationAI(userId: string, argument: string, paused: boolean, messageId: string) {
  const [rawPhone, rawReason, ...extra] = argument.split("|").map(part => part.trim());
  const phone = rawPhone.length <= 40 && !rawPhone.includes("@") ? readContactPhone(rawPhone) : null;
  if (!phone || extra.length || (!paused && rawReason !== undefined)) {
    return paused ? "Usa /agentx pausar 258851234567 | Motivo opcional. Indica o número do cliente."
      : "Usa /agentx retomar 258851234567. Indica o número do cliente.";
  }
  const reason = rawReason?.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();
  if (reason && reason.length > 200) return "O motivo da pausa pode ter até 200 caracteres.";

  const contact = await saveContactIdentity(userId, { phone, existingOnly: true });
  const missing = "Contacto não encontrado na tua conta. Confirma o número na aba Mensagens.";
  if (!contact?.id || contact.created || contact.phone !== phone) return missing;
  const { data, error } = await supabaseAdmin.rpc("agentx_set_whatsapp_operator_handoff", {
    p_user: userId, p_contact: contact.id, p_phone: phone, p_paused: paused,
    p_message_id: messageId, p_reason: reason || null
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  if (data === "missing") return missing;
  if (data === "already") return `A IA já estava ${paused ? "pausada" : "ativa"} para +${phone}.`;
  if (data !== "changed") throw new Error("Alteração da IA indisponível.");
  return paused ? `IA pausada para +${phone}. Podes atender esta conversa manualmente.`
    : `IA retomada para +${phone}. As respostas automáticas voltaram a estar disponíveis nesta conversa.`;
}

async function operatorReply(transport: OperatorTransport, userId: string, jid: string, phone: string, command: string, argument: string, messageId: string) {
  if (command === "mensagens") {
    const { data, error } = await supabaseAdmin.from("messages").select("msg_id,text,contacts!inner(name,phone,user_id)")
      .eq("user_id", userId).eq("contacts.user_id", userId).eq("type", "inbound").eq("is_read", false)
      .order("timestamp", { ascending: false }).limit(6).abortSignal(AbortSignal.timeout(5_000));
    if (error) throw error;
    const lines = (data ?? []).filter((row) => row.msg_id !== messageId).slice(0, 5).map((row) => {
      const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
      return `• ${contact?.name || contact?.phone || "Contacto"}: ${String(row.text || "Multimédia").slice(0, 140)}`;
    });
    return lines.length ? ["Últimas mensagens por ler", ...lines].join("\n") : "Sem mensagens por ler.";
  }

  if (command === "leads") {
    const { data, error } = await supabaseAdmin.from("leads").select("name,phone,stage")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(5);
    if (error) throw error;
    const lines = (data ?? []).map((row) => `• ${row.name || row.phone || "Lead"} · ${row.stage || "Sem etapa"}`);
    return lines.length ? ["Leads recentes", ...lines].join("\n") : "Sem leads cadastrados.";
  }

  if (command === "pedidos" && !argument) {
    const { data, error } = await supabaseAdmin.from("orders")
      .select("order_number,status,total_amount,currency").eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5)
      .abortSignal(AbortSignal.timeout(5_000));
    if (error) throw error;
    const lines = (data ?? []).map(row => {
      const status = Object.hasOwn(orderStatuses, row.status) ? orderStatuses[row.status] : "Estado indisponível";
      return `• ${orderLine(row)} · ${status}`;
    });
    return lines.length ? ["Pedidos recentes", ...lines].join("\n") : "Sem pedidos registados.";
  }

  if (command === "comprovativos" && !argument) {
    const { data, error } = await supabaseAdmin.from("payment_verifications")
      .select("orders!inner(order_number,total_amount,currency,user_id)")
      .eq("user_id", userId).eq("orders.user_id", userId).eq("status", "pending")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5)
      .abortSignal(AbortSignal.timeout(5_000));
    if (error) throw error;
    const lines = (data ?? []).flatMap(row => {
      const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
      return order?.user_id === userId ? [`• Pedido ${orderLine(order)}`] : [];
    });
    return lines.length ? ["Comprovativos pendentes de revisão", ...lines, reviewInPanel].join("\n") : "Sem comprovativos pendentes.";
  }

  if (command === "pausar" || command === "retomar") {
    return changeConversationAI(userId, argument, command === "pausar", messageId);
  }

  if (command === "agenda") {
    const results = await Promise.all([
      supabaseAdmin.from("scheduled_messages").select("scheduled_at,target_type,group_name,contacts(name,user_id)")
        .eq("user_id", userId).eq("contacts.user_id", userId).eq("status", "pending").order("scheduled_at").limit(5),
      supabaseAdmin.from("scheduled_status").select("scheduled_at")
        .eq("user_id", userId).eq("status", "pending").order("scheduled_at").limit(5),
      supabaseAdmin.from("company_profile").select("timezone").eq("user_id", userId).maybeSingle()
    ]);
    if (results[0].error || results[1].error) throw new Error("Agenda indisponível");
    let date: Intl.DateTimeFormat;
    try {
      date = new Intl.DateTimeFormat("pt-MZ", { dateStyle: "short", timeStyle: "short", timeZone: results[2].data?.timezone || "Africa/Maputo" });
    } catch {
      date = new Intl.DateTimeFormat("pt-MZ", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Maputo" });
    }
    const lines = [
      ...(results[0].data ?? []).map((row) => ({ at: row.scheduled_at, name: row.target_type === "group" ? row.group_name || "Anúncio de grupo" : (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts)?.name || "Mensagem" })),
      ...(results[1].data ?? []).map((row) => ({ at: row.scheduled_at, name: "WhatsApp Status" }))
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 5)
      .map(({ at, name }) => `• ${date.format(new Date(at))} · ${name}`);
    return lines.length ? ["Próximos envios", ...lines].join("\n") : "Sem envios pendentes.";
  }

  const [first, second, ...rest] = argument.split("|").map((part) => part.trim());
  const context = { userId, jid, phone, role: "admin" as const, whatsappManager: transport };
  if (command === "status" && argument && argument.length <= 700) {
    return (await executeToolByName("post_whatsapp_status", { text: argument }, context)).message;
  }
  if (command === "agendar" && first && second && rest.join("|") && argument.length <= 2000) {
    return (await executeToolByName("schedule_message", { recipient: first, scheduledAt: second, message: rest.join("|") }, context)).message;
  }
  if (command === "agendar-status" && first && second && argument.length <= 800) {
    return (await executeToolByName("schedule_status", { scheduledAt: first, text: [second, ...rest].join("|") }, context)).message;
  }
  // Avoid echoing a valid command as the first token of a WhatsApp reply.
  return ["Comandos AgentX para esta conversa", ...operatorCommands.map((value) => `• ${value}`),
    "Para pausar ou retomar a IA, indica o número do cliente no comando."].join("\n");
}

export async function alertOperator(transport: OperatorTransport, userId: string, contactId: string) {
  const identity = transport.getMe(userId);
  const recipient = privateIdentity(identity?.id) ?? privateIdentity(identity?.lid);
  if (!recipient) return;
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_contact_alert", { p_user: userId, p_contact: contactId });
  if (error) throw error;
  if (data === true) await transport.sendMessage(userId, recipient, "AgentX: recebeste uma mensagem de cliente. Abre a aba Mensagens para consultar a conversa.");
}
