import React from 'react';
import { Smartphone, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface StatusPreviewProps {
  mediaUrl?: string;
  mediaType?: string;
  caption?: string;
}

export function StatusPreview({ mediaUrl, mediaType, caption }: StatusPreviewProps) {
  if (!mediaUrl) return null;

  return (
    <div className="relative mx-auto w-full max-w-[300px] aspect-[9/16] bg-black rounded-[3rem] border-[8px] border-slate-900 shadow-2xl overflow-hidden group">
      {/* Top Bar (Camera/Speaker) */}
      <div className="absolute top-0 inset-x-0 h-8 bg-slate-900 z-20 flex items-center justify-center">
        <div className="w-16 h-1 bg-slate-800 rounded-full" />
      </div>

      {/* WhatsApp Status Progress Bar */}
      <div className="absolute top-10 inset-x-4 h-1 flex gap-1 z-20">
        <div className="flex-1 bg-white/40 rounded-full overflow-hidden">
          <div className="h-full bg-white w-1/3 animate-pulse" />
        </div>
        <div className="flex-1 bg-white/20 rounded-full" />
        <div className="flex-1 bg-white/20 rounded-full" />
      </div>

      {/* Status Content */}
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900">
        {mediaType === 'image' ? (
          <img 
            src={mediaUrl} 
            alt="Status Preview" 
            className="w-full h-full object-cover"
          />
        ) : mediaType === 'video' ? (
          <video 
            src={mediaUrl} 
            className="w-full h-full object-cover"
            autoPlay 
            muted 
            loop
          />
        ) : (
          <div className="text-white text-center p-4 italic">
            Visualização não disponível para este tipo de mídia
          </div>
        )}

        {/* Caption Overlay */}
        {caption && (
          <div className="absolute bottom-16 inset-x-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
            <p className="text-white text-sm text-center line-clamp-3 leading-relaxed drop-shadow-lg">
              {caption}
            </p>
          </div>
        )}
      </div>

      {/* WhatsApp Status Bottom Bar */}
      <div className="absolute bottom-0 inset-x-0 h-12 bg-black/20 backdrop-blur-sm z-20 flex items-center justify-center">
        <div className="text-white/80 text-[10px] font-medium tracking-wider uppercase">
          Responder
        </div>
      </div>
      
      {/* Mobile Frame Decoration */}
      <div className="absolute top-1/2 -left-2 h-12 w-1 bg-slate-800 rounded-r-full" />
      <div className="absolute top-1/4 -right-2 h-16 w-1 bg-slate-800 rounded-l-full" />
    </div>
  );
}
