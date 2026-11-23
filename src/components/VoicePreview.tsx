import { useVoicePlayback } from "../lib/voiceAudio";

export function VoicePreview({ url, legacyUrl }: { url: string; legacyUrl?: string }) {
  const voice = useVoicePlayback(url, true);
  if (voice.loading) return <p role="status" className="text-sm text-slate-500">A carregar nota de voz…</p>;
  if (voice.failed) {
    return <button type="button" onClick={voice.load} className="text-sm text-rose-700 underline">
      Tentar carregar a nota de voz
    </button>;
  }
  return <audio controls preload="metadata" src={voice.url === url ? legacyUrl || url : voice.url} className="w-full max-w-sm" aria-label="Pré-visualizar nota de voz" />;
}
