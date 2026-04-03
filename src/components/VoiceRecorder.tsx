import React, { useState, useRef, useEffect } from "react";
import { Button } from "./ui/Button";
import { Mic, Square, Trash2, Send, Loader2 } from "lucide-react";
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
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        console.log("Recording stopped, blob size:", blob.size);
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast.error("Erro ao acessar o microfone. Verifique as permissões.");
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

  const handleSend = async () => {
    if (!audioBlob) return;
    
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const result = await apiFetch("/api/media/upload-audio", {
        method: "POST",
        body: formData
      });

      if (result.success) {
        onSend(result.url, result.duration);
        toast.success("Áudio enviado com sucesso!");
      } else {
        throw new Error(result.error || "Erro ao fazer upload do áudio");
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
    setAudioBlob(null);
    onCancel();
  };

  return (
    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 animate-in fade-in slide-in-from-bottom-2">
      {!audioBlob ? (
        <>
          <div className="flex-1 flex items-center gap-2 px-2">
            <div className={`w-2 h-2 rounded-full bg-red-500 ${isRecording ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-mono font-medium text-slate-600">
              {formatTime(recordingTime)}
            </span>
            {isRecording && (
              <span className="text-xs text-slate-400 italic ml-2">Gravando...</span>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-slate-400 hover:text-red-500"
              onClick={handleCancel}
            >
              <Trash2 size={18} />
            </Button>
            
            {!isRecording ? (
              <Button 
                variant="primary" 
                size="icon" 
                className="rounded-full h-10 w-10 bg-emerald-500 hover:bg-emerald-600"
                onClick={startRecording}
              >
                <Mic size={20} />
              </Button>
            ) : (
              <Button 
                variant="primary" 
                size="icon" 
                className="rounded-full h-10 w-10 bg-red-500 hover:bg-red-600"
                onClick={stopRecording}
              >
                <Square size={20} />
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 flex items-center gap-2 px-2">
            <Mic size={16} className="text-emerald-500" />
            <span className="text-sm font-medium text-slate-600">
              Áudio gravado ({formatTime(recordingTime)})
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-slate-400 hover:text-red-500"
              onClick={() => setAudioBlob(null)}
              disabled={isUploading}
            >
              <Trash2 size={18} />
            </Button>
            
            <Button 
              variant="primary" 
              className="bg-emerald-500 hover:bg-emerald-600 h-9 px-4"
              onClick={handleSend}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send size={16} className="mr-2" />
                  Enviar
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
