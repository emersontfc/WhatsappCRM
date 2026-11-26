import { randomBytes, randomUUID } from "node:crypto";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { scheduleUuid } from "./schedulePolicy.ts";

export const CATALOG_COVER_BUCKET = "agentx-catalog-covers";
export const CATALOG_COVER_LIMIT = 5 * 1024 * 1024;
export const CATALOG_CAPTION_LIMIT = 400;
export const campaignCode = () => `AXC-${randomBytes(16).toString("hex").toUpperCase()}`;

export type CampaignProduct = { id: string; name: string; price: number | string; currency?: string; stock: number; catalog_cover_path?: string | null };
type LinkedIdentity = { id?: string; phoneNumber?: string };

export function merchantCampaignPhone(identity?: LinkedIdentity) {
  return normalizeContactPhone(identity?.phoneNumber) ?? normalizeContactPhone(identity?.id);
}

function campaignTitle(name: string) {
  const cleaned = name.replace(/[\p{Cc}\p{Cf}*_|~`]+/gu, " ").replace(/\s+/g, " ").trim();
  let title = "";
  let encodedLength = 0;
  for (const character of cleaned) {
    encodedLength += encodeURIComponent(character).length;
    if (encodedLength > 260 || title.length + character.length > 120) break;
    title += character;
  }
  return title.trimEnd() || "Produto do catálogo";
}

export function campaignMessage(product: CampaignProduct, caption: string, phone: string, code?: string) {
  const title = campaignTitle(product.name);
  const currency = /^[A-Z]{2,6}$/.test(product.currency ?? "") ? product.currency : "MT";
  const price = Number(product.price).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const start = [caption, `*${title}*`, `Preço: ${price} ${currency}`, `Stock disponível: ${product.stock}`].filter(Boolean).join("\n");
  const link = code ? `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Tenho interesse em ${title}. ${code}`)}` : "Ligação privada para o WhatsApp da loja";
  return `${start}\n\nTenho interesse: ${link}`;
}

export function catalogCoverType(image: Buffer) {
  if (image.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return { filename: "produto.jpg", mimetype: "image/jpeg" };
  if (image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { filename: "produto.png", mimetype: "image/png" };
  if (image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP") return { filename: "produto.webp", mimetype: "image/webp" };
  return null;
}

export function ownedCatalogCover(userId: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/`) && scheduleUuid.test(path.slice(userId.length + 1));
}

export async function loadCatalogCover(userId: string, path: unknown) {
  if (!ownedCatalogCover(userId, path)) return null;
  const { data, error } = await supabaseAdmin.storage.from(CATALOG_COVER_BUCKET)
    .download(path, {}, { signal: AbortSignal.timeout(10_000) });
  if (error) throw error;
  if (!data || data.size > CATALOG_COVER_LIMIT) return null;
  const image = Buffer.from(await data.arrayBuffer());
  const type = catalogCoverType(image);
  return type ? { image, ...type } : null;
}

export async function storeCatalogCover(userId: string, productId: string, image: Buffer) {
  const type = catalogCoverType(image);
  if (!type || image.length > CATALOG_COVER_LIMIT) return false;
  const { data: product, error: readError } = await supabaseAdmin.from("products").select("id,catalog_cover_path")
    .eq("id", productId).eq("user_id", userId).abortSignal(AbortSignal.timeout(7_000)).maybeSingle();
  if (readError) throw readError;
  if (!product) return false;
  const path = `${userId}/${randomUUID()}`;
  const storage = supabaseAdmin.storage.from(CATALOG_COVER_BUCKET);
  const { error: uploadError } = await storage.upload(path, image, { contentType: type.mimetype, upsert: false });
  if (uploadError) throw uploadError;

  const write = supabaseAdmin.from("products").update({ catalog_cover_path: path }).eq("user_id", userId).eq("id", productId);
  if (product.catalog_cover_path) write.eq("catalog_cover_path", product.catalog_cover_path);
  else write.is("catalog_cover_path", null);
  const { data, error } = await write.select("id").abortSignal(AbortSignal.timeout(7_000)).maybeSingle();
  if (error) throw error;
  const orphan = !data ? path : product.catalog_cover_path;
  if (ownedCatalogCover(userId, orphan)) {
    void Promise.resolve(storage.remove([orphan])).catch(() => {});
  }
  return Boolean(data?.id);
}

export async function prepareCatalogCampaignDispatch(userId: string, campaignId: string, scheduleId: string, jid: string) {
  const signal = AbortSignal.timeout(8_000);
  const [campaign, job] = await Promise.all([
    supabaseAdmin.from("agentx_catalog_campaigns").select("id,product_id,group_jid,merchant_phone,code,caption,published_at")
      .eq("id", campaignId).eq("user_id", userId).abortSignal(signal).maybeSingle(),
    supabaseAdmin.from("scheduled_messages").select("id").eq("id", scheduleId).eq("user_id", userId)
      .eq("campaign_id", campaignId).eq("status", "processing").abortSignal(signal).maybeSingle()
  ]);
  if (campaign.error || job.error) throw campaign.error ?? job.error;
  const record = campaign.data;
  const currentPhone = merchantCampaignPhone(whatsappManager.getMe(userId));
  if (!record?.product_id || !job.data || record.group_jid !== jid || record.published_at || !currentPhone ||
    record.merchant_phone !== currentPhone) return null;

  const { data: product, error } = await supabaseAdmin.from("products").select("id,name,price,currency,stock,catalog_cover_path")
    .eq("id", record.product_id).eq("user_id", userId).eq("is_active", true).gt("price", 0).gt("stock", 0)
    .abortSignal(signal).maybeSingle();
  if (error) throw error;
  if (!product) return null;
  const cover = await loadCatalogCover(userId, product.catalog_cover_path);
  if (!cover) return null;
  const message = campaignMessage(product, record.caption, record.merchant_phone, record.code);
  return message.length <= 1024 ? { ...cover, message } : null;
}
