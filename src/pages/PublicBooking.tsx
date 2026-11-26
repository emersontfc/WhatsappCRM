import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { formatInTimeZone } from "date-fns-tz";
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  CheckCircle2, 
  ChevronRight, 
  ChevronLeft, 
  Sparkles, 
  Phone, 
  ShieldCheck, 
  MessageCircle,
  Briefcase,
  AlertCircle,
  Loader2
} from "lucide-react";
import { Button } from "../components/ui/Button";
import AgentXLogo from "../components/AgentXLogo";
import { apiFetch, ApiError } from "../lib/api";
import { readContactPhone } from "../../shared/contactPhone";

interface Service {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
}

interface Professional {
  id: string;
  name: string;
  role: string;
  working_days: string[];
}

type ConfirmationStatus = "sent" | "retry" | "uncertain" | "sending";

interface Reservation {
  serviceName: string;
  professionalName: string;
  date: string;
  time: string;
  timeZone: string;
  confirmation?: ConfirmationStatus;
}

const confirmationLabels: Record<ConfirmationStatus, string> = {
  sent: "A confirmação foi aceite pelo WhatsApp.",
  retry: "O aviso de confirmação aguarda envio por WhatsApp.",
  sending: "O aviso de confirmação está a ser enviado.",
  uncertain: "O envio do aviso ainda não foi confirmado pelo WhatsApp."
};

const dayInZone = (timeZone: string) => formatInTimeZone(Date.now(), timeZone, "yyyy-MM-dd");
const readZone = (timeZone: unknown, fallback: string) => {
  if (typeof timeZone !== "string" || !timeZone) return fallback;
  try { dayInZone(timeZone); return timeZone; } catch { return fallback; }
};

export default function PublicBooking() {
  const { userId } = useParams<{ userId: string }>();

  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState("Marcações");
  const [infoScope, setInfoScope] = useState<string | undefined>();
  const [infoError, setInfoError] = useState("");
  const [infoRevision, setInfoRevision] = useState(0);
  const [timeZone, setTimeZone] = useState("Africa/Maputo");
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  // Multi-step State
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProf, setSelectedProf] = useState<Professional | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => dayInZone(timeZone));
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [slotResult, setSlotResult] = useState<{ scope: string; slots: string[] } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState("");
  const [slotNotice, setSlotNotice] = useState("");
  const [slotRevision, setSlotRevision] = useState(0);

  // Patient Info
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const submittingRef = useRef(false);
  const bookingRequest = useRef<{ body: string; requestId: string } | null>(null);

  const [confirmedData, setConfirmedData] = useState<Reservation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setInfoError("");
    setStep(1);
    setSelectedService(null);
    setSelectedProf(null);
    setSelectedSlot("");
    setSlotResult(null);
    setSlotNotice("");
    setBookingError("");
    setCustomerName("");
    setCustomerPhone("");
    setNotes("");
    setConfirmedData(null);
    setSubmitting(false);
    submittingRef.current = false;
    bookingRequest.current = null;
    if (!userId) {
      setInfoScope(userId);
      setInfoError("O link de marcação está incompleto.");
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const res = await apiFetch(`/api/appointments/public/info/${encodeURIComponent(userId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res.success || !res.data) throw new Error("Não foi possível abrir o link de marcação.");
        const zone = readZone(res.data.timeZone, "Africa/Maputo");
        setBusinessName(res.data.business?.name || "Marcações");
        setServices(res.data.services || []);
        setProfessionals(res.data.professionals || []);
        setTimeZone(zone);
        setSelectedDate(dayInZone(zone));
      } catch (error) {
        if (!controller.signal.aborted) setInfoError(error instanceof Error ? error.message : "Não foi possível abrir o link de marcação.");
      } finally {
        if (!controller.signal.aborted) {
          setInfoScope(userId);
          setLoading(false);
        }
      }
    })();
    return () => {
      controller.abort();
      submittingRef.current = false;
      bookingRequest.current = null;
    };
  }, [userId, infoRevision]);

  const slotScope = userId && selectedDate && selectedService ? new URLSearchParams({
    userId,
    date: selectedDate,
    serviceId: selectedService.id,
    ...(selectedProf && { professionalId: selectedProf.id })
  }).toString() : null;
  const slots = slotResult && slotResult.scope === slotScope ? slotResult.slots : [];
  const hasCurrentSlot = Boolean(selectedSlot && slots.includes(selectedSlot));
  const chooseSlotAgain = () => {
    setSelectedSlot("");
    setSlotResult(null);
    setStep(3);
  };

  useEffect(() => {
    if (step !== 3 || !slotScope) return;
    const controller = new AbortController();
    setLoadingSlots(true);
    setSelectedSlot("");
    setSlotResult(null);
    setSlotError("");
    void (async () => {
      try {
        const res = await apiFetch(`/api/appointments/public/slots?${slotScope}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res.success || !Array.isArray(res.slots)) throw new Error("Não foi possível consultar horários.");
        setTimeZone((current) => readZone(res.timeZone, current));
        setSlotResult({ scope: slotScope, slots: res.slots });
      } catch (error) {
        if (!controller.signal.aborted) setSlotError(error instanceof Error ? error.message : "Não foi possível consultar horários.");
      } finally {
        if (!controller.signal.aborted) setLoadingSlots(false);
      }
    })();
    return () => controller.abort();
  }, [slotScope, step, slotRevision]);

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || !hasCurrentSlot || !selectedService) return;
    const phone = readContactPhone(customerPhone);
    if (!customerName.trim() || !phone) {
      setBookingError("Indica o teu nome e um número de WhatsApp válido.");
      return;
    }

    const payload = {
      userId,
      serviceId: selectedService.id,
      professionalId: selectedProf?.id,
      customerName: customerName.trim(),
      customerPhone: phone,
      appointmentDate: selectedDate,
      startTime: selectedSlot,
      notes: notes.trim()
    };
    const body = JSON.stringify(payload);
    if (bookingRequest.current?.body !== body) bookingRequest.current = { body, requestId: crypto.randomUUID() };
    const attempt = bookingRequest.current;
    submittingRef.current = true;
    setSubmitting(true);
    setBookingError("");
    try {
      const res = await apiFetch("/api/appointments/public/book", {
        method: "POST",
        body: JSON.stringify({ ...payload, requestId: attempt.requestId })
      });
      if (bookingRequest.current !== attempt) return;
      if (!res.success || !res.data?.id) throw new Error("Não foi possível confirmar a marcação.");
      setConfirmedData({
        serviceName: res.data.services?.name || selectedService.name,
        professionalName: res.data.professionals?.name || selectedProf?.name || "Equipa",
        date: res.data.appointment_date || selectedDate,
        time: (res.data.start_time || selectedSlot).slice(0, 5),
        timeZone: res.data.time_zone || timeZone,
        confirmation: res.confirmation
      });
      setStep(5);
    } catch (error) {
      if (bookingRequest.current !== attempt) return;
      if (error instanceof ApiError && error.status === 409) {
        setSlotNotice("Este horário já não está disponível. Escolhe outro horário para continuar.");
        chooseSlotAgain();
      } else {
        setBookingError(error instanceof Error ? error.message : "Não foi possível confirmar a marcação. Tenta novamente com os mesmos dados.");
      }
    } finally {
      if (bookingRequest.current === attempt) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  if (loading || infoScope !== userId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-xs font-semibold text-slate-500">Carregando horários disponíveis...</p>
        </div>
      </div>
    );
  }

  if (infoError) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-bold">Link de marcação indisponível</h1>
          <p role="alert" className="text-sm text-slate-600">{infoError}</p>
          {userId && <Button onClick={() => setInfoRevision((revision) => revision + 1)}>Tentar novamente</Button>}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-emerald-500 selection:text-white">
      {/* Background Ambience */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-emerald-500/10 blur-[140px] rounded-full" />
      </div>

      {/* Public Header */}
      <header className="relative z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/80 sticky top-0 py-3.5 px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-sm shadow-md">
            {businessName.charAt(0)}
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 leading-tight flex items-center gap-1.5">
              {businessName}
              <ShieldCheck size={14} className="text-emerald-500" />
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">Agendamento Oficial Online</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
          <Sparkles size={12} /> Auto-Agendamento
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-xl w-full mx-auto p-4 sm:p-6 my-auto">
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          
          {/* Progress Indicator (Steps 1 to 4) */}
          {step < 5 && (
            <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-100">
              <div className="flex items-center justify-between text-xs font-bold text-slate-400 mb-2">
                <span className={step >= 1 ? "text-emerald-600" : ""}>1. Serviço</span>
                <span>•</span>
                <span className={step >= 2 ? "text-emerald-600" : ""}>2. Profissional</span>
                <span>•</span>
                <span className={step >= 3 ? "text-emerald-600" : ""}>3. Data & Hora</span>
                <span>•</span>
                <span className={step >= 4 ? "text-emerald-600" : ""}>4. Seus Dados</span>
              </div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(step / 4) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* STEP 1: SELECT SERVICE */}
          {step === 1 && (
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-black text-slate-900">Escolha o Serviço / Procedimento</h2>
                <p className="text-xs text-slate-500">Selecione o atendimento que você deseja agendar.</p>
              </div>

              <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                {services.length > 0 ? (
                  services.map((s) => {
                    const isSelected = selectedService?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedService(s)}
                        className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 text-left ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                            : "border-slate-100 bg-white hover:border-slate-300"
                        }`}
                      >
                        <span className="min-w-0 space-y-1">
                          <span className="block font-bold text-sm text-slate-900">{s.name}</span>
                          {s.description && (
                            <span className="text-xs text-slate-500 line-clamp-1">{s.description}</span>
                          )}
                          <span className="flex items-center gap-3 text-xs text-slate-500 pt-1">
                            <span className="flex items-center gap-1 font-medium text-emerald-700">
                              <Clock size={12} /> {s.duration_minutes} min
                            </span>
                            <span className="font-bold text-slate-800">
                              {s.price > 0 ? `${s.price} MT` : "Consulte valor"}
                            </span>
                          </span>
                        </span>

                        <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                        }`}>
                          {isSelected && <CheckCircle2 size={14} />}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    Nenhum serviço cadastrado no momento.
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  disabled={!selectedService}
                  onClick={() => setStep(2)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl px-6 gap-2 w-full sm:w-auto shadow-md"
                >
                  Continuar <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: SELECT PROFESSIONAL */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-black text-slate-900">Selecione o Profissional</h2>
                <p className="text-xs text-slate-500">Escolha com quem prefere ser atendido(a).</p>
              </div>

              <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                <button
                  type="button"
                  aria-pressed={selectedProf === null}
                  onClick={() => setSelectedProf(null)}
                  className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 text-left ${
                    selectedProf === null
                      ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                      : "border-slate-100 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs">
                      ✨
                    </span>
                    <span>
                      <span className="block font-bold text-sm text-slate-900">Sem preferência</span>
                      <span className="block text-xs text-slate-500">Consultar a agenda geral da empresa.</span>
                    </span>
                  </span>
                  <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    selectedProf === null ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                  }`}>
                    {selectedProf === null && <CheckCircle2 size={14} />}
                  </span>
                </button>

                {professionals.map((p) => {
                  const isSelected = selectedProf?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedProf(p)}
                      className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 text-left ${
                        isSelected
                          ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                          : "border-slate-100 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                          {p.name.charAt(0)}
                        </span>
                        <span>
                          <span className="block font-bold text-sm text-slate-900">{p.name}</span>
                          <span className="block text-xs text-emerald-700 font-medium">{p.role || "Especialista"}</span>
                        </span>
                      </span>

                      <span className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                      }`}>
                        {isSelected && <CheckCircle2 size={14} />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="rounded-2xl gap-1">
                  <ChevronLeft size={16} /> Voltar
                </Button>
                <Button
                  onClick={() => { setSlotNotice(""); chooseSlotAgain(); }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl px-6 gap-2 shadow-md"
                >
                  Continuar <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: SELECT DATE & TIME SLOT */}
          {step === 3 && (
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-black text-slate-900">Escolha a Data e Horário</h2>
                <p className="text-xs text-slate-500">Fuso horário {timeZone}</p>
              </div>

              {/* Date Input */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <label htmlFor="booking-date" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Selecione o Dia
                </label>
                <input
                  type="date"
                  id="booking-date"
                  min={dayInZone(timeZone)}
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setSlotResult(null);
                    setSelectedSlot("");
                    setSlotNotice("");
                    setSlotError("");
                  }}
                  className="w-full bg-white p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              {/* Slots Grid */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Horários Livres
                </label>

                {slotNotice && <p role="status" className="text-xs font-semibold text-amber-700">{slotNotice}</p>}
                {!selectedDate ? (
                  <p className="text-xs text-slate-600">Escolhe um dia para consultar os horários.</p>
                ) : slotError ? (
                  <div className="space-y-2" role="alert">
                    <p className="text-xs font-semibold text-red-700">{slotError}</p>
                    <Button type="button" variant="outline" onClick={() => setSlotRevision((value) => value + 1)}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : loadingSlots ? (
                  <div role="status" className="py-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                    <Loader2 className="animate-spin h-4 w-4 text-emerald-600" />
                    Buscando vagas disponíveis...
                  </div>
                ) : slots.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                    {slots.map((slot) => {
                      const isSelected = selectedSlot === slot;
                      return (
                        <button
                          type="button"
                          key={slot}
                          aria-pressed={isSelected}
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-2.5 px-2 rounded-xl text-xs font-mono font-bold border transition-all ${
                            isSelected
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-md scale-105"
                              : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50"
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs space-y-1">
                    <AlertCircle size={20} className="mx-auto text-amber-500" />
                    <p className="font-semibold text-slate-700">Nenhum horário livre nesta data.</p>
                    <p className="text-[11px]">Por favor, selecione outro dia no calendário acima.</p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(2)} className="rounded-2xl gap-1">
                  <ChevronLeft size={16} /> Voltar
                </Button>
                <Button
                  disabled={loadingSlots || !hasCurrentSlot}
                  onClick={() => setStep(4)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl px-6 gap-2 shadow-md"
                >
                  Continuar <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: PATIENT CONTACT INFO & CONFIRMATION */}
          {step === 4 && (
            <form onSubmit={handleConfirmBooking} className="p-6 space-y-4">
              <div className="space-y-1">
                <h2 className="text-lg font-black text-slate-900">Seus Dados de Contato</h2>
                <p className="text-xs text-slate-500">Para enviarmos a confirmação e lembretes no seu WhatsApp.</p>
              </div>

              {/* Summary Card */}
              <div className="bg-emerald-50/60 border border-emerald-100 p-3.5 rounded-2xl space-y-1 text-xs text-emerald-950 font-medium">
                <div className="flex justify-between">
                  <span className="text-emerald-700">Serviço:</span>
                  <span className="font-bold">{selectedService?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-700">Profissional:</span>
                  <span className="font-bold">{selectedProf?.name || "Equipa"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-700">Data e Hora:</span>
                  <span className="font-bold">{selectedDate} às {selectedSlot}</span>
                </div>
              </div>

              <fieldset disabled={submitting} className="space-y-3 text-xs font-semibold text-slate-700">
                <div>
                  <label htmlFor="booking-name" className="block mb-1">Nome completo *</label>
                  <input
                    type="text"
                    id="booking-name"
                    autoComplete="name"
                    required
                    maxLength={150}
                    placeholder="Ex: Emerson Silva"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="booking-phone" className="block mb-1">Número de WhatsApp *</label>
                  <input
                    type="tel"
                    id="booking-phone"
                    autoComplete="tel"
                    required
                    placeholder="Ex: 848858288 ou +258..."
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="booking-notes" className="block mb-1">Observações de horário (opcional)</label>
                  <textarea
                    rows={2}
                    id="booking-notes"
                    placeholder="Ex.: Prefiro ser atendido de manhã."
                    value={notes}
                    maxLength={500}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </fieldset>

              {bookingError && <p role="alert" className="text-xs font-semibold text-red-700">{bookingError}</p>}
              <div className="pt-2 flex justify-between gap-2">
                <Button type="button" variant="ghost" disabled={submitting} onClick={chooseSlotAgain} className="rounded-2xl gap-1">
                  <ChevronLeft size={16} /> Voltar
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || !hasCurrentSlot}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl px-6 gap-2 shadow-lg"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Agendando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Confirmar Agendamento</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}

          {/* STEP 5: SUCCESS CONFIRMATION */}
          {step === 5 && confirmedData && (
            <div className="p-8 space-y-6 text-center">
              <div className="h-20 w-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner animate-bounce">
                <CheckCircle2 size={40} />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">Marcação guardada</h2>
                <p className="text-xs sm:text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
                  {(confirmedData.confirmation && confirmationLabels[confirmedData.confirmation]) || "Guarde os detalhes da marcação abaixo."}
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl text-left space-y-2 text-xs text-slate-700">
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Nome</span>
                  <span className="font-bold text-slate-900">{customerName}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Serviço:</span>
                  <span className="font-bold text-slate-900">{confirmedData.serviceName}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Profissional:</span>
                  <span className="font-bold text-slate-900">{confirmedData.professionalName}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Data:</span>
                  <span className="font-bold text-slate-900">{confirmedData.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Horário:</span>
                  <span className="font-bold text-emerald-600 text-sm">{confirmedData.time} ({confirmedData.timeZone})</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <Button
                  onClick={() => {
                    bookingRequest.current = null;
                    setConfirmedData(null);
                    setSelectedService(null);
                    setSelectedProf(null);
                    setSelectedDate(dayInZone(timeZone));
                    setSlotResult(null);
                    setSelectedSlot("");
                    setCustomerName("");
                    setCustomerPhone("");
                    setNotes("");
                    setStep(1);
                  }}
                  variant="outline"
                  className="w-full rounded-2xl text-xs font-bold"
                >
                  Fazer Outro Agendamento
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-6 flex justify-center">
          <AgentXLogo size="sm" />
        </footer>
      </main>
    </div>
  );
}
