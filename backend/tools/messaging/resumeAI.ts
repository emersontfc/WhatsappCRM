import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const resumeAITool: ToolDefinition = {
  name: "resume_ai_conversation",
  description: "Retoma as respostas automáticas da IA para um contacto previamente pausado. Use quando o administrador disser 'retoma a IA nesta conversa', 'reativa o bot' ou 'volta a responder automaticamente'.",
  category: "messaging",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      phoneOrName: {
        type: "string",
        description: "Telefone ou nome do cliente para reativar a IA (se vazio, usa a conversa atual)."
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
        return { success: false, message: "Contacto não identificado para retomar a IA." };
      }

      const { error } = await supabaseAdmin
        .from("contacts")
        .update({
          ai_paused: false,
          ai_paused_at: null
        })
        .eq("user_id", ctx.userId)
        .eq("phone", targetPhone);

      if (error) throw error;

      return {
        success: true,
        message: `IA retomada com sucesso para o contacto ${targetPhone}. As respostas automáticas estão ativas novamente.`,
        data: { phone: targetPhone, ai_paused: false }
      };
    } catch (err: any) {
      console.error("[Tool resume_ai_conversation] Error:", err);
      return {
        success: false,
        message: "Erro ao retomar a IA.",
        error: err.message
      };
    }
  }
};
