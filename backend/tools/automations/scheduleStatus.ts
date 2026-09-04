import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";

export const scheduleStatusTool: ToolDefinition = {
  name: "schedule_status",
  description: "Agenda uma postagem no Status / Stories do WhatsApp da empresa para uma data e hora futura específica.",
  category: "automations",
  allowedRoles: ["admin"],
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Texto ou legenda a ser postada no Status do WhatsApp."
      },
      scheduledAt: {
        type: "string",
        description: "Data e hora para a postagem em formato ISO (ex: '2026-09-05T18:00:00Z') ou 'YYYY-MM-DD HH:mm'."
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
      let postDate = new Date(args.scheduledAt);
      if (isNaN(postDate.getTime()) || postDate <= new Date()) {
        postDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now default
      }

      let mediaType: string | null = null;
      if (args.mediaUrl) {
        mediaType = args.mediaUrl.match(/\.(mp4|mov|avi)/i) ? "video" : "image";
      }

      const { data: statusItem, error } = await supabaseAdmin
        .from("scheduled_status")
        .insert({
          user_id: ctx.userId,
          caption: args.text.trim(),
          media_url: args.mediaUrl || null,
          media_type: mediaType,
          scheduled_at: postDate.toISOString(),
          status: "pending",
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `Postagem no Status do WhatsApp agendada com sucesso para ${postDate.toLocaleString("pt-PT")}.`,
        data: {
          id: statusItem.id,
          texto: statusItem.caption,
          dataPublicacao: postDate.toISOString(),
          temMidia: !!statusItem.media_url
        }
      };
    } catch (err: any) {
      console.error("[Tool schedule_status] Error:", err);
      return {
        success: false,
        message: "Erro ao agendar Status no WhatsApp.",
        error: err.message
      };
    }
  }
};
