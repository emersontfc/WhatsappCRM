import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const createMarketingCampaignTool: ToolDefinition = {
  name: "createMarketingCampaign",
  description: "Prepara e agenda uma campanha de mensagens segmentada para um público-alvo com base em etiquetas ou filtros.",
  category: "marketing",
  allowedRoles: ["admin"],
  riskLevel: "high",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      campaignName: {
        type: "string",
        description: "Nome de identificação da campanha"
      },
      targetTag: {
        type: "string",
        description: "Etiqueta dos contatos de destino (ex: 'Interessado em 5GB', 'VIP', 'WhatsApp')"
      },
      message: {
        type: "string",
        description: "Texto da mensagem promocional a ser disparada"
      },
      scheduledAt: {
        type: "string",
        description: "Data e hora de envio em formato ISO (ex: '2026-11-13T10:00:00Z'). Se omitido, envia em 5 minutos."
      }
    },
    required: ["campaignName", "message"]
  },
  execute: async (args: { campaignName: string; targetTag?: string; message: string; scheduledAt?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      // 1. Fetch matching audience
      let query = supabaseAdmin
        .from("contacts")
        .select("id, name, phone, tags")
        .eq("user_id", ctx.userId)
        .not("phone", "is", null);

      if (args.targetTag) {
        query = query.contains("tags", [args.targetTag]);
      }

      const { data: contacts, error: cErr } = await query.limit(50);
      if (cErr) throw cErr;

      const validContacts = (contacts || []).filter(c => {
        const p = (c.phone || "").replace(/\D/g, "");
        return p.length >= 8 && !p.startsWith("120363");
      });

      if (validContacts.length === 0) {
        return {
          success: false,
          message: `Nenhum contato encontrado com a etiqueta "${args.targetTag || 'Geral'}". Não foi possível agendar a campanha.`
        };
      }

      // 2. Schedule messages with spaced intervals (to respect WhatsApp rate limits)
      const baseTime = args.scheduledAt ? new Date(args.scheduledAt).getTime() : Date.now() + 5 * 60 * 1000;
      const scheduledPayloads = validContacts.map((contact, index) => {
        // Space each message by 8 to 15 seconds to prevent spam blocks
        const dispatchTime = new Date(baseTime + index * 10000).toISOString();
        const personalizedMsg = args.message.replace(/\{nome\}/gi, contact.name || "Cliente");

        return {
          user_id: ctx.userId,
          contact_id: contact.id,
          message: personalizedMsg,
          scheduled_at: dispatchTime,
          status: "pending",
          target_type: "contact",
          created_at: new Date().toISOString()
        };
      });

      const { error: insErr } = await supabaseAdmin.from("scheduled_messages").insert(scheduledPayloads);
      if (insErr) throw insErr;

      return {
        success: true,
        message: `Campanha "${args.campaignName}" preparada com sucesso! Foram agendados ${validContacts.length} envios espaçados para a etiqueta "${args.targetTag || 'Todos'}".`,
        data: {
          campaignName: args.campaignName,
          targetCount: validContacts.length,
          firstSendAt: new Date(baseTime).toISOString()
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao criar campanha de marketing: ${err.message}`,
        error: err.message
      };
    }
  }
};
