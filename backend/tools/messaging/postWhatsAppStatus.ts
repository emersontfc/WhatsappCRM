import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const postWhatsAppStatusTool: ToolDefinition = {
  name: "post_whatsapp_status",
  description: "Publica IMEDIATAMENTE um texto, imagem ou vídeo no Status / Stories do WhatsApp da empresa conectada.",
  category: "messaging",
  allowedRoles: ["admin"],
  riskLevel: "medium",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Texto ou legenda da postagem a ser exibida no Status."
      },
      mediaUrl: {
        type: "string",
        description: "Opcional: URL pública de imagem ou vídeo para publicar no Status."
      },
      mediaType: {
        type: "string",
        description: "Opcional: 'image' ou 'video' quando mediaUrl for fornecida.",
        enum: ["image", "video"]
      }
    },
    required: ["text"]
  },
  execute: async (args: { text: string; mediaUrl?: string; mediaType?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const text = String(args?.text || "").trim();
      const mediaUrl = args?.mediaUrl?.trim();
      let mediaType = args?.mediaType;

      if (!text && !mediaUrl) {
        return {
          success: false,
          code: "INVALID_ARGUMENTS",
          message: "É necessário fornecer um texto ou uma imagem/vídeo para publicar no Status."
        };
      }

      // Check session status
      const session = ctx.whatsappManager?.getSession?.(ctx.userId);
      if (!session || session.status !== "connected") {
        return {
          success: false,
          code: "SESSION_NOT_CONNECTED",
          message: "A sua sessão WhatsApp está desconectada. Conecte o aparelho no menu Conexão antes de publicar no Status.",
          retryable: true
        };
      }

      if (mediaUrl && !mediaType) {
        mediaType = mediaUrl.match(/\.(mp4|mov|avi|webm)/i) ? "video" : "image";
      }

      console.log(`[postWhatsAppStatusTool] Posting status for user ${ctx.userId}: "${text.slice(0, 50)}..."`);
      
      const result = await ctx.whatsappManager.sendMessage(
        ctx.userId,
        "status@broadcast",
        text,
        mediaUrl,
        mediaType
      );

      const msgId = result?.key?.id;
      if (!msgId) throw new Error("O WhatsApp não confirmou a publicação.");

      // Log operation
      try {
        await supabaseAdmin.from("logs").insert({
          user_id: ctx.userId,
          level: "info",
          source: "backend",
          category: "whatsapp",
          message: `Status publicado com sucesso no WhatsApp: "${text.slice(0, 60)}"`,
          details: { messageId: msgId, hasMedia: !!mediaUrl, mediaType }
        });
      } catch {}

      return {
        success: true,
        code: "SUCCESS",
        message: `Status publicado com sucesso no WhatsApp da empresa!`,
        data: {
          id: msgId,
          texto: text,
          temMidia: !!mediaUrl,
          mediaType: mediaType || "text",
          publicadoEm: new Date().toISOString()
        }
      };
    } catch (err: any) {
      console.error("[postWhatsAppStatusTool] Error:", err);
      return {
        success: false,
        code: "EXECUTION_FAILED",
        message: `Falha ao publicar Status no WhatsApp: ${err.message}`,
        error: err.message
      };
    }
  }
};
