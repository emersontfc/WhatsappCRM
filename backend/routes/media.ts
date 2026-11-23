import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { authenticate, type AuthRequest } from "../middleware/auth.ts";
import { AudioConversionError, convertToOpus, probeAudioDuration } from "../utils/audioConverter.ts";
import { VOICE_UPLOAD_LIMIT, WHATSAPP_VOICE_MIME, voiceUploadOwner } from "../../shared/voiceAudio.ts";

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
const uploadAudio = multer({ dest: os.tmpdir(), limits: { fileSize: VOICE_UPLOAD_LIMIT, files: 1 } }).single("audio");

router.post("/upload-audio", authenticate, (req: AuthRequest, res) => {
  uploadAudio(req, res, async (error) => {
    if (error instanceof multer.MulterError) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        success: false, error: "Ficheiro de áudio inválido. Limite de 10 MiB."
      });
    }
    if (error) {
      return res.status(500).json({ success: false, error: "Não foi possível receber o ficheiro de áudio." });
    }

    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ success: false, error: "Sessão inválida." });
      if (!req.file?.size) return res.status(400).json({ success: false, error: "Escolhe um ficheiro de áudio." });

      const filename = `voice-${userId}-${randomUUID()}.ogg`;
      const output = await convertToOpus(req.file.path, path.join(uploadsDir, filename));
      const duration = await probeAudioDuration(output);
      const url = `${req.protocol}://${req.get("host")}/uploads/${filename}`;
      return res.json({ success: true, url, filename, duration, mimetype: WHATSAPP_VOICE_MIME });
    } catch (error) {
      if (error instanceof AudioConversionError) {
        return res.status(error.unavailable ? 503 : 422).json({ success: false, error: error.message });
      }
      console.error("[Media] Voice upload failed:", error);
      return res.status(500).json({ success: false, error: "Não foi possível preparar a nota de voz." });
    } finally {
      if (req.file?.path) await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    }
  });
});

router.get("/voice/:filename", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const filename = String(req.params.filename);
  if (!userId || voiceUploadOwner(filename) !== userId.toLowerCase()) {
    return res.status(404).json({ success: false, error: "Nota de voz indisponível." });
  }

  res.type("audio/ogg");
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  return res.sendFile(filename, { root: uploadsDir, cacheControl: false });
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
