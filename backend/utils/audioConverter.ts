import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@ffprobe-installer/ffprobe";
import { VOICE_UPLOAD_LIMIT } from "../../shared/voiceAudio.ts";

const run = promisify(execFile);
function audioBinary(installed: string | null | undefined, systemName: string) {
  if (installed) {
    try {
      accessSync(installed, constants.X_OK);
      return installed;
    } catch {
      // Docker installs executable system binaries even if package install scripts were skipped.
    }
  }
  return systemName;
}
const ffmpeg = audioBinary(ffmpegStatic, "ffmpeg");
const ffprobe = audioBinary(ffprobeStatic.path, "ffprobe");

export class AudioConversionError extends Error {
  constructor(readonly unavailable: boolean) {
    super(unavailable ? "O conversor de áudio está temporariamente indisponível."
      : "Não foi possível preparar uma nota de voz com este ficheiro.");
  }
}

export function isOggOpus(bytes: Buffer) {
  const headerOffset = 27 + (bytes[26] ?? 0);
  return headerOffset >= 28 && bytes.toString("ascii", 0, 4) === "OggS" &&
    bytes.toString("ascii", headerOffset, headerOffset + 8) === "OpusHead";
}

export async function probeAudioDuration(filename: string) {
  try {
    const { stdout } = await run(ffprobe, ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "ogg",
      "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filename],
    { timeout: 4000, maxBuffer: 32 * 1024 });
    const duration = Number(stdout);
    if (Number.isFinite(duration) && duration > 0) return Math.max(1, Math.round(duration));
  } catch {
    // WhatsApp can read the duration from the encoded file when the probe is unavailable.
  }
  return undefined;
}

export async function convertToOpus(inputPath: string, outputPath = path.join(os.tmpdir(), `agentx-voice-${randomUUID()}.ogg`)) {
  try {
    await run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
      "-format_whitelist", "aac,aiff,amr,asf,caf,flac,matroska,webm,mov,mp4,m4a,3gp,3g2,mj2,mp3,ogg,wav",
      "-i", inputPath, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k",
      "-application", "voip", "-fs", String(VOICE_UPLOAD_LIMIT + 1024 * 1024), "-f", "ogg", outputPath], { timeout: 22000, maxBuffer: 64 * 1024 });
    const encoded = await fs.stat(outputPath);
    if (!encoded.size || encoded.size > VOICE_UPLOAD_LIMIT) throw new AudioConversionError(false);
    return outputPath;
  } catch (error) {
    await fs.rm(outputPath, { force: true }).catch(() => {});
    const code = (error as NodeJS.ErrnoException)?.code;
    throw new AudioConversionError(code === "ENOENT" || code === "EACCES");
  }
}
