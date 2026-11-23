import React, { useState, useRef, useEffect } from "react";
import { Button } from "./ui/Button";
import { Mic, Square, Trash2, Send, Loader2, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { uploadVoiceAudio, type UploadedVoiceAudio } from "../lib/voiceAudio";

export type VoiceSendOutcome = "sent" | "failed" | "unconfirmed";

interface VoiceRecorderProps {
  onSend: (audioUrl: string, duration?: number, media?: UploadedVoiceAudio) => void | Promise<void | VoiceSendOutcome>;
  onCancel: () => void;
  actionLabel?: string;
}

export function VoiceRecorder({ onSend, onCancel, actionLabel = "Enviar" }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const storedRef = useRef<UploadedVoiceAudio | null>(null);
  const mountedRef = useRef(false);

  const releaseMicrophone = () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadRef.current?.abort();
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      releaseMicrophone();
    };
  }, []);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const startRecording = async () => {
    if (isStarting || mediaRecorderRef.current?.state === "recording") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("A gravação precisa de um navegador compatível e de uma ligação segura.");
      return;
    }

    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
        .find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      let startedAt = Date.now();

      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onerror = () => {
        releaseMicrophone();
        if (mountedRef.current) toast.error("A gravação foi interrompida.");
      };
      recorder.onstop = () => {
        releaseMicrophone();
        if (!mountedRef.current) return;
        setIsRecording(false);
        const recorded = new Blob(chunks, { type: chunks[0]?.type || recorder.mimeType || mimeType });
        if (!recorded.size) {
          toast.error("O microfone não captou áudio. Tenta gravar novamente.");
          return;
        }
        setRecordingTime(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        setAudioBlob(recorded);
        setPreviewUrl(URL.createObjectURL(recorded));
      };

      recorder.start(250);
      startedAt = Date.now();
      setRecordingTime(0);
      setIsRecording(true);
      timerRef.current = setInterval(() => setRecordingTime(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    } catch {
      releaseMicrophone();
      if (mountedRef.current) toast.error("Não foi possível abrir o microfone. Verifica as permissões no navegador.");
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error("Audio playback error:", err);
        setIsPlaying(false);
      });
    }
  };

  const handleSend = async () => {
    if (!audioBlob || uploadRef.current || unconfirmed) return;
    const request = new AbortController();
    uploadRef.current = request;
    setIsUploading(true);

    try {
      const media = storedRef.current ?? await uploadVoiceAudio(audioBlob, undefined, request.signal);
      storedRef.current = media;
      if (!mountedRef.current) return;
      const outcome = await onSend(media.url, media.duration ?? recordingTime, media);
      if (!mountedRef.current) return;
      if (outcome === "unconfirmed") setUnconfirmed(true);
      if (outcome === undefined && actionLabel !== "Enviar") toast.success("Áudio anexado");
    } catch (error) {
      if (mountedRef.current && !request.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Não foi possível preparar a gravação.");
      }
    } finally {
      uploadRef.current = null;
      if (mountedRef.current) setIsUploading(false);
    }
  };

  const discardRecording = () => {
    setAudioBlob(null);
    setPreviewUrl(null);
    setRecordingTime(0);
    setIsPlaying(false);
    setUnconfirmed(false);
    storedRef.current = null;
  };

  return (
    <div className="flex items-center gap-2 bg-slate-50 p-2 sm:p-2.5 rounded-2xl border border-slate-200/80 shadow-sm animate-in fade-in slide-in-from-bottom-2 w-full">
      {previewUrl && (
        <audio
          ref={audioPlayerRef}
          src={previewUrl}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}

      {!audioBlob ? (
        <>
          <div className="flex-1 flex items-center gap-2.5 px-2">
            <div className={`w-3 h-3 rounded-full bg-red-500 ${isRecording ? 'animate-ping' : ''}`} />
            <span className="text-sm font-mono font-bold text-slate-700">
              {formatTime(recordingTime)}
            </span>
            {isRecording && (
              <span className="text-xs text-red-500 font-medium ml-1 animate-pulse">Gravando voz...</span>
            )}
            {!isRecording && (
              <span className="text-xs text-slate-400">{isStarting ? "A abrir microfone…" : "Pronto para gravar"}</span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            <Button 
              type="button"
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-400 hover:text-red-500 rounded-xl"
              onClick={onCancel}
              title="Cancelar"
            >
              <Trash2 size={18} />
            </Button>
            
            {!isRecording ? (
              <Button 
                type="button"
                variant="primary" 
                size="icon" 
                className="rounded-xl h-9 w-9 bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
                onClick={startRecording}
                disabled={isStarting}
                aria-label="Iniciar gravação"
                title="Iniciar gravação"
              >
                <Mic size={18} />
              </Button>
            ) : (
              <Button 
                type="button"
                variant="primary" 
                size="icon" 
                className="rounded-xl h-9 w-9 bg-red-500 hover:bg-red-600 text-white shadow-sm"
                onClick={stopRecording}
                aria-label="Parar gravação"
                title="Parar gravação"
              >
                <Square size={18} />
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 flex items-center gap-2 px-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-emerald-600 hover:bg-emerald-50"
              onClick={togglePlayback}
              title={isPlaying ? "Pausar" : "Ouvir"}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </Button>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-700">
                Áudio Gravado
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Duração: {formatTime(recordingTime)}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5">
            <Button 
              type="button"
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-400 hover:text-red-500 rounded-xl"
              onClick={discardRecording}
              disabled={isUploading}
              title="Descartar e regravar"
            >
              <Trash2 size={18} />
            </Button>
            
            <Button 
              type="button"
              variant="primary" 
              className="bg-emerald-500 hover:bg-emerald-600 text-white h-9 px-4 rounded-xl font-medium shadow-sm gap-1.5"
              onClick={handleSend}
              disabled={isUploading || unconfirmed}
            >
              {isUploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <Send size={15} />
                  <span>{actionLabel}</span>
                </>
              )}
            </Button>
          </div>
        </>
      )}
      {unconfirmed && (
        <p role="status" className="max-w-32 text-xs text-amber-700">Verifica no WhatsApp se a nota de voz chegou.</p>
      )}
    </div>
  );
}

