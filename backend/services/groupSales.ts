import type { GroupMetadata, WAMessageKey } from "@whiskeysockets/baileys";
import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { presentCatalogSuggestions, type CatalogDiscoveryItem } from "./catalogDiscovery.ts";
import { canPostInGroup, groupParticipant, isGroupJid } from "./groupModeration.ts";
import { claimWhatsAppAction } from "./whatsappActionClaims.ts";

type LinkedIdentity = { id?: string; lid?: string; phoneNumber?: string };

type GroupSalesInput = {
  userId: string;
  jid: string;
  key: WAMessageKey;
  text: string;
  timestamp: string;
  linked?: LinkedIdentity;
  loadGroup: () => Promise<GroupMetadata>;
  send: (reply: string) => Promise<{ key?: { id?: string | null } } | undefined>;
};

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-MZ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function parseGroupSalesCommand(text: string): { query: string } | null {
  const match = /^\/loja(?: +([^\p{Cc}\p{Cf}]+))?$/iu.exec(text.trim());
  const query = match?.[1]?.trim() ?? "";
  if (!match || query.length > 120 || (query && !fold(query))) return null;
  return { query };
}

export function groupSalesPhone(group: GroupMetadata, jid: string, key: WAMessageKey, linked?: LinkedIdentity) {
  if (group.id !== jid || !key.participant || !canPostInGroup(group, linked)) return null;
  const member = groupParticipant(group, key.participant);
  const alternate = groupParticipant(group, key.participantAlt);
  const self = groupParticipant(group, linked?.id, linked?.lid, linked?.phoneNumber);
  const buyer = member ?? alternate;
  if (!buyer || buyer === self || (member && alternate && member !== alternate)) return null;
  const phones = new Set([linked?.phoneNumber, linked?.id, self?.phoneNumber, self?.id].map(normalizeContactPhone).filter(Boolean));
  return phones.size === 1 ? [...phones][0] : null;
}

function publicProductName(raw: string) {
  const name = raw.replace(/[\p{Cc}\p{Cf}*_|~`]+/gu, " ").replace(/\s+/g, " ").trim();
  return Array.from(name).slice(0, 120).join("");
}

export function groupSalesReply(query: string, catalog: readonly CatalogDiscoveryItem[], phone: string) {
  const search = fold(query);
  const products = catalog.flatMap((item) => {
    const name = publicProductName(item.name ?? "");
    const price = Number(item.price);
    const stock = Number(item.stock);
    if (!name || item.is_active === false || !Number.isFinite(price) || price <= 0 ||
      !Number.isInteger(stock) || stock <= 0) return [];
    return [{ id: item.id, name, searchName: fold(name), category: fold(item.category ?? ""), price, stock,
      currency: /^[A-Z]{2,6}$/.test(item.currency ?? "") ? item.currency : "MT" }];
  });
  const exact = search ? products.filter((item) => item.searchName === search) : [];
  const matched = exact.length ? exact : products.filter((item) => item.searchName.includes(search) || item.category.includes(search));
  const one = search && matched.length === 1 ? matched[0] : null;
  const message = one ? `Olá! Qual é o preço de ${one.name}?` : "Olá! Quero ver o catálogo da loja.";
  const link = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  const catalogText = matched.length ? presentCatalogSuggestions(matched, { heading: "Catálogo da loja", ask: "" })
    : search ? "Não encontrei um produto disponível com esse nome. Podes consultar a lista com /loja."
      : "A loja não tem produtos disponíveis neste momento.";
  return `${catalogText}\n\nPara saber mais ou encomendar, abre a conversa privada da loja:\n${link}`;
}

export async function processGroupSales(input: GroupSalesInput): Promise<boolean> {
  const { userId, jid, key, text, timestamp, linked, loadGroup, send } = input;
  const command = parseGroupSalesCommand(text);
  const age = Date.now() - Date.parse(timestamp);
  if (!command || key.fromMe !== false || !key.participant || !key.id || key.id.length > 200 || key.remoteJid !== jid ||
      !isGroupJid(jid) || !Number.isFinite(age) || age < -30_000 || age >= 2 * 60_000) return false;

  const { data: rule, error: ruleError } = await supabaseAdmin.from("group_rules").select("catalog_sales_enabled")
    .eq("user_id", userId).eq("group_jid", jid).abortSignal(AbortSignal.timeout(4_000)).maybeSingle();
  if (ruleError) throw ruleError;
  if (rule?.catalog_sales_enabled !== true) return false;

  const phone = groupSalesPhone(await loadGroup(), jid, key, linked);
  if (!phone) return false;

  const { data: products, error: productsError } = await supabaseAdmin.from("products")
    .select("id,name,category,price,currency,stock").eq("user_id", userId).eq("is_active", true)
    .gt("price", 0).gt("stock", 0).order("name").order("id").abortSignal(AbortSignal.timeout(4_000));
  if (productsError) throw productsError;
  if (!await claimWhatsAppAction(userId, key.id)) return false;

  // An interrupted send may have been accepted remotely. Never resend a claimed event.
  const sent = await send(groupSalesReply(command.query, products ?? [], phone));
  return Boolean(sent?.key?.id);
}
