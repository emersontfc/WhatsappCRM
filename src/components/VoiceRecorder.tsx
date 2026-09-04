import React, { useState, useRef, useEffect } from "react";
import { Button } from "./ui/Button";
import { Mic, Square, Trash2, Send, Loader2, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";

interface VoiceRecorderProps {
  onSend: (audioUrl: string, duration?: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const startRecording = async () => {
    try {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setAudioBlob(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Select supported mimeType
      let mimeType = "";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const actualType = mediaRecorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: actualType });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);

        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.start(200); // 200ms timeslices for reliable chunk collection
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      toast.error("Erro ao acessar o microfone. Verifique as permissões no navegador.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
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
    if (!audioBlob) return;
    
    setIsUploading(true);
    try {
      const ext = audioBlob.type.includes("ogg") ? "ogg" : audioBlob.type.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("audio", audioBlob, `recording.${ext}`);

      const result = await apiFetch("/api/media/upload-audio", {
        method: "POST",
        body: formData
      });

      if (result.success && result.url) {
        const dur = result.duration || (recordingTime > 0 ? recordingTime : 1);
        onSend(result.url, dur);
        toast.success("Áudio enviado!");
      } else {
        throw new Error(result.error || "Erro ao processar áudio");
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(err.message || "Erro ao enviar áudio");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      stopRecording();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setAudioBlob(null);
    setPreviewUrl(null);
    onCancel();
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
              <span className="text-xs text-slate-400">Pronto para gravar</span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            <Button 
              type="button"
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-400 hover:text-red-500 rounded-xl"
              onClick={handleCancel}
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
              onClick={() => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
                setAudioBlob(null);
                setRecordingTime(0);
              }}
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
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <>
                  <Send size={15} />
                  <span>Enviar</span>
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

