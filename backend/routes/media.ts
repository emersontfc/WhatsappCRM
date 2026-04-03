import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { authenticate } from "../middleware/auth";

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
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
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
      const outputFilename = `audio-${Date.now()}.ogg`;
      const outputPath = path.join(uploadsDir, outputFilename);

      console.log(`[Media] Converting ${inputPath} to ${outputPath}`);

      // Get duration first
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        const duration = metadata?.format?.duration || 0;
        
        // Convert
        ffmpeg(inputPath)
          .audioCodec("libopus")
          .audioChannels(1)
          .audioFrequency(16000)
          .toFormat("ogg")
          .on("error", (err) => {
            console.error("[Media] ffmpeg error:", err.message);
            res.status(500).json({ 
              success: false, 
              error: "Erro na conversão do áudio.",
              details: err.message
            });
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          })
          .on("end", () => {
            console.log("[Media] Conversion finished");
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

            const protocol = req.headers["x-forwarded-proto"] || req.protocol;
            const host = req.headers["x-forwarded-host"] || req.get("host");
            const audioUrl = `${protocol}://${host}/uploads/${outputFilename}`;

            res.json({ 
              success: true, 
              url: audioUrl,
              filename: outputFilename,
              duration: Math.floor(duration)
            });
          })
          .save(outputPath);
      });

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
