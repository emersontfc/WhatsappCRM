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

router.post("/upload-audio", authenticate, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Nenhum arquivo enviado" });
    }

    const inputPath = req.file.path;
    const outputFilename = `audio-${Date.now()}.ogg`;
    const outputPath = path.join(uploadsDir, outputFilename);

    console.log(`[Media] Converting ${inputPath} to ${outputPath}`);

    ffmpeg(inputPath)
      .toFormat("ogg")
      .audioCodec("libopus")
      .on("error", (err) => {
        console.error("[Media] Error during conversion:", err);
        res.status(500).json({ success: false, error: "Erro na conversão do áudio" });
      })
      .on("end", () => {
        console.log("[Media] Conversion finished");
        
        // Delete original webm file
        fs.unlink(inputPath, (err) => {
          if (err) console.error("[Media] Error deleting temp file:", err);
        });

        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.headers["x-forwarded-host"] || req.get("host");
        const audioUrl = `${protocol}://${host}/uploads/${outputFilename}`;

        res.json({ 
          success: true, 
          url: audioUrl,
          filename: outputFilename
        });
      })
      .save(outputPath);

  } catch (err: any) {
    console.error("[Media] Upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
