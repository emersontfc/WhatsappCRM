import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const searchContactTool: ToolDefinition = {
  name: "search_contact",
  description: "Busca um contacto ou lead por nome ou número de telefone no sistema. Use para encontrar o telefone, histórico ou informações de um cliente antes de responder ou executar ações.",
  category: "crm",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Nome ou número de telefone (ex: 'João', 'Maria', '841234567')."
      }
    },
    required: ["query"]
  },
  execute: async (args: { query: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (!args.query) {
        return { success: false, message: "Parâmetro de busca obrigatório." };
      }

      const cleanQuery = args.query.trim();
      const cleanPhone = cleanQuery.replace(/\D/g, "");

      let contactQuery = supabaseAdmin
        .from("contacts")
        .select("id, name, phone, tags, last_message_at, last_message_text")
        .eq("user_id", ctx.userId);

      if (cleanPhone.length >= 4) {
        contactQuery = contactQuery.or(`name.ilike.%${cleanQuery}%,phone.ilike.%${cleanPhone}%`);
      } else {
        contactQuery = contactQuery.ilike("name", `%${cleanQuery}%`);
      }

      const { data: contacts, error } = await contactQuery.limit(5);

      if (error) throw error;

      if (!contacts || contacts.length === 0) {
        return {
          success: true,
          message: `Nenhum contacto encontrado para "${cleanQuery}".`,
          data: { contacts: [] }
        };
      }

      return {
        success: true,
        message: `Encontrado(s) ${contacts.length} contacto(s) correspondente(s).`,
        data: {
          contacts: contacts.map((c: any) => ({
            id: c.id,
            nome: c.name || "Sem nome",
            telefone: c.phone,
            atendimentoHumano: c.ai_paused ? "IA Pausada" : "IA Ativa",
            tags: c.tags || [],
            ultimaMensagem: c.last_message_text || "Sem mensagens"
          }))
        }
      };
    } catch (err: any) {
      console.error("[Tool search_contact] Error:", err);
      return {
        success: false,
        message: "Erro ao buscar contacto.",
        error: err.message
      };
    }
  }
};
