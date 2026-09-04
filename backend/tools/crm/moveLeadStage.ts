import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const moveLeadStageTool: ToolDefinition = {
  name: "move_lead_stage",
  description: "Atualiza a etapa ou status de um lead no funil do CRM (ex: 'novo', 'em_atendimento', 'proposta_enviada', 'ganho', 'perdido').",
  category: "crm",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      phoneOrName: {
        type: "string",
        description: "Telefone ou nome do lead a ser atualizado."
      },
      stage: {
        type: "string",
        description: "Nova etapa do lead: 'novo', 'em_atendimento', 'proposta_enviada', 'ganho', 'perdido'.",
        enum: ["novo", "em_atendimento", "proposta_enviada", "ganho", "perdido"]
      },
      notes: {
        type: "string",
        description: "Opcional: nota ou observação sobre a mudança."
      }
    },
    required: ["phoneOrName", "stage"]
  },
  execute: async (args: { phoneOrName: string; stage: string; notes?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const cleanPhone = args.phoneOrName.replace(/\D/g, "");

      // 1. Find lead
      let lead = null;
      if (cleanPhone.length >= 7) {
        const { data } = await supabaseAdmin
          .from("leads")
          .select("id, name, phone, status")
          .eq("user_id", ctx.userId)
          .ilike("phone", `%${cleanPhone}%`)
          .maybeSingle();
        lead = data;
      }

      if (!lead) {
        const { data } = await supabaseAdmin
          .from("leads")
          .select("id, name, phone, status")
          .eq("user_id", ctx.userId)
          .ilike("name", `%${args.phoneOrName.trim()}%`)
          .limit(1)
          .maybeSingle();
        lead = data;
      }

      if (!lead) {
        return {
          success: false,
          message: `Não foi encontrado nenhum lead com o identificador "${args.phoneOrName}".`
        };
      }

      // 2. Update lead stage
      const updatePayload: any = {
        status: args.stage,
        updated_at: new Date().toISOString()
      };

      if (args.notes) {
        updatePayload.last_message = args.notes;
      }

      const { error } = await supabaseAdmin
        .from("leads")
        .update(updatePayload)
        .eq("id", lead.id)
        .eq("user_id", ctx.userId);

      if (error) throw error;

      return {
        success: true,
        message: `Lead ${lead.name || lead.phone} movido com sucesso para a etapa "${args.stage}".`,
        data: {
          leadId: lead.id,
          nome: lead.name,
          telefone: lead.phone,
          novaEtapa: args.stage
        }
      };
    } catch (err: any) {
      console.error("[Tool move_lead_stage] Error:", err);
      return {
        success: false,
        message: "Erro ao mover etapa do lead.",
        error: err.message
      };
    }
  }
};
