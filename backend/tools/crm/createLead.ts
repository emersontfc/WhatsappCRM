import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { normalizeContactPhone, readContactPhone } from "../../../shared/contactPhone.ts";
import { manualLeadStage, saveManualSalesLead } from "../../services/manualSalesLead.ts";
import { salesToolFailure } from "../../services/salesToolFailure.ts";

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
        enum: ["novo", "em_atendimento", "proposta_enviada", "venda_fechada", "ganho", "perdido"]
      }
    }
  },
  execute: async (args: { name?: string; phone?: string; interest?: string; stage?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const conversationPhone = normalizeContactPhone(ctx.phone);
      const targetPhone = ctx.role === "admin" && args.phone ? readContactPhone(args.phone) : conversationPhone;

      if (!targetPhone) {
        return { success: false, message: "Telefone obrigatório para cadastrar lead." };
      }

      if (ctx.role === "lead") {
        const { data, error } = await supabaseAdmin.rpc("agentx_capture_sales_lead", {
          p_user: ctx.userId, p_phone: targetPhone, p_contact: ctx.contactId ?? null,
          p_name: ctx.contactName ?? null, p_activity: "interest", p_message: ctx.incomingText ?? null
        });
        if (error) throw error;
        if (!data) throw new Error("Lead write returned no identifier");
        return { success: true, message: "Interesse registado no CRM.", data: { id: data } };
      }

      const stage = manualLeadStage(args.stage === "ganho" ? "venda_fechada" : args.stage);
      if (args.stage && !stage) return { success: false, message: "Indica uma etapa válida para o lead." };
      const sameConversation = targetPhone === conversationPhone;
      const lead = await saveManualSalesLead(ctx.userId, {
        phone: targetPhone, contactId: sameConversation ? ctx.contactId : undefined,
        name: args.name?.trim().slice(0, 150) || (sameConversation ? ctx.contactName?.slice(0, 150) : undefined),
        stage, lastMessage: args.interest ? `Interesse: ${args.interest}`.slice(0, 500) : undefined
      });

      return {
        success: true,
        message: `Oportunidade guardada para ${lead.name || lead.phone}.`,
        data: lead
      };
    } catch (error) {
      return salesToolFailure("create_lead", error, "Não foi possível guardar a oportunidade.");
    }
  }
};
