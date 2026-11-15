import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { parseScheduledDateTime } from "../../utils/dateTimeParser.ts";

export const scheduleStatusTool: ToolDefinition = {
  name: "schedule_status",
  description: "Agenda uma postagem no Status / Stories do WhatsApp da empresa para uma data e hora futura específica (aceita expressões como 'amanhã às 8h', 'hoje às 18h' ou formato ISO).",
  category: "automations",
  allowedRoles: ["admin"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Texto ou legenda a ser postada no Status do WhatsApp."
      },
      scheduledAt: {
        type: "string",
        description: "Data e hora para a postagem (ex: 'amanhã às 08:00', 'hoje às 18:30', '2026-11-20T08:00:00Z')."
      },
      mediaUrl: {
        type: "string",
        description: "Opcional: URL pública de imagem ou vídeo para o Status."
      }
    },
    required: ["text", "scheduledAt"]
  },
  execute: async (args: { text: string; scheduledAt: string; mediaUrl?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const text = String(args?.text || "").trim();
      if (!text && !args?.mediaUrl) {
        return {
          success: false,
          code: "INVALID_ARGUMENTS",
          message: "Texto ou mídia é obrigatório para agendar postagem no Status."
        };
      }

      // Resolve timezone
      let timezone = "Africa/Maputo";
      try {
        const { data: profile } = await supabaseAdmin
          .from("company_profile")
          .select("timezone")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (profile?.timezone) timezone = profile.timezone;
      } catch {}

      const parsedDate = parseScheduledDateTime(args.scheduledAt, new Date(), timezone);
      const postDate = parsedDate.date;

      let mediaType: string | null = null;
      if (args.mediaUrl) {
        mediaType = args.mediaUrl.match(/\.(mp4|mov|avi|webm)/i) ? "video" : "image";
      }

      const session = ctx.whatsappManager?.getSession?.(ctx.userId);
      const isConnected = session?.status === "connected";

      const { data: statusItem, error } = await supabaseAdmin
        .from("scheduled_status")
        .insert({
          user_id: ctx.userId,
          caption: text,
          media_url: args.mediaUrl || null,
          media_type: mediaType,
          scheduled_at: postDate.toISOString(),
          status: "pending",
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error("[scheduleStatusTool] DB error:", error);
        return {
          success: false,
          code: "PERSISTENCE_FAILED",
          message: `Erro ao salvar agendamento de Status: ${error.message}`
        };
      }

      const warningNotice = isConnected 
        ? "" 
        : "\n⚠️ *Nota:* A sessão WhatsApp está desconectada no momento. Lembre-se de conectar antes do horário agendado.";

      return {
        success: true,
        code: "SUCCESS",
        message: `Postagem no Status do WhatsApp agendada com sucesso para ${parsedDate.formattedLocal} (${timezone}).${warningNotice}`,
        data: {
          id: statusItem.id,
          texto: statusItem.caption,
          dataPublicacao: postDate.toISOString(),
          dataAgendada: parsedDate.formattedLocal,
          timezone,
          temMidia: !!statusItem.media_url
        }
      };
    } catch (err: any) {
      console.error("[Tool schedule_status] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: "Erro ao agendar Status no WhatsApp.",
        error: err.message
      };
    }
  }
};
