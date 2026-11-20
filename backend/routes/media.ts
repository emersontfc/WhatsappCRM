import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@ffprobe-installer/ffprobe";
import { authenticate } from "../middleware/auth.ts";

// Configure ffmpeg & ffprobe binary paths with safe fallback for Linux VPS environments
if (ffmpegStatic && typeof ffmpegStatic === "string" && fs.existsSync(ffmpegStatic)) {
  try {
    ffmpeg.setFfmpegPath(ffmpegStatic);
  } catch (e) {
    console.warn("[Media] Using system ffmpeg fallback:", e);
  }
}
if (ffprobeStatic && ffprobeStatic.path && fs.existsSync(ffprobeStatic.path)) {
  try {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  } catch (e) {
    console.warn("[Media] Using system ffprobe fallback:", e);
  }
}

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const prefix = file.mimetype?.startsWith("audio") ? "audio" : file.mimetype?.startsWith("image") ? "img" : file.mimetype?.startsWith("video") ? "vid" : "doc";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${prefix}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });
const uploadAudio = multer({ storage, limits: { fileSize: 10 * 1024 * 1024, files: 1 } }).single("audio");

router.post("/upload-audio", authenticate, (req, res) => {
  uploadAudio(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error("[Media] Multer error:", err);
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, error: "Ficheiro de áudio inválido. Limite de 10 MiB." });
    } else if (err) {
      console.error("[Media] Unknown upload error:", err);
      return res.status(500).json({ success: false, error: "Erro interno no upload" });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "Nenhum arquivo enviado" });
      }

      const inputPath = req.file.path;
      const outputFilename = `voice-${Date.now()}-${Math.round(Math.random() * 1e6)}.ogg`;
      const outputPath = path.join(uploadsDir, outputFilename);

      const protocol = req.headers["x-forwarded-proto"] || req.protocol;
      const host = req.headers["x-forwarded-host"] || req.get("host");

      // Probe duration safely
      let duration = 0;
      try {
        await new Promise<void>((resolve) => {
          ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (!err && metadata?.format?.duration) {
              duration = Math.round(metadata.format.duration);
            }
            resolve();
          });
        });
      } catch (probeErr) {
        console.warn("[Media] ffprobe warning:", probeErr);
      }

      // Convert to WhatsApp OGG Opus format
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .audioCodec("libopus")
            .audioChannels(1)
            .audioFrequency(16000)
            .toFormat("ogg")
            .on("error", (convErr) => {
              reject(convErr);
            })
            .on("end", () => {
              resolve();
            })
            .save(outputPath);
        });

        // Clean up input file if different from output
        if (fs.existsSync(inputPath) && inputPath !== outputPath) {
          try { fs.unlinkSync(inputPath); } catch (_) {}
        }

        const audioUrl = `${protocol}://${host}/uploads/${outputFilename}`;
        console.log(`[Media] Converted audio successfully: ${audioUrl}, duration: ${duration}s`);

        return res.json({
          success: true,
          url: audioUrl,
          filename: outputFilename,
          duration: duration || 1,
        });
      } catch (convErr: any) {
        console.warn("[Media] FFmpeg conversion failed:", convErr.message);
        await Promise.allSettled([fs.promises.rm(inputPath, { force: true }), fs.promises.rm(outputPath, { force: true })]);
        return res.status(422).json({ success: false, error: "Não foi possível converter o ficheiro numa nota de voz." });
      }

    } catch (err: any) {
      console.error("[Media] General error:", err);
      res.status(500).json({ success: false, error: err.message || "Erro interno no processamento de mídia" });
    }
  });
});

router.post("/upload", authenticate, upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Nenhum arquivo enviado" });
    }

    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  } catch (err: any) {
    console.error("[Media] General upload error:", err);
    res.status(500).json({ success: false, error: err.message || "Erro interno no upload" });
  }
});

export default router;
