import { useEffect, useState } from "react";
import { VOICE_UPLOAD_LIMIT, WHATSAPP_VOICE_MIME, ownedVoiceFilename } from "../../shared/voiceAudio";
import { apiFetch } from "./api";

export interface UploadedVoiceAudio {
  url: string;
  filename: string;
  mimetype: string;
  duration?: number;
}

export async function uploadVoiceAudio(blob: Blob, filename?: string, signal?: AbortSignal): Promise<UploadedVoiceAudio> {
  if (!blob.size || blob.size > VOICE_UPLOAD_LIMIT) throw new Error("O áudio deve ter até 10 MiB e não pode estar vazio.");
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
  const body = new FormData();
  body.append("audio", blob, filename || `recording.${ext}`);
  const result = await apiFetch("/api/media/upload-audio", { method: "POST", body, signal, timeout: 40000 });
  if (result?.success !== true || typeof result.url !== "string") throw new Error("Não foi possível preparar o áudio.");
  return { url: result.url, filename: result.filename || "nota-de-voz.ogg",
    mimetype: result.mimetype || WHATSAPP_VOICE_MIME, duration: result.duration };
}


export function useVoicePlayback(mediaUrl: string, autoLoad = false) {
  const filename = ownedVoiceFilename(mediaUrl);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ filename: string; request: number; url?: string; failed?: boolean }>();
  const active = result && result.filename === filename && result.request === request ? result : undefined;
  const shouldLoad = Boolean(filename) && (autoLoad || request > 0);

  useEffect(() => {
    if (!filename || !shouldLoad) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void apiFetch("/api/media/voice/" + filename, { responseType: "blob", signal: controller.signal })
      .then((audio: Blob) => {
        if (controller.signal.aborted) return;
        if (!audio.type.startsWith("audio/") || !audio.size) throw new Error("Áudio inválido.");
        objectUrl = URL.createObjectURL(audio);
        setResult({ filename, request, url: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ filename, request, failed: true });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filename, request, shouldLoad]);

  return {
    url: filename ? active?.url : mediaUrl,
    loading: shouldLoad && !active,
    failed: active?.failed ?? false,
    load: () => setRequest(previous => previous + 1)
  };
}
