import { supabaseAdmin } from "../supabaseAdmin.ts";

export async function claimWhatsAppAction(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_whatsapp_action", {
    p_user_id: userId,
    p_message_id: messageId
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  return data === true;
}
