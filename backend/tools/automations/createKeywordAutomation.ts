import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const createKeywordAutomationTool: ToolDefinition = {
  name: "create_keyword_automation",
  description: "Cria uma regra de automação no sistema para responder automaticamente sempre que um cliente enviar uma palavra-chave específica (ex: 'preço', 'orçamento', 'horário', 'localização').",
  category: "automations",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "Palavra-chave ou gatilho que ativará a resposta (ex: 'preço', 'cardápio', 'tabela')."
      },
      response: {
        type: "string",
        description: "Texto completo da resposta automática que o WhatsApp enviará."
      },
      name: {
        type: "string",
        description: "Opcional: nome amigável para a regra (se não informado, será gerado automaticamente)."
      }
    },
    required: ["keyword", "response"]
  },
  execute: async (args: { keyword: string; response: string; name?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const cleanKeyword = args.keyword.trim().toLowerCase();
      const ruleName = args.name || `Automação: ${cleanKeyword}`;

      const { data: newRule, error } = await supabaseAdmin
        .from("automations")
        .insert({
          user_id: ctx.userId,
          name: ruleName,
          trigger: "keyword",
          keyword: cleanKeyword,
          response: args.response.trim(),
          response_type: "text",
          delay: 2,
          active: true,
          created_at: new Date().toISOString()
        })
        .select("id, name, keyword")
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `Automação "${newRule.name}" criada com sucesso! Sempre que alguém enviar "${newRule.keyword}", o Agentex responderá automaticamente.`,
        data: {
          id: newRule.id,
          nome: newRule.name,
          palavraChave: newRule.keyword,
          resposta: args.response
        }
      };
    } catch (err: any) {
      console.error("[Tool create_keyword_automation] Error:", err);
      return {
        success: false,
        message: "Erro ao criar automação de palavra-chave.",
        error: err.message
      };
    }
  }
};
