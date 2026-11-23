import { Router } from "express";
import { normalizeContactPhone, readContactPhone } from "../../shared/contactPhone.ts";
import type { AuthRequest } from "../middleware/auth.ts";
import { manualLeadStage, saveManualSalesLead } from "../services/manualSalesLead.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = Router();

router.post("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para guardar a oportunidade." });
  const { phone: suppliedPhone, contactId, name, stage, value, notes, source } = req.body ?? {};
  const validatedStage = manualLeadStage(stage);
  if (stage !== undefined && !validatedStage) {
    return res.status(400).json({ error: "Escolhe uma etapa válida para a oportunidade." });
  }
  if (name !== undefined && name !== null && (typeof name !== "string" || name.trim().length > 150)) {
    return res.status(400).json({ error: "O nome pode ter até 150 caracteres." });
  }
  if (notes !== undefined && notes !== null && (typeof notes !== "string" || notes.trim().length > 3000)) {
    return res.status(400).json({ error: "As notas podem ter até 3.000 caracteres." });
  }
  const amount = typeof value === "number" || typeof value === "string" ? String(value).trim().replace(",", ".") : "";
  if (value !== undefined && value !== null && !/^\d{1,10}(?:\.\d{1,2})?$/.test(amount)) {
    return res.status(400).json({ error: "Indica um valor positivo ou zero com até duas casas decimais." });
  }
  if (contactId !== undefined && (typeof contactId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(contactId))) {
    return res.status(400).json({ error: "Escolhe um contacto válido." });
  }
  let phone = readContactPhone(suppliedPhone);
  if (suppliedPhone !== undefined && !phone) {
    return res.status(400).json({ error: "Indica um número de telefone válido." });
  }

  try {
    if (contactId) {
      const { data: contact, error } = await supabaseAdmin.from("contacts")
        .select("phone,lid").eq("id", contactId).eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (!contact) return res.status(404).json({ error: "Contacto não encontrado." });
      const contactPhone = normalizeContactPhone(contact.phone);
      if (!contactPhone || contactPhone === normalizeContactPhone(contact.lid?.split(/[:@]/)[0])) {
        return res.status(400).json({ error: "Este contacto ainda não tem um número de telefone associado." });
      }
      if (phone && phone !== contactPhone) {
        return res.status(400).json({ error: "O número indicado não corresponde ao contacto." });
      }
      phone = contactPhone;
    }
    if (!phone) return res.status(400).json({ error: "Indica um número de telefone válido." });

    const data = await saveManualSalesLead(userId, {
      phone, contactId, stage: validatedStage, name: typeof name === "string" ? name.trim() : undefined,
      source: source === "whatsapp" && contactId ? "whatsapp" : source === "manual" ? "manual" : undefined,
      value: value === null || value === undefined ? value : Number(amount),
      notes: typeof notes === "string" ? notes.trim() || null : notes
    });
    return res.json({ success: true, data });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    console.warn("[Leads] Manual save failed", { code, requestId: res.get("X-Request-Id") });
    if (code === "42501" || code === "P0002") return res.status(404).json({ error: "Contacto não encontrado." });
    if (code === "22023") return res.status(400).json({ error: "Verifica o contacto e os dados da oportunidade." });
    return res.status(503).json({ error: "Não foi possível guardar a oportunidade. Tenta novamente." });
  }
});

export default router;
