import { isQuotableChatText } from "../../shared/chatQuote.ts";
import type { StoredWhatsAppQuote } from "../lib/whatsappTransport.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

export async function loadWhatsAppQuote(userId: string, contactId: string, jid: string, messageId: string,
  signal = AbortSignal.timeout(8_000)): Promise<StoredWhatsAppQuote | null> {
  if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid)) return null;

  const { data: original, error } = await supabaseAdmin.from("messages")
    .select("id,msg_id,text,type,media_url,media_type")
    .eq("id", messageId).eq("user_id", userId).eq("contact_id", contactId).abortSignal(signal).maybeSingle();
  if (error) throw error;
  if (!original || !isQuotableChatText(original)) return null;

  return {
    messageId: original.id,
    message: {
      key: { id: original.msg_id, remoteJid: jid, fromMe: original.type === "outbound" },
      message: { conversation: original.text }
    }
  };
}
