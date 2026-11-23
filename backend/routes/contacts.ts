import { Router, type Response } from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import { getPlan } from "../lib/plan.ts";
import { saveContactIdentity } from "../services/contactIdentity.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { readContactPhone } from "../../shared/contactPhone.ts";

const router = Router();

function sendError(res: Response, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  console.error("[Contacts] Failed to save contact", { code, requestId: res.get("X-Request-Id") });
  if (code === "PGRST202" || code === "42883") return res.status(503).json({ error: "A gravação de contactos precisa da migração 19." });
  if (code === "22023") return res.status(400).json({ error: "Introduz um número de telefone válido." });
  if (code === "23505") return res.status(409).json({ error: "O número já está registado nesta conta." });
  return res.status(503).json({ error: "Não foi possível guardar os contactos." });
}

router.post("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para guardar o contacto." });
  const { phone: rawPhone, name: rawName, tags: rawTags, countryCode } = req.body ?? {};
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const phone = readContactPhone(rawPhone, typeof countryCode === "string" ? countryCode : undefined);
  if (name.length > 250) return res.status(400).json({ error: "O nome pode ter até 250 caracteres." });
  if (!phone) return res.status(400).json({ error: "Indica um número de telefone válido. Usa o indicativo internacional para números de fora de Moçambique." });

  const plan = await getPlan(userId);
  if (!plan) return res.status(503).json({ error: "Não foi possível verificar o plano desta conta." });
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim()).filter((tag) => tag && tag.length <= 64).slice(0, 25) : [];

  try {
    const saved = await saveContactIdentity(userId, { phone, name, tags: [...new Set([...tags, "Manual"])],
      replaceName: Boolean(name), maxContacts: plan.max_contacts });
    if (saved?.limited) return res.status(409).json({ error: "A conta atingiu o limite de contactos." });
    if (!saved?.id) return res.status(503).json({ error: "A base de dados não confirmou a gravação do contacto." });
    return res.status(saved.created ? 201 : 200).json({ success: true, data: saved });
  } catch (error) {
    return sendError(res, error);
  }
});

function parseContacts(csv: string) {
  const contacts = new Map<string, { phone: string; name: string }>();
  let invalid = 0;
  let duplicates = 0;
  const rows = csv.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length > 5001) return null;
  for (const [index, line] of rows.entries()) {
    const match = line.match(/^\s*(?:"((?:[^"]|"")*)"|([^,;]+))\s*([,;])\s*(?:"([^"]*)"|([^,;]*))(?:[,;].*)?$/);
    const name = (match?.[1]?.replace(/""/g, '"') ?? match?.[2] ?? "").trim();
    const rawPhone = (match?.[4] ?? match?.[5] ?? "").trim();
    if (index === 0 && /^(nome|name)$/i.test(name) && /^(telefone|phone|telemóvel|n[uú]mero)$/i.test(rawPhone)) continue;
    const phone = readContactPhone(rawPhone);
    if (!name || name.length > 250 || !phone) invalid++;
    else if (contacts.has(phone)) duplicates++;
    else contacts.set(phone, { name, phone });
  }
  if (contacts.size + invalid + duplicates > 5000) return null;
  return { contacts: [...contacts.values()], invalid, duplicates };
}

router.post("/import", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para importar contactos." });
  const { csv } = req.body ?? {};
  if (typeof csv !== "string" || csv.length > 1_000_000) return res.status(400).json({ error: "Escolhe um CSV de contactos até 1 MB." });
  const parsed = parseContacts(csv);
  if (!parsed) return res.status(400).json({ error: "O CSV pode conter até 5.000 contactos por importação." });
  const { contacts, invalid, duplicates } = parsed;
  if (!contacts.length) return res.status(400).json({ error: "O CSV não tem contactos com telefone válido. Usa as colunas Nome e Telefone." });
  const plan = await getPlan(userId);
  if (!plan) return res.status(503).json({ error: "Não foi possível verificar o plano desta conta." });
  try {
    const { data, error } = await supabaseAdmin.rpc("agentx_import_contacts", {
      p_user_id: userId, p_contacts: contacts, p_max_contacts: plan.max_contacts ?? null
    });
    if (error) throw error;
    if (!data) return res.status(503).json({ error: "A base de dados não confirmou a importação." });
    return res.json({ success: true, data: { ...data, invalid, duplicates } });
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
