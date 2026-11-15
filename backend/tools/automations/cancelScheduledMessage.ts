import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const cancelScheduledMessageTool: ToolDefinition = {
  name: "cancel_scheduled_message",
  description: "Cancela um agendamento de mensagem pendente pelo ID do agendamento ou pelo nome/telefone do destinatário.",
  category: "automations",
  allowedRoles: ["admin"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      scheduleId: {
        type: "string",
        description: "ID UUID do agendamento a cancelar (se conhecido)."
      },
      recipient: {
        type: "string",
        description: "Nome ou telefone do destinatário para localizar e cancelar o agendamento mais recente pendente."
      }
    }
  },
  execute: async (args: { scheduleId?: string; recipient?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let targetId = args?.scheduleId;

      if (!targetId && args?.recipient) {
        // Resolve contact
        const rec = args.recipient.trim();
        const cleanPhone = rec.replace(/\D/g, "");
        
        let contactIds: string[] = [];
        if (cleanPhone.length >= 8) {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("user_id", ctx.userId)
            .ilike("phone", `%${cleanPhone}%`);
          if (data) contactIds = data.map(d => d.id);
        } else {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("user_id", ctx.userId)
            .ilike("name", `%${rec}%`);
          if (data) contactIds = data.map(d => d.id);
        }

        if (contactIds.length > 0) {
          const { data: msg } = await supabaseAdmin
            .from("scheduled_messages")
            .select("id")
            .eq("user_id", ctx.userId)
            .eq("status", "pending")
            .in("contact_id", contactIds)
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (msg) targetId = msg.id;
        }
      }

      if (!targetId) {
        // If neither was provided or found, check if there's only 1 pending message to cancel safely
        const { data: nextPending } = await supabaseAdmin
          .from("scheduled_messages")
          .select("id, message, scheduled_at, contacts(name, phone)")
          .eq("user_id", ctx.userId)
          .eq("status", "pending")
          .order("scheduled_at", { ascending: true })
          .limit(2);

        if (nextPending && nextPending.length === 1) {
          targetId = nextPending[0].id;
        } else {
          return {
            success: false,
            code: "RESOURCE_NOT_FOUND",
            message: "Não foi possível identificar qual agendamento cancelar. Forneça o ID ou o nome/telefone do destinatário."
          };
        }
      }

      // Perform cancellation
      const { data: cancelled, error } = await supabaseAdmin
        .from("scheduled_messages")
        .update({ status: "cancelled" })
        .eq("id", targetId)
        .eq("user_id", ctx.userId)
        .select("id, message, scheduled_at, contact_id")
        .maybeSingle();

      if (error) throw error;
      if (!cancelled) {
        return {
          success: false,
          code: "RESOURCE_NOT_FOUND",
          message: `Agendamento '${targetId}' não encontrado ou já processado.`
        };
      }

      return {
        success: true,
        code: "SUCCESS",
        message: `Agendamento cancelado com sucesso. A mensagem não será enviada.`,
        data: {
          id: cancelled.id,
          mensagem: cancelled.message,
          dataPrevista: cancelled.scheduled_at,
          status: "cancelled"
        }
      };
    } catch (err: any) {
      console.error("[cancelScheduledMessageTool] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Erro ao cancelar agendamento: ${err.message}`,
        error: err.message
      };
    }
  }
};

