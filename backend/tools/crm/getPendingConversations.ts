import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const getPendingConversationsTool: ToolDefinition = {
  name: "get_pending_conversations",
  description: "Consulta as conversas pendentes de resposta ou com mensagens não lidas no WhatsApp. Use quando o administrador perguntar sobre conversas pendentes, mensagens atrasadas ou clientes aguardando resposta.",
  category: "crm",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Quantidade máxima de conversas a listar (padrão: 10)."
      }
    }
  },
  execute: async (args: { limit?: number }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const limit = args.limit || 10;
      
      let { data: contacts, error } = await supabaseAdmin
        .from("contacts")
        .select("id, name, phone, last_message_at, last_message_text")
        .eq("user_id", ctx.userId)
        .not("last_message_at", "is", null)
        .order("last_message_at", { ascending: false })
        .limit(limit);

      if (error) {
        // Fallback: list recent contacts
        const fallback = await supabaseAdmin
          .from("contacts")
          .select("id, name, phone, last_message_at, last_message_text")
          .eq("user_id", ctx.userId)
          .limit(limit);
        contacts = fallback.data;
      }

      if (!contacts || contacts.length === 0) {
        return {
          success: true,
          message: "Não há conversas pendentes no momento. Todas as mensagens estão em dia!",
          data: { total: 0, conversations: [] }
        };
      }

      const totalUnread = contacts.reduce((acc, c: any) => acc + (c.unread_count || 0), 0);
      const summaryList = contacts.map((c: any) => ({
        nome: c.name || "Sem nome",
        telefone: c.phone,
        mensagensNaoLidas: c.unread_count || 0,
        ultimaMensagem: c.last_message_text || "Sem texto",
        atendimentoHumano: c.ai_paused ? "IA Pausada (Manual)" : "IA Ativa",
        data: c.last_message_at ? new Date(c.last_message_at).toLocaleString("pt-PT") : "Recentemente"
      }));

      return {
        success: true,
        message: `Existem ${contacts.length} conversas ativas/pendentes com um total de ${totalUnread} mensagens não lidas.`,
        data: {
          totalPendentes: contacts.length,
          totalMensagensNaoLidas: totalUnread,
          conversas: summaryList
        }
      };
    } catch (err: any) {
      console.error("[Tool get_pending_conversations] Error:", err);
      return {
        success: false,
        message: "Erro ao consultar conversas pendentes.",
        error: err.message
      };
    }
  }
};
