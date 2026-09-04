import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const scheduleMessageTool: ToolDefinition = {
  name: "schedule_message",
  description: "Agenda o envio de uma mensagem ou cobrança/fatura para um cliente no WhatsApp para uma data e hora futura específica.",
  category: "automations",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description: "Nome ou telefone do cliente destinatário (ex: 'João' ou '258841234567')."
      },
      message: {
        type: "string",
        description: "Texto da mensagem ou aviso de fatura a ser enviada."
      },
      scheduledAt: {
        type: "string",
        description: "Data e hora para o envio em formato ISO (ex: '2026-09-05T09:00:00Z') ou 'YYYY-MM-DD HH:mm'."
      },
      mediaUrl: {
        type: "string",
        description: "Opcional: URL de arquivo anexo (como PDF de fatura, recibo ou imagem)."
      },
      mediaFilename: {
        type: "string",
        description: "Opcional: Nome do arquivo (ex: 'Fatura_09_2026.pdf')."
      }
    },
    required: ["recipient", "message", "scheduledAt"]
  },
  execute: async (args: { recipient: string; message: string; scheduledAt: string; mediaUrl?: string; mediaFilename?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      // 1. Resolve contact
      let recipientRaw = String(args?.recipient || "").trim();
      let contactName = recipientRaw;
      let contactPhone = "";
      let contactId = "";

      let cleanPhone = recipientRaw.replace(/\D/g, "");
      if (cleanPhone.length === 9 && /^8[2-7]/.test(cleanPhone)) {
        cleanPhone = `258${cleanPhone}`;
      }

      if (cleanPhone.length >= 8) {
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id, name, phone")
          .eq("user_id", ctx.userId)
          .eq("phone", cleanPhone)
          .maybeSingle();

        if (data) {
          contactId = data.id;
          contactName = data.name;
          contactPhone = data.phone;
        } else {
          contactPhone = cleanPhone;
        }
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

      // If contact does not exist yet, create it
      if (!contactId && contactPhone) {
        const { data: newC } = await supabaseAdmin
          .from("contacts")
          .insert({
            user_id: ctx.userId,
            name: contactName || contactPhone,
            phone: contactPhone,
            tags: ["Agendamento"]
          })
          .select("id")
          .single();
        if (newC) contactId = newC.id;
      }

      if (!contactId) {
        return {
          success: false,
          message: `Não foi possível localizar o contacto '${args.recipient}' para agendar o envio.`
        };
      }

      // 2. Parse scheduled date
      let sendDate = new Date(args.scheduledAt);
      if (isNaN(sendDate.getTime()) || sendDate <= new Date()) {
        // Fallback to tomorrow same hour if invalid
        sendDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // 3. Detect media mimetype if mediaUrl present
      let mediaType: string | null = null;
      let mediaMimetype: string | null = null;
      if (args.mediaUrl) {
        mediaType = args.mediaUrl.endsWith(".pdf") ? "document" : "image";
        mediaMimetype = args.mediaUrl.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
      }

      // 4. Insert into scheduled_messages
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

      if (error) throw error;

      return {
        success: true,
        message: `Mensagem/Fatura agendada com sucesso para ${contactName} (${contactPhone}) para ${sendDate.toLocaleString("pt-PT")}.`,
        data: {
          id: scheduled.id,
          cliente: contactName,
          telefone: contactPhone,
          dataEnvio: sendDate.toISOString(),
          mensagem: args.message
        }
      };
    } catch (err: any) {
      console.error("[Tool schedule_message] Error:", err);
      return {
        success: false,
        message: "Erro ao agendar mensagem.",
        error: err.message
      };
    }
  }
};
