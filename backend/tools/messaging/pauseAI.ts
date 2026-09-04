import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const pauseAITool: ToolDefinition = {
  name: "pause_ai_conversation",
  description: "Pausa a IA para um contacto específico (ativa o Modo Humano). Use quando o administrador disser 'pausa a IA nesta conversa', 'pausa o bot para o cliente X' ou quando um atendente humano for assumir.",
  category: "messaging",
  allowedRoles: ["admin", "lead"], // Can be triggered by admin command or by lead asking for human
  parameters: {
    type: "object",
    properties: {
      phoneOrName: {
        type: "string",
        description: "Telefone ou nome do cliente para pausar a IA (se vazio, usa a conversa atual)."
      }
    }
  },
  execute: async (args: { phoneOrName?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let targetPhone = ctx.phone;

      if (args.phoneOrName) {
        const clean = args.phoneOrName.replace(/\D/g, "");
        if (clean.length >= 8) {
          targetPhone = clean;
        } else {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("phone")
            .eq("user_id", ctx.userId)
            .ilike("name", `%${args.phoneOrName.trim()}%`)
            .limit(1)
            .maybeSingle();
          if (data?.phone) targetPhone = data.phone;
        }
      }

      if (!targetPhone) {
        return { success: false, message: "Contacto não identificado para pausar a IA." };
      }

      const { error } = await supabaseAdmin
        .from("contacts")
        .update({
          ai_paused: true,
          ai_paused_at: new Date().toISOString()
        })
        .eq("user_id", ctx.userId)
        .eq("phone", targetPhone);

      if (error) throw error;

      return {
        success: true,
        message: `IA pausada para o contacto ${targetPhone}. O modo de atendimento humano está ativo.`,
        data: { phone: targetPhone, ai_paused: true }
      };
    } catch (err: any) {
      console.error("[Tool pause_ai_conversation] Error:", err);
      return {
        success: false,
        message: "Erro ao pausar a IA.",
        error: err.message
      };
    }
  }
};
