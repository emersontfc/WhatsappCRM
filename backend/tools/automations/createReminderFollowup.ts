import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const createReminderFollowupTool: ToolDefinition = {
  name: "create_reminder_followup",
  description: "Cria um lembrete ou agendamento de follow-up futuro para um cliente no WhatsApp (ex: 'lembrar daqui a 3 dias', 'acompanhar na próxima semana').",
  category: "automations",
  allowedRoles: ["admin", "lead"],
  parameters: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description: "Nome ou telefone do cliente (se vazio, usa a conversa atual)."
      },
      message: {
        type: "string",
        description: "Mensagem ou lembrete de acompanhamento."
      },
      daysFromNow: {
        type: "number",
        description: "Número de dias no futuro para o follow-up (padrão: 1 dia)."
      },
      scheduledDate: {
        type: "string",
        description: "Opcional: data específica em formato ISO (ex: '2026-09-10T10:00:00Z'). Se fornecida, sobrepõe daysFromNow."
      }
    },
    required: ["message"]
  },
  execute: async (args: { recipient?: string; message: string; daysFromNow?: number; scheduledDate?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let targetPhone = ctx.phone;

      if (args.recipient) {
        const clean = args.recipient.replace(/\D/g, "");
        if (clean.length >= 8) {
          targetPhone = clean;
        } else {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("phone")
            .eq("user_id", ctx.userId)
            .ilike("name", `%${args.recipient.trim()}%`)
            .limit(1)
            .maybeSingle();
          if (data?.phone) targetPhone = data.phone;
        }
      }

      if (!targetPhone) {
        return { success: false, message: "Telefone do destinatário não encontrado para criar lembrete." };
      }

      let scheduledAt: Date;
      if (args.scheduledDate) {
        scheduledAt = new Date(args.scheduledDate);
      } else {
        const days = args.daysFromNow && args.daysFromNow > 0 ? args.daysFromNow : 1;
        scheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      const { data: reminder, error } = await supabaseAdmin
        .from("reminders")
        .insert({
          user_id: ctx.userId,
          phone: targetPhone,
          message: args.message.trim(),
          scheduled_at: scheduledAt.toISOString(),
          sent: false,
          created_at: new Date().toISOString()
        })
        .select("id, phone, scheduled_at, message")
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `Lembrete de follow-up criado para ${targetPhone} programado para ${scheduledAt.toLocaleDateString("pt-PT")}.`,
        data: {
          id: reminder.id,
          destinatario: reminder.phone,
          dataProgramada: reminder.scheduled_at,
          texto: reminder.message
        }
      };
    } catch (err: any) {
      console.error("[Tool create_reminder_followup] Error:", err);
      return {
        success: false,
        message: "Erro ao agendar lembrete de follow-up.",
        error: err.message
      };
    }
  }
};
