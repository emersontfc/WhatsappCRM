/**
 * WhatsApp Transport Abstraction Layer
 * Provides a standardized contract for WhatsApp providers (Baileys, Meta Cloud API, etc.)
 * allowing the CRM and AI agents to remain agnostic of the underlying WhatsApp engine.
 */

export type WhatsAppConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr_ready"
  | "connected"
  | "reconnecting"
  | "error";

export interface SendMessageOptions {
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document" | string;
  duration?: number;
  mimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
}

export interface IWhatsAppTransport {
  createSession(
    userId: string,
    onUpdate?: (status: string, data?: string) => void
  ): Promise<any>;

  getSessionStatus(userId: string): string;

  sendMessage(
    userId: string,
    jid: string,
    text: string,
    mediaUrl?: string,
    mediaType?: string,
    duration?: number,
    mimetype?: string,
    fileName?: string
  ): Promise<any>;

  requestPairingCode(userId: string, phoneNumber: string): Promise<string>;

  deleteSession(userId: string): Promise<void>;

  getMe(userId: string): any;

  sendPresenceUpdate(
    userId: string,
    jid: string,
    presence: "composing" | "recording" | "paused"
  ): Promise<void>;
}
