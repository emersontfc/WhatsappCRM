import { Router } from "express";
import { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = Router();

export const CANONICAL_BUSINESS_TYPES = ["general", "clinic", "retail", "restaurant", "services"] as const;
export type CanonicalBusinessType = typeof CANONICAL_BUSINESS_TYPES[number];

export function normalizeBusinessType(raw: string): CanonicalBusinessType {
  if (!raw) return "general";
  const lower = raw.trim().toLowerCase();
  if (lower === "clinic" || lower === "clinica" || lower === "saude") return "clinic";
  if (lower === "retail" || lower === "vendas" || lower === "comercio" || lower === "ecommerce") return "retail";
  if (lower === "restaurant" || lower === "restaurante" || lower === "bar" || lower === "alimentacao") return "restaurant";
  if (lower === "services" || lower === "servicos" || lower === "estetica") return "services";
  return "general";
}

/**
 * GET /api/company/profile
 * Retrieves the canonical company profile for the authenticated tenant.
 * Atomically initializes default 'general' profile if none exists.
 */
router.get("/profile", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("company_profile")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[Company Profile] Error fetching profile:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    if (data) {
      return res.json({
        success: true,
        data: {
          id: data.id,
          userId: data.user_id,
          name: data.name || "Minha Empresa",
          type: normalizeBusinessType(data.type),
          description: data.description || "",
          timezone: data.timezone || "Africa/Maputo",
          settings: data.settings || {},
          updatedAt: data.updated_at
        }
      });
    }

    // Default initialization (general)
    const { data: created, error: createErr } = await supabaseAdmin
      .from("company_profile")
      .insert({
        user_id: userId,
        name: "Minha Empresa",
        type: "general",
        description: "",
        timezone: "Africa/Maputo",
        settings: {}
      })
      .select()
      .single();

    if (createErr) {
      console.error("[Company Profile] Error creating default profile:", createErr);
      return res.status(500).json({ success: false, error: createErr.message });
    }

    res.json({
      success: true,
      data: {
        id: created.id,
        userId: created.user_id,
        name: created.name,
        type: normalizeBusinessType(created.type),
        description: created.description,
        timezone: created.timezone,
        settings: created.settings,
        updatedAt: created.updated_at
      }
    });
  } catch (err: any) {
    console.error("[Company Profile] Unexpected error:", err);
    res.status(500).json({ success: false, error: err.message || "Erro ao obter perfil da empresa." });
  }
});

/**
 * PUT /api/company/profile
 * Updates canonical company profile (type, name, description, timezone, settings).
 */
router.put("/profile", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const { name, type, description, timezone, settings } = req.body;

  const canonicalType = normalizeBusinessType(type);
  if (timezone !== undefined && (typeof timezone !== "string" || !timezone.trim() || timezone.length > 100)) {
    return res.status(400).json({ success: false, error: "Fuso horário inválido." });
  }
  const suppliedZone = typeof timezone === "string" ? timezone.trim() : undefined;
  if (suppliedZone) {
    try {
      new Intl.DateTimeFormat("pt-MZ", { timeZone: suppliedZone }).format();
    } catch {
      return res.status(400).json({ success: false, error: "Fuso horário inválido." });
    }
  }

  try {
    const { data: existing } = await supabaseAdmin
      .from("company_profile")
      .select("id, type, timezone")
      .eq("user_id", userId)
      .maybeSingle();

    const tz = suppliedZone ?? existing?.timezone ?? "Africa/Maputo";
    let result;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("company_profile")
        .update({
          name: name !== undefined ? name : undefined,
          type: canonicalType,
          description: description !== undefined ? description : undefined,
          timezone: tz,
          settings: settings !== undefined ? settings : undefined,
          updated_at: new Date().toISOString()
        })
        .eq("user_id", userId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("company_profile")
        .insert({
          user_id: userId,
          name: name || "Minha Empresa",
          type: canonicalType,
          description: description || "",
          timezone: tz,
          settings: settings || {}
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Audit log
    try {
      await supabaseAdmin.from("logs").insert({
        user_id: userId,
        level: "info",
        source: "backend",
        category: "system",
        message: `Perfil de negócio atualizado para '${canonicalType}' (Fuso horário: ${tz})`,
        details: { previousType: existing?.type, newType: canonicalType, name: result.name }
      });
    } catch {}

    console.log(`[Company Profile] User ${userId} updated business profile to '${canonicalType}'`);

    res.json({
      success: true,
      message: "Perfil da empresa atualizado com sucesso.",
      data: {
        id: result.id,
        userId: result.user_id,
        name: result.name,
        type: normalizeBusinessType(result.type),
        description: result.description,
        timezone: result.timezone,
        settings: result.settings,
        updatedAt: result.updated_at
      }
    });
  } catch (err: any) {
    console.error("[Company Profile] Error updating profile:", err);
    res.status(500).json({ success: false, error: err.message || "Erro ao atualizar perfil da empresa." });
  }
});

export default router;

