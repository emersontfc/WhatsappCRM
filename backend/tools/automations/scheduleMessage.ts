import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { parseScheduledDateTime } from "../../utils/dateTimeParser.ts";
import { saveContactIdentity } from "../../services/contactIdentity.ts";
import { readContactPhone } from "../../../shared/contactPhone.ts";

export const scheduleMessageTool: ToolDefinition = {
  name: "schedule_message",
  description: "Agenda o envio de uma mensagem ou cobrança/fatura para um cliente no WhatsApp para uma data e hora futura específica (aceita expressões naturais como 'amanhã às 9h', 'sexta às 15h' ou datas ISO).",
  category: "automations",
  allowedRoles: ["admin"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description: "Nome ou telefone do cliente destinatário (ex: 'João', '841234567' ou '258841234567')."
      },
      message: {
        type: "string",
        description: "Texto da mensagem ou aviso de fatura a ser enviada."
      },
      scheduledAt: {
        type: "string",
        description: "Data e hora para o envio (ex: 'amanhã às 09:00', 'sexta às 15h', '2026-11-20T09:00:00Z')."
      },
      mediaUrl: {
        type: "string",
        description: "Opcional: URL de arquivo anexo (como PDF de fatura, recibo ou imagem)."
      },
      mediaFilename: {
        type: "string",
        description: "Opcional: Nome do arquivo (ex: 'Fatura_Novembro_2026.pdf')."
      }
    },
    required: ["recipient", "message", "scheduledAt"]
  },
  execute: async (args: { recipient: string; message: string; scheduledAt: string; mediaUrl?: string; mediaFilename?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      if (!args?.message || !args.message.trim()) {
        return {
          success: false,
          code: "INVALID_ARGUMENTS",
          message: "O texto da mensagem é obrigatório para agendamento.",
          retryable: false
        };
      }

      // 1. Resolve tenant timezone from company_profile
      let timezone = "Africa/Maputo";
      try {
        const { data: profile } = await supabaseAdmin
          .from("company_profile")
          .select("timezone")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (profile?.timezone) timezone = profile.timezone;
      } catch {}

      // 2. Parse scheduled date with natural language parser
      const parsedDate = parseScheduledDateTime(args.scheduledAt, new Date(), timezone);
      const sendDate = parsedDate.date;

      // 3. Resolve contact
      const recipientRaw = String(args?.recipient || "").trim();
      let contactName = recipientRaw;
      let contactPhone = "";
      let contactId = "";

      const cleanPhone = readContactPhone(recipientRaw);
      if (cleanPhone) {
        const saved = await saveContactIdentity(ctx.userId, { phone: cleanPhone, tags: ["Agendamento"] });
        contactId = saved?.id ?? "";
        contactName = saved?.name || cleanPhone;
        contactPhone = saved?.phone || cleanPhone;
      } else if (recipientRaw.length >= 2) {
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id, name, phone")
          .eq("user_id", ctx.userId)
          .ilike("name", `%${recipientRaw}%`)
          .limit(1)
          .maybeSingle();

        if (data) {
          contactId = data.id;
          contactName = data.name;
          contactPhone = data.phone;
        }
      }

      if (!contactId) {
        return {
          success: false,
          code: "RECIPIENT_NOT_FOUND",
          message: `Não foi possível localizar ou cadastrar o contacto '${args.recipient}'. Por favor forneça o número com DDD/código do país.`,
          retryable: false
        };
      }

      // 4. Detect media mimetype if mediaUrl present
      let mediaType: string | null = null;
      let mediaMimetype: string | null = null;
      if (args.mediaUrl) {
        mediaType = args.mediaUrl.endsWith(".pdf") ? "document" : "image";
        mediaMimetype = args.mediaUrl.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
      }

      // 5. Check WhatsApp session warning (if session not connected, still persist with warning)
      const session = ctx.whatsappManager?.getSession?.(ctx.userId);
      const isConnected = session?.status === "connected";

      // 6. Persist into scheduled_messages
      const { data: scheduled, error } = await supabaseAdmin
        .from("scheduled_messages")
        .insert({
          user_id: ctx.userId,
          contact_id: contactId,
          message: args.message.trim(),
          media_url: args.mediaUrl || null,
          media_type: mediaType,
          media_mimetype: mediaMimetype,
          media_filename: args.mediaFilename || (mediaType === "document" ? "fatura.pdf" : null),
          target_type: "contact",
          status: "pending",
          scheduled_at: sendDate.toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("[scheduleMessageTool] DB insert error:", error);
        return {
          success: false,
          code: "PERSISTENCE_FAILED",
          message: "Erro ao persistir agendamento no banco de dados.",
          error: error.message
        };
      }

      const warningNotice = isConnected 
        ? "" 
        : "\n⚠️ *Nota:* A sua sessão WhatsApp está atualmente desconectada. Conecte o aparelho antes do horário de disparo para garantir o envio.";

      return {
        success: true,
        code: "SUCCESS",
        message: `Mensagem agendada com sucesso para ${contactName} (${contactPhone}) para ${parsedDate.formattedLocal} (${timezone}).${warningNotice}`,
        data: {
          id: scheduled.id,
          cliente: contactName,
          contacto: contactName,
          telefone: contactPhone,
          dataEnvio: sendDate.toISOString(),
          dataAgendada: parsedDate.formattedLocal,
          timezone,
          mensagem: args.message
        }
      };
    } catch (err: any) {
      console.error("[Tool schedule_message] Unexpected error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Erro ao agendar mensagem: ${err.message || 'Falha inesperada.'}`,
        error: err.message
      };
    }
  }
};
