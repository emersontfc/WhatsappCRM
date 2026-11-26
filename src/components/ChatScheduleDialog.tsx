import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarClock } from "lucide-react";
import { ApiError, apiFetch } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Props = {
  contactId: string;
  recipient: string;
  message: string;
  quote?: { id: string; text: string };
  onClose: () => void;
  onSaved: () => void;
};

function localMinute(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function ChatScheduleDialog({ contactId, recipient, message, quote, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submission = useRef<AbortController | null>(null);
  const request = useRef<{ date: string; id: string } | undefined>(undefined);
  const [date, setDate] = useState(() => localMinute(new Date(Date.now() + 15 * 60_000)));
  const [saving, setSaving] = useState(false);
  const [unknownSave, setUnknownSave] = useState(false);
  const [error, setError] = useState("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => submission.current?.abort();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (submission.current) return;
    const instant = new Date(date);
    if (!Number.isFinite(instant.getTime()) || localMinute(instant) !== date || instant.getTime() <= Date.now()) {
      setError("Escolhe uma data e hora futura válida neste fuso horário.");
      return;
    }
    if (request.current?.date !== date) request.current = { date, id: crypto.randomUUID() };
    const controller = new AbortController();
    submission.current = controller;
    setSaving(true);
    setError("");
    try {
      const result = await apiFetch("/api/schedule", {
        method: "POST", signal: controller.signal, timeout: 12_000,
        body: JSON.stringify({ target_type: "contact", contact_id: contactId, message,
          scheduled_at: instant.toISOString(), repeat_zone: timeZone, request_key: request.current.id,
          ...(quote ? { reply_to_message_id: quote.id } : {}) })
      });
      if (controller.signal.aborted) return;
      if (result?.success !== true || typeof result.id !== "string" || !result.id) throw new Error("Agendamento por confirmar.");
      onSaved();
    } catch (failure) {
      if (controller.signal.aborted) return;
      const rejected = failure instanceof ApiError && failure.status !== undefined && failure.status < 500;
      if (!rejected) setUnknownSave(true);
      setError(rejected ? failure.message : "A gravação ficou por confirmar. Tenta novamente com a mesma data ou consulta a Agenda.");
    } finally {
      if (submission.current === controller) submission.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="chat-schedule-title" className="m-auto w-11/12 max-w-md rounded-2xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/50"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
      <form onSubmit={save} className="space-y-4 p-5">
        <h2 id="chat-schedule-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <CalendarClock size={20} className="text-emerald-600" /> Agendar mensagem
        </h2>
        <p className="text-sm text-slate-700"><span className="font-semibold">Para</span> {recipient}</p>
        {quote && <p className="max-h-20 overflow-auto rounded-lg border-l-2 border-emerald-500 px-3 text-sm text-slate-700">
          <span className="block font-semibold">Em resposta a</span><span className="break-words">{quote.text}</span>
        </p>}
        <p className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-900">{message}</p>
        <label className="block space-y-1 text-sm font-medium text-slate-800">
          <span>Data e hora · {timeZone}</span>
          <Input type="datetime-local" value={date} required disabled={saving || unknownSave}
            onChange={(event) => { setDate(event.target.value); setError(""); }} />
        </label>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button type="submit" disabled={saving}>{saving ? "A guardar…" : unknownSave ? "Tentar novamente" : "Guardar na Agenda"}</Button>
        </div>
      </form>
    </dialog>
  );
}
