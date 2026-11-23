import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import { WHATSAPP_VOICE_MIME, voiceUploadOwner } from "../../shared/voiceAudio.ts";
import { AudioConversionError, convertToOpus, isOggOpus, probeAudioDuration } from "./audioConverter.ts";

const sourceLimit = 20 * 1024 * 1024;

export class VoicePreparationError extends Error {
  constructor(message = "Não foi possível preparar o áudio para envio.") {
    super(message);
  }
}

export async function prepareWhatsAppVoice(userId: string, mediaUrl: string, duration?: number) {
  let inputDirectory: string | undefined;
  let converted: string | undefined;

  try {
    const url = new URL(mediaUrl, "https://agentx.invalid");
    const filename = /^\/uploads\/([a-z0-9_.-]+)$/i.exec(url.pathname)?.[1];
    let inputPath: string;
    if (filename && filename !== "." && filename !== "..") {
      const owner = voiceUploadOwner(filename);
      if (owner && owner !== userId.toLowerCase()) throw new VoicePreparationError("Este áudio pertence a outra conta.");
      inputPath = path.join(process.cwd(), "uploads", filename);
      const source = await fs.lstat(inputPath);
      if (!source.isFile() || !source.size || source.size > sourceLimit) throw new VoicePreparationError();
    } else {
      const storage = new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://agentx.invalid");
      if (url.protocol !== "https:" || url.origin !== storage.origin || !url.pathname.startsWith("/storage/v1/object/")) {
        throw new VoicePreparationError();
      }
      const response = await axios.get<ArrayBuffer>(url.href, {
        responseType: "arraybuffer", timeout: 12000, maxContentLength: sourceLimit, maxRedirects: 0
      });
      inputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentx-audio-"));
      inputPath = path.join(inputDirectory, "source");
      await fs.writeFile(inputPath, Buffer.from(response.data));
    }

    let audio = await fs.readFile(inputPath);
    if (!isOggOpus(audio)) {
      converted = await convertToOpus(inputPath);
      audio = await fs.readFile(converted);
    }
    const clientDuration = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined;
    const seconds = await probeAudioDuration(converted ?? inputPath) ?? clientDuration;
    return { audio, mimetype: WHATSAPP_VOICE_MIME, ptt: true, seconds };
  } catch (error) {
    if (error instanceof VoicePreparationError) throw error;
    throw new VoicePreparationError(error instanceof AudioConversionError ? error.message : undefined);
  } finally {
    if (converted) await fs.rm(converted, { force: true }).catch(() => {});
    if (inputDirectory) await fs.rm(inputDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
