import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { formatInTimezone } from "../../utils/dateTimeParser.ts";

export const listScheduledStatusTool: ToolDefinition = {
  name: "list_scheduled_status",
  description: "Lista as postagens de Status do WhatsApp agendadas pelo usuário para publicação futura.",
  category: "automations",
  allowedRoles: ["admin"],
  riskLevel: "low",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filtro de status opcional: 'pending' (padrão), 'sent', 'failed' ou 'all'.",
        enum: ["pending", "sent", "failed", "all"]
      },
      limit: {
        type: "number",
        description: "Número máximo de postagens a listar (padrão 10)."
      }
    }
  },
  execute: async (args: { status?: string; limit?: number }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const filterStatus = args?.status || "pending";
      const maxLimit = Math.min(args?.limit || 10, 50);

      let query = supabaseAdmin
        .from("scheduled_status")
        .select("*")
        .eq("user_id", ctx.userId)
        .order("scheduled_at", { ascending: true })
        .limit(maxLimit);

      if (filterStatus !== "all") {
        query = query.eq("status", filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      const items = (data || []).map((row: any) => ({
        id: row.id,
        texto: row.caption,
        dataAgendada: row.scheduled_at,
        dataAgendadaFormatada: formatInTimezone(new Date(row.scheduled_at)),
        status: row.status,
        temMidia: !!row.media_url,
        mediaType: row.media_type
      }));

      return {
        success: true,
        code: "SUCCESS",
        message: items.length > 0
          ? `Encontrada(s) ${items.length} postagem(ns) de Status com status '${filterStatus}'.`
          : `Nenhuma postagem de Status com status '${filterStatus}' encontrada.`,
        data: {
          total: items.length,
          postagens: items
        }
      };
    } catch (err: any) {
      console.error("[listScheduledStatusTool] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Erro ao listar status agendados: ${err.message}`,
        error: err.message
      };
    }
  }
};

