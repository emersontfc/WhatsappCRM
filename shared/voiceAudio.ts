export const VOICE_UPLOAD_LIMIT = 10 * 1024 * 1024;
export const WHATSAPP_VOICE_MIME = "audio/ogg; codecs=opus";

const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const ownedVoice = new RegExp(`^voice-(${uuid})-${uuid}\\.ogg$`, "i");

export function voiceUploadOwner(filename: string) {
  return ownedVoice.exec(filename)?.[1]?.toLowerCase();
}

export function ownedVoiceFilename(mediaUrl: string) {
  try {
    const url = new URL(mediaUrl, "https://agentx.invalid");
    const filename = /^\/uploads\/([^/]+)$/.exec(url.pathname)?.[1];
    return filename && voiceUploadOwner(filename) ? filename : undefined;
  } catch {
    return undefined;
  }
}

export function isAudioAttachment(mimetype: string, filename: string) {
  return mimetype.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|aiff|amr)$/i.test(filename);
}
