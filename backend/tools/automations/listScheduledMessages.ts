import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { formatInTimezone } from "../../utils/dateTimeParser.ts";

export const listScheduledMessagesTool: ToolDefinition = {
  name: "list_scheduled_messages",
  description: "Lista as mensagens e faturas agendadas pelo usuário para envio futuro, com status, destinatário e data de envio.",
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
        description: "Número máximo de agendamentos a retornar (padrão 10)."
      }
    }
  },
  execute: async (args: { status?: string; limit?: number }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const filterStatus = args?.status || "pending";
      const maxLimit = Math.min(args?.limit || 10, 50);

      let query = supabaseAdmin
        .from("scheduled_messages")
        .select(`
          id,
          message,
          scheduled_at,
          status,
          media_type,
          media_url,
          contacts (id, name, phone)
        `)
        .eq("user_id", ctx.userId)
        .order("scheduled_at", { ascending: true })
        .limit(maxLimit);

      if (filterStatus !== "all") {
        query = query.eq("status", filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      const items = (data || []).map((row: any) => {
        const c = row.contacts;
        return {
          id: row.id,
          destinatario: c ? `${c.name || 'Sem nome'} (${c.phone})` : "Desconhecido",
          mensagem: row.message,
          dataEnvio: row.scheduled_at,
          dataEnvioFormatada: formatInTimezone(new Date(row.scheduled_at)),
          status: row.status,
          temAnexo: !!row.media_url
        };
      });

      return {
        success: true,
        code: "SUCCESS",
        message: items.length > 0
          ? `Encontrados ${items.length} agendamento(s) com status '${filterStatus}'.`
          : `Nenhum agendamento com status '${filterStatus}' encontrado.`,
        data: {
          total: items.length,
          agendamentos: items
        }
      };
    } catch (err: any) {
      console.error("[listScheduledMessagesTool] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Erro ao listar mensagens agendadas: ${err.message}`,
        error: err.message
      };
    }
  }
};

