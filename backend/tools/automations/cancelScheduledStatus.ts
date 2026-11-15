import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const cancelScheduledStatusTool: ToolDefinition = {
  name: "cancel_scheduled_status",
  description: "Cancela um agendamento de Status do WhatsApp pendente pelo ID ou cancela o próximo status agendado.",
  category: "automations",
  allowedRoles: ["admin"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      statusId: {
        type: "string",
        description: "ID UUID da postagem de status agendada a cancelar (opcional se houver apenas um agendado)."
      }
    }
  },
  execute: async (args: { statusId?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let targetId = args?.statusId;

      if (!targetId) {
        const { data: pending } = await supabaseAdmin
          .from("scheduled_status")
          .select("id, caption, scheduled_at")
          .eq("user_id", ctx.userId)
          .eq("status", "pending")
          .order("scheduled_at", { ascending: true })
          .limit(2);

        if (pending && pending.length === 1) {
          targetId = pending[0].id;
        } else if (!pending || pending.length === 0) {
          return {
            success: false,
            code: "RESOURCE_NOT_FOUND",
            message: "Nenhuma postagem de Status pendente encontrada para cancelar."
          };
        } else {
          return {
            success: false,
            code: "RESOURCE_NOT_FOUND",
            message: `Existem ${pending.length} status agendados. Por favor especifique o ID do status que deseja cancelar.`
          };
        }
      }

      const { data: cancelled, error } = await supabaseAdmin
        .from("scheduled_status")
        .update({ status: "cancelled" })
        .eq("id", targetId)
        .eq("user_id", ctx.userId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!cancelled) {
        return {
          success: false,
          code: "RESOURCE_NOT_FOUND",
          message: `Agendamento de Status '${targetId}' não encontrado ou já processado.`
        };
      }

      return {
        success: true,
        code: "SUCCESS",
        message: `Postagem de Status cancelada com sucesso. Não será publicada no WhatsApp.`,
        data: {
          id: cancelled.id,
          texto: cancelled.caption,
          dataPrevista: cancelled.scheduled_at,
          status: "cancelled"
        }
      };
    } catch (err: any) {
      console.error("[cancelScheduledStatusTool] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Erro ao cancelar status agendado: ${err.message}`,
        error: err.message
      };
    }
  }
};

