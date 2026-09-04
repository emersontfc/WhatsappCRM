import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@ffprobe-installer/ffprobe";
import path from "path";
import fs from "fs";
import os from "os";

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
if (ffprobeStatic && ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

/**
 * Converts any audio file to OGG/Opus format for WhatsApp PTT
 * @param inputPath Path to the input audio file
 * @returns Path to the converted OGG file
 */
export async function convertToOpus(inputPath: string): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `audio_${Date.now()}_${Math.round(Math.random() * 1e6)}.ogg`);
  
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec("libopus")
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat("ogg")
      .on("error", (err) => {
        console.error("[AudioConverter] Error during conversion:", err);
        reject(err);
      })
      .on("end", () => {
        console.log("[AudioConverter] Conversion finished:", outputPath);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

/**
 * Ensures the audio is in a format WhatsApp likes for PTT
 * If it's already OGG/Opus, it might still be worth re-encoding to be sure
 */
export async function prepareAudioForWhatsApp(inputPath: string): Promise<string> {
  try {
    return await convertToOpus(inputPath);
  } catch (err) {
    console.error("[AudioConverter] Failed to prepare audio, falling back to original:", err);
    return inputPath;
  }
}

