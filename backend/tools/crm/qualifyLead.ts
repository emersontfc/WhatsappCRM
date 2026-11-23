import type { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { normalizeContactPhone, readContactPhone } from "../../../shared/contactPhone.ts";
import { salesToolFailure } from "../../services/salesToolFailure.ts";

export const qualifyLeadTool: ToolDefinition = {
  name: "qualifyLead",
  description: "Regista o nível de interesse e as notas comerciais do lead e, se existir um contacto, acrescenta uma etiqueta.",
  category: "crm",
  allowedRoles: ["admin", "lead"],
  riskLevel: "low",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      phone: {
        type: "string",
        description: "Telefone de outro lead para um comando do administrador. Em conversas com clientes usa o número da própria conversa."
      },
      interestLevel: {
        type: "string",
        description: "Nível de interesse: 'alto', 'medio' ou 'baixo'",
        enum: ["alto", "medio", "baixo"]
      },
      tag: {
        type: "string",
        description: "Etiqueta comercial a adicionar (ex: 'Interessado em 5GB', 'VIP', 'Decisor')"
      },
      notes: {
        type: "string",
        description: "Resumo da necessidade identificada ou anotação comercial"
      }
    }
  },
  execute: async (args: { phone?: string; interestLevel?: string; tag?: string; notes?: string }, ctx: ToolContext): Promise<ToolResult> => {
    const conversationPhone = normalizeContactPhone(ctx.phone);
    const targetPhone = ctx.role === "admin" && args.phone ? readContactPhone(args.phone) : conversationPhone;
    if (!targetPhone) return { success: false, message: "Não foi possível identificar o telefone do contacto." };
    if (args.interestLevel && !["alto", "medio", "baixo"].includes(args.interestLevel)) {
      return { success: false, message: "Indica um nível de interesse alto, médio ou baixo." };
    }
    const inConversation = targetPhone === conversationPhone;
    const tag = typeof args.tag === "string" ? args.tag.trim().slice(0, 64) : null;
    const note = typeof args.notes === "string" ? args.notes.trim().slice(0, 500) : null;
    try {
      const { data, error } = await supabaseAdmin.rpc("agentx_qualify_sales_lead", {
        p_user: ctx.userId, p_phone: targetPhone, p_contact: inConversation ? ctx.contactId ?? null : null,
        p_name: inConversation ? ctx.contactName ?? null : null,
        p_message: ctx.role === "lead" ? ctx.incomingText ?? null : null,
        p_interest: args.interestLevel || null, p_tag: tag || null, p_note: note || null
      });
      if (error) throw error;
      if (!data?.id) throw new Error("Lead write returned no identifier");
      return {
        success: true,
        message: ctx.role === "lead" ? "Registei o teu interesse." : "A qualificação do lead foi guardada.",
        data
      };
    } catch (error) {
      const missingContact = (error as { code?: string } | null)?.code === "P0002";
      return salesToolFailure("qualifyLead", error, missingContact
        ? "Não encontrei um contacto com esse número nesta conta."
        : "Não foi possível guardar o interesse. Tenta novamente ou fala com a equipa.");
    }
  }
};

