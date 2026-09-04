import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const sendDirectMessageTool: ToolDefinition = {
  name: "send_direct_message",
  description: "Envia uma mensagem de texto ou relatório via WhatsApp diretamente para o administrador ('mim', 'meu whatsapp') ou para um cliente/contacto. Sempre informe 'recipient' (ex: 'mim' ou número de telefone com código do país) e 'message' com o texto a ser enviado.",
  category: "messaging",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description: "Telefone ou nome do destinatário (ex: '258848858288' ou '848858288') ou use 'mim' para enviar ao WhatsApp do próprio administrador."
      },
      message: {
        type: "string",
        description: "Texto completo da mensagem a ser entregue no WhatsApp."
      }
    },
    required: ["recipient", "message"]
  },
  execute: async (args: { recipient?: string; message?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (!ctx.whatsappManager) {
        return { success: false, message: "WhatsApp Manager não disponível." };
      }

      const recipientRaw = String(args?.recipient || "").trim();
      let textMessage = String(args?.message || "").trim();

      // Check if recipient means sending to self/admin ("mim", "eu", "para mim", "meu whatsapp", etc. or empty)
      const isSelf = !recipientRaw || 
        /^(mim|eu|me|meu|admin|proprietario|dono|meu\s*whatsapp|para\s*mim|para\s*o\s*meu\s*whatsapp)$/i.test(recipientRaw);

      let targetPhone = "";
      let contactName = "";

      if (isSelf) {
        // Collect admin phone candidates
        const candidates = [
          ctx.userPhone,
          ctx.phone,
          ctx.jid?.split("@")[0]
        ].filter(Boolean);

        const { data: userData } = await supabaseAdmin
          .from("users")
          .select("phone, admin_phones")
          .eq("id", ctx.userId)
          .maybeSingle();

        if (userData?.phone) candidates.push(userData.phone);
        if (userData?.admin_phones) candidates.push(...userData.admin_phones.split(/[\n,;]+/));

        const cleanAdmin = candidates
          .map(p => String(p).replace(/\D/g, ""))
          .find(p => p.length >= 8);

        if (cleanAdmin) {
          targetPhone = cleanAdmin;
          contactName = "Você (Administrador)";
        }
      }

      if (!targetPhone) {
        const cleanPhone = recipientRaw.replace(/\D/g, "");
        if (cleanPhone.length >= 8) {
          targetPhone = cleanPhone;
        } else if (recipientRaw.length >= 2) {
          // Search by name in contacts
          const { data: contact } = await supabaseAdmin
            .from("contacts")
            .select("name, phone")
            .eq("user_id", ctx.userId)
            .ilike("name", `%${recipientRaw}%`)
            .limit(1)
            .maybeSingle();

          if (contact && contact.phone) {
            targetPhone = contact.phone.replace(/\D/g, "");
            contactName = contact.name || "";
          }
        }
      }

      if (!targetPhone) {
        return {
          success: false,
          message: `Não foi possível identificar o destinatário "${recipientRaw || 'não informado'}".`
        };
      }

      // Auto-prefix Mozambique country code 258 if 9 digits starting with 8
      if (targetPhone.length === 9 && /^8[2-7]/.test(targetPhone)) {
        targetPhone = `258${targetPhone}`;
      }

      // If message text was omitted by the AI, generate a comprehensive CRM summary automatically
      if (!textMessage) {
        const { data: leads } = await supabaseAdmin
          .from("leads")
          .select("name, phone, status")
          .eq("user_id", ctx.userId);
        const { count: contactsCount } = await supabaseAdmin
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", ctx.userId);

        textMessage = `📊 *Métricas do seu CRM*\n\n• Total de Contactos: ${contactsCount || 0}\n• Total de Leads: ${leads?.length || 0}\n\nEnviado automaticamente pelo seu Agentex.`;
      }

      // Resolve JID: LIDs (14+ digits starting with 1 or 3) vs standard phone
      const jid = (targetPhone.length >= 14 && (targetPhone.startsWith("1") || targetPhone.startsWith("3")))
        ? `${targetPhone}@lid`
        : `${targetPhone}@s.whatsapp.net`;

      console.log(`[Tool send_direct_message] Sending to JID "${jid}" (phone: ${targetPhone}) for user ${ctx.userId}`);

      // Dispatch via whatsappManager
      await ctx.whatsappManager.sendMessage(ctx.userId, jid, textMessage);

      return {
        success: true,
        message: `Mensagem enviada com sucesso para ${contactName ? contactName + " (" + targetPhone + ")" : "+" + targetPhone}.`,
        data: {
          destinatario: targetPhone,
          nome: contactName,
          mensagem: textMessage
        }
      };
    } catch (err: any) {
      console.error("[Tool send_direct_message] Error:", err);
      return {
        success: false,
        message: `Falha ao enviar mensagem pelo WhatsApp: ${err.message || 'Erro desconhecido'}`,
        error: err.message
      };
    }
  }
};
