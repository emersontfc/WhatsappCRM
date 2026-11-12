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
        description: "Nova etapa do lead: 'novo', 'em_atendimento', 'proposta_enviada', 'venda_fechada', 'perdido'.",
        enum: ["novo", "em_atendimento", "proposta_enviada", "venda_fechada", "ganho", "perdido"]
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

      let rawStage = (args.stage || "novo").toLowerCase();
      if (rawStage === "ganho") rawStage = "venda_fechada";
      const normalizedStage = ["novo", "em_atendimento", "proposta_enviada", "venda_fechada", "perdido"].includes(rawStage)
        ? rawStage
        : "novo";

      // 1. Find lead
      let lead = null;
      if (cleanPhone.length >= 7) {
        const { data } = await supabaseAdmin
          .from("leads")
          .select("id, name, phone, stage, status")
          .eq("user_id", ctx.userId)
          .ilike("phone", `%${cleanPhone}%`)
          .maybeSingle();
        lead = data;
      }

      if (!lead) {
        const { data } = await supabaseAdmin
          .from("leads")
          .select("id, name, phone, stage, status")
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

      // 2. Update lead stage & status simultaneously
      const updatePayload: any = {
        stage: normalizedStage,
        status: normalizedStage,
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
        message: `Lead ${lead.name || lead.phone} movido com sucesso para a etapa "${normalizedStage}".`,
        data: {
          leadId: lead.id,
          nome: lead.name,
          telefone: lead.phone,
          novaEtapa: normalizedStage
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
