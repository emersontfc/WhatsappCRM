import { supabaseAdmin } from "../../supabaseAdmin.ts";
import type { ToolDefinition } from "../types.ts";

export const getBookingLinkTool: ToolDefinition = {
  name: "get_booking_link",
  description: "Obtém o link de marcações e os serviços ativos da empresa para responder a pedidos de horário.",
  category: "scheduling",
  allowedRoles: ["admin", "lead"],
  riskLevel: "low",
  parameters: { type: "object", properties: {} },
  execute: async (_args, ctx) => {
    let link: string;
    try {
      const app = new URL(process.env.PUBLIC_APP_URL || process.env.VITE_API_URL || "");
      if (!["https:", "http:"].includes(app.protocol) || app.username || app.password) throw new Error("Invalid public URL");
      link = new URL(`/book/${encodeURIComponent(ctx.userId)}`, app.origin).href;
    } catch {
      return { success: false, message: "O link de marcações está indisponível. Pede à equipa para confirmar o horário." };
    }
    try {
      const { data, error } = await supabaseAdmin.from("services").select("name,duration_minutes")
        .eq("user_id", ctx.userId).eq("active", true).order("name").limit(12);
      if (error) throw error;
      if (!data.length) return { success: false, message: "A equipa ainda não disponibilizou serviços para marcação online." };
      return {
        success: true,
        message: ["Para escolher um serviço e ver os horários disponíveis, abre este link:", link,
          "", "Serviços:", ...data.map(({ name, duration_minutes }) => `• ${name} · ${duration_minutes} min`)].join("\n")
      };
    } catch {
      return { success: false, message: "Não consegui consultar os serviços agora. A equipa pode ajudar com a tua marcação." };
    }
  }
};
