import { supabaseAdmin } from "../supabaseAdmin";

export async function sendWhatsAppMessage(sock: any, jid: string, messageData: {
  text?: string;
  audio_url?: string;
  response_type?: 'text' | 'audio';
}) {
  if (messageData.response_type === 'audio' && messageData.audio_url) {
    await sock.sendMessage(jid, {
      audio: { url: messageData.audio_url },
      mimetype: "audio/ogg",
      ptt: true
    });
  } else if (messageData.text) {
    await sock.sendMessage(jid, { text: messageData.text });
  }
}
