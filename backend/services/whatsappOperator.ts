import { supabaseAdmin } from "../supabaseAdmin.ts";
import { executeToolByName } from "../tools/index.ts";

type LinkedIdentity = { id?: string; lid?: string } | null | undefined;
type OperatorTransport = {
  getMe(userId: string): LinkedIdentity;
  sendMessage(userId: string, jid: string, text: string): Promise<unknown>;
};

function privateIdentity(jid?: string) {
  const [who, domain, ...extra] = (jid ?? "").split("@");
  const number = who.split(":")[0];
  if (extra.length || !/^\d+$/.test(number) || !["s.whatsapp.net", "lid"].includes(domain)) return null;
  return `${number}@${domain}`;
}

export function isOperatorSelfChat(jid: string, fromMe: boolean, identity: LinkedIdentity) {
  const target = privateIdentity(jid);
  return fromMe && Boolean(target && [privateIdentity(identity?.id), privateIdentity(identity?.lid)].includes(target));
}

export const operatorCommands = [
  "/agentx mensagens", "/agentx leads", "/agentx agenda",
  "/agentx status Texto da publicação",
  "/agentx agendar-status amanhã às 09:00 | Texto",
  "/agentx agendar 258841234567 | amanhã às 09:00 | Mensagem"
];

export function parseOperatorCommand(text: string) {
  const match = /^\/agentx(?:\s+([^\s]+)(?:\s+([\s\S]+))?)?\s*$/i.exec(text.trim());
  if (!match) return null;
  return { command: match[1]?.toLowerCase() || "ajuda", argument: match[2]?.trim() || "" };
}

export async function handleOperatorCommand(
  transport: OperatorTransport, userId: string, jid: string, fromMe: boolean, text: string, messageId: string
) {
  const parsed = parseOperatorCommand(text);
  if (!parsed) return false;
  // Commands are reserved for the linked device's conversation with itself.
  if (!isOperatorSelfChat(jid, fromMe, transport.getMe(userId))) return false;

  const { data: claimed, error } = await supabaseAdmin.from("whatsapp_operator_commands")
    .upsert({ user_id: userId, message_id: messageId }, { onConflict: "user_id,message_id", ignoreDuplicates: true })
    .select("message_id").maybeSingle();
  if (error) throw error;
  if (!claimed) return true;

  let reply: string;
  try {
    reply = await operatorReply(transport, userId, jid, parsed.command, parsed.argument);
  } catch {
    reply = "Não foi possível concluir o comando. Consulte o painel antes de repetir um envio.";
  }
  await transport.sendMessage(userId, jid, `AgentX: ${reply}`);
  return true;
}

async function operatorReply(transport: OperatorTransport, userId: string, jid: string, command: string, argument: string) {
  if (command === "mensagens") {
    const { data, error } = await supabaseAdmin.from("messages").select("text,contacts!inner(name,phone,user_id)")
      .eq("user_id", userId).eq("contacts.user_id", userId).eq("type", "inbound").eq("is_read", false)
      .order("timestamp", { ascending: false }).limit(5);
    if (error) throw error;
    const lines = (data ?? []).map((row) => {
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

  if (command === "agenda") {
    const results = await Promise.all([
      supabaseAdmin.from("scheduled_messages").select("scheduled_at,contacts!inner(name,user_id)")
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
      ...(results[0].data ?? []).map((row) => ({ at: row.scheduled_at, name: (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts)?.name || "Mensagem" })),
      ...(results[1].data ?? []).map((row) => ({ at: row.scheduled_at, name: "WhatsApp Status" }))
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 5)
      .map(({ at, name }) => `• ${date.format(new Date(at))} · ${name}`);
    return lines.length ? ["Próximos envios", ...lines].join("\n") : "Sem envios pendentes.";
  }

  const [first, second, ...rest] = argument.split("|").map((part) => part.trim());
  const context = { userId, jid, phone: jid.split("@")[0], role: "admin" as const, whatsappManager: transport };
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
  return ["Comandos AgentX para esta conversa", ...operatorCommands.map((value) => `• ${value}`)].join("\n");
}

export async function alertOperator(transport: OperatorTransport, userId: string, contactId: string) {
  const identity = transport.getMe(userId);
  const recipient = privateIdentity(identity?.id) ?? privateIdentity(identity?.lid);
  if (!recipient) return;
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_contact_alert", { p_user: userId, p_contact: contactId });
  if (error) throw error;
  if (data === true) await transport.sendMessage(userId, recipient, "AgentX: recebeste uma mensagem de cliente. Abre a aba Mensagens para consultar a conversa.");
}
