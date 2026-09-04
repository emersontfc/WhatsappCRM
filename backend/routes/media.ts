import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "@ffprobe-installer/ffprobe";
import { authenticate } from "../middleware/auth.ts";

// Configure ffmpeg & ffprobe binary paths
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
if (ffprobeStatic && ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
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
    const ext = path.extname(file.originalname) || ".webm";
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `audio-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

router.post("/upload-audio", authenticate, (req, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error("[Media] Multer error:", err);
      return res.status(400).json({ success: false, error: `Erro no upload: ${err.message}` });
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
        console.warn("[Media] FFmpeg conversion failed, falling back to original upload:", convErr.message);
        
        // Fallback: serve original uploaded audio file directly
        const fallbackFilename = path.basename(inputPath);
        const fallbackUrl = `${protocol}://${host}/uploads/${fallbackFilename}`;

        return res.json({
          success: true,
          url: fallbackUrl,
          filename: fallbackFilename,
          duration: duration || 1,
        });
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
