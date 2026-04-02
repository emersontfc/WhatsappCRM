import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Pause, Trash2, RefreshCw, Check } from 'lucide-react';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';
import { supabase, getUserId } from '../supabase';
import { toast } from 'sonner';

interface AudioRecorderProps {
  onUploadComplete: (url: string) => void;
  onCancel: () => void;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onUploadComplete, onCancel }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // WhatsApp prefers ogg/opus
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus') 
        ? 'audio/ogg; codecs=opus' 
        : 'audio/webm';
        
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      console.error('Error accessing microphone:', err);
      toast.error('Não foi possível acessar o microfone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleUpload = async () => {
    if (!audioBlob) return;
    
    setIsUploading(true);
    try {
      const userId = await getUserId();
      if (!userId) throw new Error("Usuário não identificado.");

      const fileName = `audio_${Date.now()}.${audioBlob.type.includes('ogg') ? 'ogg' : 'webm'}`;
      const filePath = `${userId}/${fileName}`;
      
      const { data, error } = await supabase.storage
        .from('media')
        .upload(filePath, audioBlob);
        
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);
        
      onUploadComplete(publicUrl);
      toast.success('Áudio gravado com sucesso!');
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Erro ao enviar áudio.');
    } finally {
      setIsUploading(false);
    }
  };

  const resetRecording = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingTime(0);
    setIsPlaying(false);
  };

  return (
    <div className="p-4 border border-emerald-100 bg-emerald-50/30 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-3 h-3 rounded-full",
            isRecording ? "bg-red-500 animate-pulse" : "bg-slate-300"
          )} />
          <span className="text-sm font-mono font-bold text-slate-700">
            {formatTime(recordingTime)}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {!audioBlob ? (
            !isRecording ? (
              <Button 
                onClick={startRecording}
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl gap-2"
              >
                <Mic size={18} />
                Gravar
              </Button>
            ) : (
              <Button 
                onClick={stopRecording}
                variant="danger"
                className="rounded-xl gap-2"
              >
                <Square size={18} />
                Parar
              </Button>
            )
          ) : (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon" 
                onClick={handlePlayPause}
                className="rounded-xl border-emerald-200 text-emerald-600"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={resetRecording}
                className="rounded-xl text-slate-400 hover:text-red-500"
              >
                <Trash2 size={18} />
              </Button>
              <Button 
                onClick={handleUpload}
                disabled={isUploading}
                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl gap-2"
              >
                {isUploading ? <RefreshCw size={18} className="animate-spin" /> : <Check size={18} />}
                {isUploading ? "Enviando..." : "Usar Áudio"}
              </Button>
            </div>
          )}
        </div>
      </div>
      
      {audioUrl && (
        <audio 
          ref={audioRef} 
          src={audioUrl} 
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
      
      <p className="text-[10px] text-slate-400 text-center italic">
        {isRecording ? "Gravando áudio..." : audioBlob ? "Gravação concluída. Ouça ou envie." : "Clique em gravar para iniciar."}
      </p>
    </div>
  );
};
