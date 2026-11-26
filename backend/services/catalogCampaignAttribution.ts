import { supabaseAdmin } from "../supabaseAdmin.ts";

export function readCatalogCampaignCode(text: string) {
  const codes = new Set(text.match(/\bAXC-[A-F0-9]{32}\b/gi)?.map((code) => code.toUpperCase()));
  return codes.size === 1 ? [...codes][0] : null;
}

export async function captureCatalogCampaignInterest(userId: string, contactId: string, text: string, messageId: string): Promise<string | null> {
  const code = readCatalogCampaignCode(text);
  if (!code || !contactId || !messageId || messageId.length > 160) return null;
  const { data, error } = await supabaseAdmin.rpc("agentx_capture_catalog_campaign_interest", {
    p_user: userId, p_contact: contactId, p_code: code, p_source_message: messageId, p_message: text.slice(0, 500)
  }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  return typeof data === "string" ? data : null;
}
