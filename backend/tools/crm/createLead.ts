import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const createLeadTool: ToolDefinition = {
  name: "create_lead",
  description: "Cadastra ou qualifica um lead no CRM com nome, interesse/intenção e notas de atendimento. Use quando um cliente demonstrar interesse em comprar, agendar ou quando o admin pedir para cadastrar um lead.",
  category: "crm",
  allowedRoles: ["admin", "lead"],
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Nome do lead/cliente."
      },
      phone: {
        type: "string",
        description: "Telefone do lead (se não informado, usa o telefone da conversa atual)."
      },
      interest: {
        type: "string",
        description: "Serviço ou produto de interesse do lead."
      },
      stage: {
        type: "string",
        description: "Etapa inicial do lead (padrão: 'novo').",
        enum: ["novo", "em_atendimento", "proposta_enviada", "ganho", "perdido"]
      }
    }
  },
  execute: async (args: { name?: string; phone?: string; interest?: string; stage?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const targetPhone = args.phone ? args.phone.replace(/\D/g, "") : ctx.phone;

      if (!targetPhone) {
        return { success: false, message: "Telefone obrigatório para cadastrar lead." };
      }

      // Check existing contact
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("id, name")
        .eq("user_id", ctx.userId)
        .eq("phone", targetPhone)
        .maybeSingle();

      const leadName = args.name || contact?.name || null;

      const { data: lead, error } = await supabaseAdmin
        .from("leads")
        .upsert({
          user_id: ctx.userId,
          phone: targetPhone,
          name: leadName,
          status: args.stage || "novo",
          last_message: args.interest ? `Interesse: ${args.interest}` : null,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id,phone" })
        .select("id, name, phone, status")
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `Lead ${leadName || targetPhone} cadastrado/qualificado com sucesso no CRM.`,
        data: lead
      };
    } catch (err: any) {
      console.error("[Tool create_lead] Error:", err);
      return {
        success: false,
        message: "Erro ao criar/atualizar lead.",
        error: err.message
      };
    }
  }
};
