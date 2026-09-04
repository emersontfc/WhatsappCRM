import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const getPipelineMetricsTool: ToolDefinition = {
  name: "get_pipeline_metrics",
  description: "Consulta as métricas gerais do CRM e funil de vendas (total de leads, distribuição por etapas e oportunidades quentes). Use quando o administrador perguntar sobre vendas, relatórios, métricas de funil ou status de negócios.",
  category: "crm",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      stage: {
        type: "string",
        description: "Opcional: filtrar por etapa específica ('novo', 'em_atendimento', 'proposta_enviada', 'ganho', 'perdido')."
      }
    }
  },
  execute: async (args: { stage?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      let query = supabaseAdmin
        .from("leads")
        .select("id, name, phone, status, last_message, updated_at")
        .eq("user_id", ctx.userId);

      if (args.stage) {
        query = query.eq("status", args.stage);
      }

      const { data: leads, error } = await query.order("updated_at", { ascending: false }).limit(50);

      if (error) throw error;

      const { count: contactsCount } = await supabaseAdmin
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId);

      const total = leads?.length || 0;
      const byStage: Record<string, number> = {};
      
      leads?.forEach(l => {
        const st = l.status || "novo";
        byStage[st] = (byStage[st] || 0) + 1;
      });

      const topOpportunities = leads?.slice(0, 5).map(l => ({
        nome: l.name || "Lead sem nome",
        telefone: l.phone,
        etapa: l.status || "novo",
        ultimaInteracao: l.last_message ? l.last_message.substring(0, 80) : ""
      }));

      const summaryMsg = total > 0
        ? `Métricas do CRM obtidas: ${total} oportunidade(s) no funil e ${contactsCount || 0} contacto(s) na base.`
        : `Funil de vendas consultado: 0 oportunidade(s) qualificada(s) de momento, e ${contactsCount || 0} contacto(s) na base do WhatsApp.`;

      return {
        success: true,
        message: summaryMsg,
        data: {
          totalLeads: total,
          totalContactos: contactsCount || 0,
          distribuicaoEtapas: byStage,
          oportunidadesRecentes: topOpportunities
        }
      };
    } catch (err: any) {
      console.error("[Tool get_pipeline_metrics] Error:", err);
      return {
        success: false,
        message: "Erro ao consultar métricas do pipeline.",
        error: err.message
      };
    }
  }
};
