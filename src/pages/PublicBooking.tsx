import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
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
import { Badge } from "../components/ui/Badge";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";

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

export default function PublicBooking() {
  const { userId } = useParams<{ userId: string }>();

  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState("Consultório / Clínica");
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  // Multi-step State
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProf, setSelectedProf] = useState<Professional | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Patient Info
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Confirmed Appointment
  const [confirmedData, setConfirmedData] = useState<any>(null);

  useEffect(() => {
    if (userId) loadInfo();
  }, [userId]);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/appointments/public/info/${userId}`);
      if (res.success && res.data) {
        setBusinessName(res.data.business?.name || "Clínica & Consultório");
        setServices(res.data.services || []);
        setProfessionals(res.data.professionals || []);
      }
    } catch (err: any) {
      console.error("Error loading booking info:", err);
      toast.error("Não foi possível carregar as informações deste estabelecimento.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch slots whenever date, professional or service changes
  useEffect(() => {
    if (userId && selectedDate && step === 3) {
      loadSlots();
    }
  }, [userId, selectedDate, selectedProf, selectedService, step]);

  const loadSlots = async () => {
    setLoadingSlots(true);
    setSelectedSlot("");
    try {
      const params = new URLSearchParams({
        userId: userId || "",
        date: selectedDate,
        ...(selectedService && { serviceId: selectedService.id }),
        ...(selectedProf && { professionalId: selectedProf.id })
      });

      const res = await apiFetch(`/api/appointments/public/slots?${params.toString()}`);
      if (res.success) {
        setSlots(res.slots || []);
      }
    } catch (err: any) {
      console.error("Error loading slots:", err);
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Submit Booking
  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerPhone.trim()) {
      return toast.error("Informe seu nome e WhatsApp para contato.");
    }

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/appointments/public/book", {
        method: "POST",
        body: JSON.stringify({
          userId,
          serviceId: selectedService?.id,
          professionalId: selectedProf?.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          appointmentDate: selectedDate,
          startTime: selectedSlot,
          notes: notes.trim()
        })
      });

      if (res.success) {
        setConfirmedData(res.data);
        setStep(5); // Success step
        toast.success("Agendamento confirmado com sucesso!");
      } else {
        throw new Error(res.error || "Erro ao agendar consulta");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao finalizar agendamento.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-xs font-semibold text-slate-500">Carregando horários disponíveis...</p>
        </div>
      </div>
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
                      <div
                        key={s.id}
                        onClick={() => setSelectedService(s)}
                        className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                            : "border-slate-100 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="space-y-1">
                          <h3 className="font-bold text-sm text-slate-900">{s.name}</h3>
                          {s.description && (
                            <p className="text-xs text-slate-500 line-clamp-1">{s.description}</p>
                          )}
                          <div className="flex items-center gap-3 text-xs text-slate-500 pt-1">
                            <span className="flex items-center gap-1 font-medium text-emerald-700">
                              <Clock size={12} /> {s.duration_minutes} min
                            </span>
                            <span className="font-bold text-slate-800">
                              {s.price > 0 ? `${s.price} MT` : "Consulte valor"}
                            </span>
                          </div>
                        </div>

                        <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                        }`}>
                          {isSelected && <CheckCircle2 size={14} />}
                        </div>
                      </div>
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
                {/* Option: Any available */}
                <div
                  onClick={() => setSelectedProf(null)}
                  className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    selectedProf === null
                      ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                      : "border-slate-100 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs">
                      ✨
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">Qualquer Profissional Disponível</h3>
                      <p className="text-xs text-slate-500">O primeiro horário livre da equipe.</p>
                    </div>
                  </div>
                  <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    selectedProf === null ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                  }`}>
                    {selectedProf === null && <CheckCircle2 size={14} />}
                  </div>
                </div>

                {professionals.map((p) => {
                  const isSelected = selectedProf?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedProf(p)}
                      className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                          : "border-slate-100 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-slate-900">{p.name}</h3>
                          <p className="text-xs text-emerald-700 font-medium">{p.role || "Especialista"}</p>
                        </div>
                      </div>

                      <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"
                      }`}>
                        {isSelected && <CheckCircle2 size={14} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="rounded-2xl gap-1">
                  <ChevronLeft size={16} /> Voltar
                </Button>
                <Button
                  onClick={() => setStep(3)}
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
                <p className="text-xs text-slate-500">Horários disponíveis calculados em tempo real.</p>
              </div>

              {/* Date Input */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Selecione o Dia
                </label>
                <input
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full bg-white p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              {/* Slots Grid */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Horários Livres
                </label>

                {loadingSlots ? (
                  <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
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
                  disabled={!selectedSlot}
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
                  <span className="font-bold">{selectedProf?.name || "Primeiro Disponível"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-700">Data e Hora:</span>
                  <span className="font-bold">{selectedDate} às {selectedSlot}</span>
                </div>
              </div>

              <div className="space-y-3 text-xs font-semibold text-slate-700">
                <div>
                  <label className="block mb-1">Seu Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Emerson Silva"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="block mb-1">WhatsApp com DDD / Código *</label>
                  <input
                    type="tel"
                    required
                    placeholder="Ex: 848858288 ou +258..."
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label className="block mb-1">Observações ou Sintomas (Opcional)</label>
                  <textarea
                    rows={2}
                    placeholder="Alguma informação importante para a consulta..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-between gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep(3)} className="rounded-2xl gap-1">
                  <ChevronLeft size={16} /> Voltar
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
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
          {step === 5 && (
            <div className="p-8 space-y-6 text-center">
              <div className="h-20 w-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner animate-bounce">
                <CheckCircle2 size={40} />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-black text-slate-900">Agendamento Realizado!</h2>
                <p className="text-xs sm:text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
                  Sua consulta foi reservada com sucesso. Enviamos os detalhes de confirmação para o seu WhatsApp.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl text-left space-y-2 text-xs text-slate-700">
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Paciente:</span>
                  <span className="font-bold text-slate-900">{customerName}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Serviço:</span>
                  <span className="font-bold text-slate-900">{selectedService?.name}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Profissional:</span>
                  <span className="font-bold text-slate-900">{selectedProf?.name || "Equipe"}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-slate-400">Data:</span>
                  <span className="font-bold text-slate-900">{selectedDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Horário:</span>
                  <span className="font-bold text-emerald-600 text-sm">{selectedSlot}</span>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <Button
                  onClick={() => {
                    setStep(1);
                    setSelectedSlot("");
                    setCustomerName("");
                    setCustomerPhone("");
                    setNotes("");
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

        {/* Footer */}
        <p className="text-center text-[10px] text-slate-400 mt-6 font-medium">
          Powered by <span className="font-bold text-slate-600">WhatsCRM</span> • Agendamentos Inteligentes via WhatsApp
        </p>
      </main>
    </div>
  );
}
