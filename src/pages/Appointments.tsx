import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { fetchBusinessProfile } from "../lib/niches";
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Plus, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ExternalLink, 
  Copy, 
  Trash2, 
  Edit, 
  Filter, 
  Search, 
  DollarSign, 
  Users, 
  Briefcase, 
  ChevronLeft, 
  ChevronRight,
  MessageCircle,
  Share2,
  CalendarCheck,
  BellRing,
  Check,
  Phone,
  Sparkles
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { getUser } from "../supabase";
import { QRCodeSVG } from "qrcode.react";

interface Service {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
  active: boolean;
}

interface Professional {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  working_days: string[];
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
  active: boolean;
}

type NotificationStatus = "sent" | "retry" | "uncertain" | "sending";
type NotificationKind = "confirmation" | "manual" | "reminder_24h" | "reminder_2h";

const notificationLabels: Record<NotificationStatus, string> = {
  sent: "Aceite pelo WhatsApp",
  retry: "Aguarda envio",
  uncertain: "Envio por confirmar",
  sending: "A enviar"
};

interface Appointment {
  id: string;
  user_id: string;
  contact_id?: string;
  service_id?: string;
  professional_id?: string;
  customer_name: string;
  customer_phone: string;
  appointment_date: string;
  start_time: string;
  start_at?: string | null;
  end_time: string;
  time_zone?: string | null;
  status: "scheduled" | "confirmed" | "completed" | "cancelled";
  notes?: string;
  reminder_24h_sent?: boolean | null;
  reminder_2h_sent?: boolean | null;
  notification_statuses?: Partial<Record<NotificationKind, NotificationStatus>>;
  services?: Service;
  professionals?: Professional;
}

const DAY_LABELS: Record<string, string> = {
  mon: "Seg",
  tue: "Ter",
  wed: "Qua",
  thu: "Qui",
  fri: "Sex",
  sat: "Sáb",
  sun: "Dom"
};

const appointmentForm = (date: string, appointment?: Appointment) => ({
  customer_name: appointment?.customer_name ?? "",
  customer_phone: appointment?.customer_phone ?? "",
  service_id: appointment?.service_id ?? "",
  professional_id: appointment?.professional_id ?? "",
  appointment_date: appointment?.appointment_date || date,
  start_time: appointment?.start_time?.slice(0, 5) || "09:00",
  notes: appointment?.notes ?? ""
});

export default function Appointments() {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const activeTab = requestedTab === "services" || requestedTab === "professionals" ||
    requestedTab === "share" || requestedTab === "reminders" ? requestedTab : "agenda";
  const setActiveTab = (next: string) => setParams((current) => {
    const updated = new URLSearchParams(current);
    updated.set("tab", next);
    updated.delete("new");
    return updated;
  });
  const [profile, setProfile] = useState("general");
  const clinic = params.get("context") === "clinic" || (!params.get("context") && profile === "clinic");
  const salon = params.get("context") === "salon" || (!params.get("context") && profile === "services");
  const appointmentLabel = clinic ? "consulta" : salon ? "atendimento" : "marcação";
  const customerLabel = clinic ? "paciente" : "cliente";
  const [timeZone, setTimeZone] = useState("Africa/Maputo");
  const today = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [confirmReminder, setConfirmReminder] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<"checking" | "connected" | "disconnected" | "unavailable">("checking");
  const [reminderAppointments, setReminderAppointments] = useState<Appointment[] | null>(null);
  const [remindersUnavailable, setRemindersUnavailable] = useState(false);
  const [remindersRevision, setRemindersRevision] = useState(0);
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState("");

  // Data
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  // Filters & State
  const [filterDate, setFilterDate] = useState<string>(today);
  const [filterProf, setFilterProf] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [updatingAppointment, setUpdatingAppointment] = useState<string | null>(null);
  const [appointmentError, setAppointmentError] = useState("");
  const savingAppointmentRef = useRef(false);
  const appointmentRequest = useRef<{ body: string; requestId: string } | null>(null);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showProfModal, setShowProfModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Forms
  const [appForm, setAppForm] = useState(() => appointmentForm(today));
  const originalAppForm = editingAppointment ? appointmentForm(today, editingAppointment) : null;
  const rescheduling = originalAppForm && (["appointment_date", "start_time", "service_id", "professional_id"] as const)
    .some((key) => originalAppForm[key] !== appForm[key]);

  const [serviceForm, setServiceForm] = useState({
    id: "",
    name: "",
    description: "",
    duration_minutes: 30,
    price: 0,
    active: true
  });

  const [profForm, setProfForm] = useState({
    id: "",
    name: "",
    role: "",
    phone: "",
    email: "",
    working_days: ["mon", "tue", "wed", "thu", "fri"],
    start_time: "08:00",
    end_time: "17:00",
    break_start: "12:00",
    break_end: "13:00",
    active: true
  });

  const openAppointment = (appointment?: Appointment) => {
    setEditingAppointment(appointment ?? null);
    setAppointmentError("");
    setAppForm(appointmentForm(filterDate || today, appointment));
    appointmentRequest.current = null;
    setShowAppModal(true);
  };

  useEffect(() => {
    loadInitialData();
    let active = true;
    void fetchBusinessProfile().then(({ type, timezone }) => {
      if (!active) return;
      setProfile(type);
      try {
        const localDate = formatInTimeZone(Date.now(), timezone, "yyyy-MM-dd");
        setTimeZone(timezone);
        setFilterDate((current) => current === today ? localDate : current);
        setAppForm((current) => current.appointment_date === today ? { ...current, appointment_date: localDate } : current);
      } catch { /* Invalid profiles use the default time zone. */ }
    });
    return () => { active = false; };
  }, []);

  const newAppointment = params.get("new") === "appointment";
  useEffect(() => {
    if (!newAppointment) return;
    openAppointment();
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("new");
      return next;
    }, { replace: true });
  }, [newAppointment, setParams]);

  useEffect(() => {
    if (activeTab !== "reminders") return;
    let active = true;
    const refresh = () => {
      if (document.hidden) return;
      void apiFetch("/api/whatsapp/status")
        .then(({ status }) => { if (active) setWhatsapp(status === "connected" ? "connected" : "disconnected"); })
        .catch(() => { if (active) setWhatsapp("unavailable"); });
      void apiFetch(`/api/appointments?startDate=${today}`)
        .then(({ success, data }) => {
          if (!success) throw new Error("Agenda indisponível");
          if (active) { setReminderAppointments(data ?? []); setRemindersUnavailable(false); }
        })
        .catch(() => { if (active) setRemindersUnavailable(true); });
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeTab, today, remindersRevision]);

  const loadInitialData = async () => {
    setLoading(true);
    setAppointmentsError("");
    try {
      const [user, appsRes, servRes, profRes] = await Promise.allSettled([
        getUser(),
        apiFetch("/api/appointments"),
        apiFetch("/api/appointments/services"),
        apiFetch("/api/appointments/professionals")
      ]);

      if (user.status === "fulfilled" && user.value) setUserId(user.value.id);
      if (servRes.status === "fulfilled" && servRes.value?.success) setServices(servRes.value.data || []);
      else toast.error("Não foi possível carregar os serviços.");
      if (profRes.status === "fulfilled" && profRes.value?.success) setProfessionals(profRes.value.data || []);
      else toast.error("Não foi possível carregar os profissionais.");
      if (appsRes.status === "fulfilled" && appsRes.value?.success) setAppointments(appsRes.value.data || []);
      else setAppointmentsError(appsRes.status === "rejected" && appsRes.reason instanceof Error
        ? appsRes.reason.message : "Não foi possível carregar as marcações.");
    } finally {
      setLoading(false);
    }
  };

  async function sendReminder(id: string) {
    if (sendingReminder) return;
    setSendingReminder(id);
    try {
      const res = await apiFetch(`/api/appointments/${id}/reminder`, { method: "POST" });
      if (!res?.success || res.status !== "sent") throw new Error("O envio do lembrete ainda não está confirmado.");
      toast.success(res.alreadySent ? "O WhatsApp já aceitou este lembrete." : "Lembrete aceite pelo WhatsApp.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o lembrete.");
    } finally {
      setConfirmReminder(null);
      setSendingReminder(null);
      setRemindersRevision((value) => value + 1);
    }
  }

  // Status updates
  const handleUpdateStatus = async (appId: string, newStatus: Appointment["status"]) => {
    if (updatingAppointment) return;
    setUpdatingAppointment(appId);
    try {
      const res = await apiFetch(`/api/appointments/${appId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus })
      });
      if (!res?.success) throw new Error("Não foi possível atualizar a marcação.");
      setAppointments((current) => current.map((item) => item.id === appId ? { ...item, status: res.data?.status ?? newStatus } : item));
      toast.success("Estado da marcação atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a marcação.");
    } finally {
      setUpdatingAppointment(null);
    }
  };

  // Delete appointment
  const handleDeleteAppointment = async (appId: string) => {
    if (!confirm("Deseja realmente cancelar e excluir este agendamento?")) return;
    try {
      const res = await apiFetch(`/api/appointments/${appId}`, { method: "DELETE" });
      if (res.success) {
        setAppointments(prev => prev.filter(a => a.id !== appId));
        toast.success("Agendamento excluído!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir agendamento");
    }
  };

  // Save appointment manually
  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingAppointmentRef.current) return;
    if (!appForm.customer_name.trim() || !appForm.appointment_date || !appForm.start_time) {
      setAppointmentError("Indica o nome, a data e a hora.");
      return;
    }
    const edit = editingAppointment;
    savingAppointmentRef.current = true;
    setSavingAppointment(true);
    setAppointmentError("");
    try {
      const values = { ...appForm, customer_name: appForm.customer_name.trim(), notes: appForm.notes.trim() };
      const payload: Partial<typeof values> & { end_time?: string; request_id?: string } = { ...values };
      if (edit && originalAppForm) {
        for (const key of Object.keys(values) as Array<keyof typeof values>) {
          if (values[key] === originalAppForm[key]) delete payload[key];
        }
        if (payload.professional_id !== undefined && payload.appointment_date === undefined &&
          payload.start_time === undefined && payload.service_id === undefined && edit.end_time) payload.end_time = edit.end_time;
      } else {
        const body = JSON.stringify(values);
        if (appointmentRequest.current?.body !== body) appointmentRequest.current = { body, requestId: crypto.randomUUID() };
        payload.request_id = appointmentRequest.current.requestId;
      }
      const res = await apiFetch(edit ? `/api/appointments/${edit.id}` : "/api/appointments", {
        method: edit ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      if (!res?.success || !res.data?.id) throw new Error("Não foi possível guardar a marcação.");
      const saved: Appointment = {
        ...res.data,
        services: services.find((item) => item.id === res.data.service_id),
        professionals: professionals.find((item) => item.id === res.data.professional_id)
      };
      setAppointments((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      toast.success(edit ? "Marcação atualizada." : "Marcação guardada.");
      setShowAppModal(false);
      setFilterDate(saved.appointment_date);
      setFilterProf("all");
      setFilterStatus("all");
      setSearchQuery("");
      if (activeTab !== "agenda") setActiveTab("agenda");
    } catch (error) {
      setAppointmentError(error instanceof Error ? error.message : "Não foi possível guardar a marcação.");
    } finally {
      savingAppointmentRef.current = false;
      setSavingAppointment(false);
    }
  };

  // Save Service
  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceForm.name) return toast.error("Informe o nome do serviço.");
    try {
      const res = await apiFetch("/api/appointments/services", {
        method: "POST",
        body: JSON.stringify(serviceForm)
      });
      if (res.success) {
        toast.success("Serviço salvo!");
        setShowServiceModal(false);
        setServiceForm({ id: "", name: "", description: "", duration_minutes: 30, price: 0, active: true });
        const servRes = await apiFetch("/api/appointments/services");
        if (servRes.success) setServices(servRes.data || []);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar serviço");
    }
  };

  // Delete Service
  const handleDeleteService = async (id: string) => {
    if (!confirm("Remover este serviço?")) return;
    try {
      const res = await apiFetch(`/api/appointments/services/${id}`, { method: "DELETE" });
      if (res.success) {
        setServices(prev => prev.filter(s => s.id !== id));
        toast.success("Serviço removido!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir serviço");
    }
  };

  // Save Professional
  const handleSaveProfessional = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profForm.name) return toast.error("Informe o nome do profissional.");
    try {
      const res = await apiFetch("/api/appointments/professionals", {
        method: "POST",
        body: JSON.stringify(profForm)
      });
      if (res.success) {
        toast.success("Profissional salvo!");
        setShowProfModal(false);
        setProfForm({
          id: "",
          name: "",
          role: "",
          phone: "",
          email: "",
          working_days: ["mon", "tue", "wed", "thu", "fri"],
          start_time: "08:00",
          end_time: "17:00",
          break_start: "12:00",
          break_end: "13:00",
          active: true
        });
        const profRes = await apiFetch("/api/appointments/professionals");
        if (profRes.success) setProfessionals(profRes.data || []);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar profissional");
    }
  };

  // Delete Professional
  const handleDeleteProfessional = async (id: string) => {
    if (!confirm("Remover este profissional?")) return;
    try {
      const res = await apiFetch(`/api/appointments/professionals/${id}`, { method: "DELETE" });
      if (res.success) {
        setProfessionals(prev => prev.filter(p => p.id !== id));
        toast.success("Profissional removido!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir profissional");
    }
  };

  // Filtered Appointments
  const filteredAppointments = appointments.filter(app => {
    if (filterDate && app.appointment_date !== filterDate) return false;
    if (filterProf !== "all" && app.professional_id !== filterProf) return false;
    if (filterStatus !== "all" && app.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = app.customer_name?.toLowerCase().includes(q);
      const matchPhone = app.customer_phone?.includes(q);
      const matchService = app.services?.name?.toLowerCase().includes(q);
      if (!matchName && !matchPhone && !matchService) return false;
    }
    return true;
  }).sort((first, second) => first.appointment_date.localeCompare(second.appointment_date) || first.start_time.localeCompare(second.start_time));

  // Booking URL
  const bookingUrl = typeof window !== "undefined" && userId
    ? `${window.location.origin}/book/${userId}`
    : "";

  const copyBookingLink = () => {
    if (!bookingUrl) return;
    navigator.clipboard.writeText(bookingUrl);
    setCopiedLink(true);
    toast.success("Link copiado para a área de transferência!");
    setTimeout(() => setCopiedLink(false), 3000);
  };

  const getStatusBadge = (status: Appointment["status"]) => {
    switch (status) {
      case "confirmed":
        return <Badge variant="success" className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 size={12} /> Confirmado</Badge>;
      case "completed":
        return <Badge variant="secondary" className="gap-1 bg-blue-50 text-blue-700 border-blue-200"><CalendarCheck size={12} /> Concluído</Badge>;
      case "cancelled":
        return <Badge variant="error" className="gap-1 bg-red-50 text-red-700 border-red-200"><XCircle size={12} /> Cancelado</Badge>;
      default:
        return <Badge variant="warning" className="gap-1 bg-amber-50 text-amber-700 border-amber-200"><Clock size={12} /> Agendado</Badge>;
    }
  };

  // Metrics
  const totalToday = appointments.filter(a => a.appointment_date === today).length;
  const confirmedToday = appointments.filter(a => a.appointment_date === today && a.status === "confirmed").length;
  const pendingCount = appointments.filter(a => a.status === "scheduled").length;

  const upcoming = (reminderAppointments ?? []).filter((appointment) =>
    (appointment.status === "scheduled" || appointment.status === "confirmed") &&
    (appointment.start_at
      ? Date.parse(appointment.start_at)
      : fromZonedTime(`${appointment.appointment_date}T${appointment.start_time}`, appointment.time_zone || timeZone).getTime()) > Date.now());
  const hasService = services.some((service) => service.active);
  const hasProfessional = professionals.some((professional) => professional.active);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-6 sm:p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 space-y-1">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {clinic ? "Receção da clínica" : salon ? "Agenda do salão" : "Marcações e lembretes"}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-emerald-100">
            Define os serviços e horários, partilha o link de marcação e acompanha os avisos por WhatsApp.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => setActiveTab("share")}
            className="bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-md rounded-2xl gap-2 font-medium"
          >
            <Share2 size={16} /> Link de Agendamento
          </Button>
          <Button
            onClick={() => openAppointment()}
            className="bg-white text-emerald-800 hover:bg-emerald-50 rounded-2xl gap-2 font-bold shadow-lg"
          >
            <Plus size={18} /> {clinic ? "Marcar consulta" : salon ? "Marcar atendimento" : "Nova marcação"}
          </Button>
        </div>
      </div>

      {!loading && (!hasService || !hasProfessional) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-700">{!hasService
            ? "Adiciona um serviço ativo para que os clientes possam marcar pelo link."
            : "Adiciona profissionais se quiseres oferecer horários por pessoa."}</p>
          <Button variant="outline" size="sm" onClick={() => setActiveTab(hasService ? "professionals" : "services")}>
            {hasService ? "Definir horários da equipa" : "Configurar serviços"}
          </Button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <CalendarIcon size={24} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Marcações de hoje</p>
            <p className="text-2xl font-black text-slate-800">{totalToday}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-teal-50 text-teal-600 rounded-2xl">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Confirmadas hoje</p>
            <p className="text-2xl font-black text-teal-700">{confirmedToday}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-amber-50 text-amber-600 rounded-2xl">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Pendentes de Confirmação</p>
            <p className="text-2xl font-black text-amber-700">{pendingCount}</p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2 sm:gap-4 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab("agenda")}
          className={`pb-3 px-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === "agenda"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <CalendarIcon size={16} /> Agenda & Horários
        </button>
        <button
          onClick={() => setActiveTab("services")}
          className={`pb-3 px-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === "services"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Briefcase size={16} /> Serviços & Preços ({services.length})
        </button>
        <button
          onClick={() => setActiveTab("professionals")}
          className={`pb-3 px-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === "professionals"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Users size={16} /> Profissionais ({professionals.length})
        </button>
        <button
          onClick={() => setActiveTab("share")}
          className={`pb-3 px-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === "share"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Share2 size={16} /> Link de Auto-Agendamento
        </button>
        <button type="button" onClick={() => setActiveTab("reminders")} aria-pressed={activeTab === "reminders"}
          className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-bold ${activeTab === "reminders"
            ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
          <BellRing size={16} aria-hidden="true" /> Lembretes
        </button>
      </div>

      {/* TAB 1: AGENDA */}
      {activeTab === "agenda" && (
        <div className="space-y-4">
          {/* Controls / Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Date selector */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                <CalendarIcon size={16} className="text-slate-400" />
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFilterDate(today)}
                  className="h-6 px-2 text-[10px] font-bold text-emerald-600"
                >
                  Hoje
                </Button>
              </div>

              {/* Professional filter */}
              <select
                value={filterProf}
                onChange={(e) => setFilterProf(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="all">Todos Profissionais</option>
                {professionals.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="all">Todos os Status</option>
                <option value="scheduled">Agendado</option>
                <option value="confirmed">Confirmado</option>
                <option value="completed">Concluído</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>

            {/* Search */}
            <div className="relative min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar paciente ou serviço..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          {/* Appointments List */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            {loading ? (
              <p role="status" className="p-5 text-sm text-slate-600">A carregar marcações…</p>
            ) : appointmentsError ? (
              <div className="space-y-2 p-5">
                <p role="alert" className="text-sm text-red-700">{appointmentsError}</p>
                <Button size="sm" variant="outline" onClick={() => void loadInitialData()}>Tentar novamente</Button>
              </div>
            ) : filteredAppointments.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {filteredAppointments.map((app) => (
                  <div
                    key={app.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex flex-col items-center justify-center shrink-0 font-bold">
                        <span className="text-xs font-mono">{app.start_time}</span>
                        <span className="text-[10px] text-slate-400 font-normal">{app.end_time}</span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900">{app.customer_name}</h3>
                          {getStatusBadge(app.status)}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                          {app.services?.name && (
                            <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg">
                              {app.services.name} {app.services.price > 0 && `• ${app.services.price} MT`}
                            </span>
                          )}
                          {app.professionals?.name && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <User size={12} className="text-emerald-600" /> {app.professionals.name}
                            </span>
                          )}
                          {app.customer_phone && (
                            <span className="flex items-center gap-1 font-mono text-slate-500">
                              <Phone size={12} /> {app.customer_phone}
                            </span>
                          )}
                        </div>

                        {app.notes && (
                          <p className="text-xs text-slate-500 italic bg-amber-50/60 border border-amber-100 rounded-lg p-1.5 max-w-lg">
                            📝 {app.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:self-center">
                      {/* WhatsApp direct chat button */}
                      {app.customer_phone && (
                        <a
                          href={`https://wa.me/${app.customer_phone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-xl transition-colors"
                        >
                          <MessageCircle size={14} /> WhatsApp
                        </a>
                      )}

                      {/* Status Dropdown */}
                      <select
                        value={app.status}
                        aria-label="Estado da marcação"
                        disabled={Boolean(updatingAppointment)}
                        onChange={(e) => handleUpdateStatus(app.id, e.target.value as Appointment["status"])}
                        className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 border-none rounded-xl px-2.5 py-2 text-slate-700 focus:outline-none cursor-pointer"
                      >
                        <option value="scheduled">Agendado</option>
                        <option value="confirmed">Confirmar</option>
                        <option value="completed">Concluir</option>
                        <option value="cancelled">Cancelar</option>
                      </select>

                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={updatingAppointment === app.id}
                        onClick={() => openAppointment(app)}
                        className="h-9 w-9 text-slate-500 hover:text-emerald-700 rounded-xl"
                        aria-label="Editar marcação"
                        title="Editar marcação"
                      >
                        <Edit size={16} />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteAppointment(app.id)}
                        className="h-9 w-9 text-slate-400 hover:text-red-500 rounded-xl"
                        title="Excluir agendamento"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-slate-400 space-y-3">
                <CalendarIcon size={40} className="mx-auto text-slate-300" />
                <p className="text-sm font-semibold text-slate-600">Nenhum agendamento encontrado para esta data.</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Cria uma marcação ou partilha o link para receber pedidos de horário.
                </p>
                <Button
                  onClick={() => openAppointment()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs gap-1.5"
                >
                  <Plus size={16} /> Agendar Agora
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SERVIÇOS */}
      {activeTab === "services" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-slate-800">Catálogo de Procedimentos & Serviços</h2>
              <p className="text-xs text-slate-500">Defina os tipos de consulta, duração em minutos e valores.</p>
            </div>
            <Button
              onClick={() => {
                setServiceForm({ id: "", name: "", description: "", duration_minutes: 30, price: 0, active: true });
                setShowServiceModal(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-1.5 text-xs font-bold"
            >
              <Plus size={16} /> Novo Serviço
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => (
              <div
                key={s.id}
                className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between space-y-4 hover:border-emerald-200 transition-colors"
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="font-bold text-slate-900 text-base">{s.name}</h3>
                    <Badge variant={s.active ? "success" : "secondary"}>
                      {s.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{s.description || "Sem descrição informada."}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-700">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <Clock size={14} /> {s.duration_minutes} min
                    </span>
                    <span className="text-slate-900">
                      {s.price > 0 ? `${s.price} MT` : "Grátis"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-emerald-600 rounded-lg"
                      onClick={() => {
                        setServiceForm(s);
                        setShowServiceModal(true);
                      }}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-500 rounded-lg"
                      onClick={() => handleDeleteService(s.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: PROFISSIONAIS */}
      {activeTab === "professionals" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-slate-800">Equipe & Horários de Atendimento</h2>
              <p className="text-xs text-slate-500">Configure médicos, especialistas e seus dias e horários de trabalho.</p>
            </div>
            <Button
              onClick={() => {
                setProfForm({
                  id: "",
                  name: "",
                  role: "",
                  phone: "",
                  email: "",
                  working_days: ["mon", "tue", "wed", "thu", "fri"],
                  start_time: "08:00",
                  end_time: "17:00",
                  break_start: "12:00",
                  break_end: "13:00",
                  active: true
                });
                setShowProfModal(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-1.5 text-xs font-bold"
            >
              <Plus size={16} /> Novo Profissional
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {professionals.map((p) => (
              <div
                key={p.id}
                className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 hover:border-emerald-200 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white font-black text-lg flex items-center justify-center shadow-md">
                    {p.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">{p.name}</h3>
                    <p className="text-xs text-emerald-700 font-medium">{p.role || "Especialista"}</p>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dias:</span>
                    <span className="font-bold">{(p.working_days || []).map(d => DAY_LABELS[d] || d).join(", ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Horário:</span>
                    <span className="font-bold">{p.start_time} - {p.end_time}</span>
                  </div>
                  {p.break_start && p.break_end && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Almoço:</span>
                      <span className="font-bold">{p.break_start} - {p.break_end}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-emerald-600 rounded-lg"
                    onClick={() => {
                      setProfForm(p as any);
                      setShowProfModal(true);
                    }}
                  >
                    <Edit size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-red-500 rounded-lg"
                    onClick={() => handleDeleteProfessional(p.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "reminders" && (
        <section aria-labelledby="reminders-heading" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div>
            <h2 id="reminders-heading" className="text-lg font-bold text-slate-900">Lembretes das próximas marcações</h2>
            <p className="mt-1 text-sm text-slate-600">A agenda tenta enviar avisos 24 h e 2 h antes de cada marcação ativa, no fuso em que foi registada.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{{ checking: "A confirmar ligação ao WhatsApp…", connected: "WhatsApp ligado", disconnected: "WhatsApp desligado", unavailable: "Ligação ao WhatsApp por verificar" }[whatsapp]}</span>
            {whatsapp !== "connected" && <Link to="/dashboard#ligar-whatsapp" className="font-semibold text-emerald-800 underline">Ver ligação</Link>}
            <Link to="/settings?tab=niche" className="font-semibold text-emerald-800 underline">Definir fuso do negócio</Link>
          </div>
          {remindersUnavailable ? <p role="status">Não foi possível consultar os lembretes. A agenda tentará novamente.</p>
          : !reminderAppointments ? <p role="status">A carregar marcações…</p> : upcoming.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm">Sem marcações ativas no futuro.</p>
          ) : <ul className="divide-y divide-slate-100">
            {upcoming.map((item) => {
              const notices = item.notification_statuses;
              const manual = notices?.manual;
              const canSendManually = item.customer_phone && (!manual || manual === "retry");
              const label24 = notices?.reminder_24h ? notificationLabels[notices.reminder_24h] : item.reminder_24h_sent ? "Enviado" : "Por enviar";
              const label2 = notices?.reminder_2h ? notificationLabels[notices.reminder_2h] : item.reminder_2h_sent ? "Enviado" : "Por enviar";
              return <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-sm">{item.customer_name}</strong>
                  <p className="text-sm text-slate-600">{item.appointment_date.split("-").reverse().join("/")} · {item.start_time.slice(0, 5)} · {item.time_zone || timeZone}</p>
                  {item.customer_phone ? <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-sm text-slate-700">
                    {notices?.confirmation && <><dt>Confirmação</dt><dd>{notificationLabels[notices.confirmation]}</dd></>}
                    <dt>Lembrete de 24 h</dt><dd>{label24}</dd>
                    <dt>Lembrete de 2 h</dt><dd>{label2}</dd>
                    {manual && <><dt>Lembrete manual</dt><dd>{notificationLabels[manual]}</dd></>}
                  </dl> : <p className="mt-1 text-sm text-slate-700">Sem número WhatsApp</p>}
                </div>
                {canSendManually && (confirmReminder === item.id ? <div className="grid gap-2">
                  <p className="text-sm">Enviar agora para {item.customer_phone}?</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void sendReminder(item.id)} disabled={Boolean(sendingReminder) || whatsapp !== "connected"}>
                      {sendingReminder === item.id ? "A enviar…" : "Confirmar envio"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmReminder(null)} disabled={Boolean(sendingReminder)}>Cancelar envio</Button>
                  </div>
                </div> : <Button size="sm" variant="outline" disabled={whatsapp !== "connected" || Boolean(sendingReminder)}
                  onClick={() => setConfirmReminder(item.id)}>Enviar lembrete agora</Button>)}
              </li>;
            })}
          </ul>}
        </section>
      )}

      {/* TAB 4: SHARE LINK */}
      {activeTab === "share" && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto space-y-6 text-center">
          <div className="h-16 w-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
            <Share2 size={32} />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-black text-slate-900">O teu link de marcação</h2>
            {!hasService && <p className="text-sm font-medium text-amber-800">É preciso ter pelo menos um serviço ativo para aceitar marcações por este link.</p>}
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              Envie esse link no WhatsApp, coloque na bio do seu Instagram ou imprima o QR Code no balcão da sua recepção.
            </p>
          </div>

          {/* QR Code preview */}
          {bookingUrl && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 inline-block mx-auto shadow-inner">
              <QRCodeSVG value={bookingUrl} size={180} level="M" />
              <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wider">Escaneie com a câmera do celular</p>
            </div>
          )}

          {/* Copy link box */}
          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <input
              type="text"
              readOnly
              value={bookingUrl}
              className="flex-1 bg-transparent px-3 text-xs font-mono text-slate-700 focus:outline-none truncate"
            />
            <Button
              onClick={copyBookingLink}
              disabled={!hasService || !bookingUrl}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs gap-1.5 font-bold shrink-0 shadow-sm"
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              {copiedLink ? "Copiado!" : "Copiar Link"}
            </Button>
          </div>

          <div className="flex justify-center gap-3">
            <a
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline"
            >
              <ExternalLink size={14} /> Abrir Página de Agendamento como Paciente
            </a>
          </div>
        </div>
      )}

      {showAppModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="appointment-heading"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-slate-100 bg-white p-4 shadow-2xl sm:p-6">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 id="appointment-heading" className="text-base font-bold text-slate-900">{editingAppointment ? "Editar" : "Marcar"} {appointmentLabel}</h3>
              <button type="button" disabled={savingAppointment} aria-label="Fechar" onClick={() => setShowAppModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-4 text-xs font-semibold text-slate-700">
              <fieldset disabled={savingAppointment} className="space-y-4">
                <div>
                  <label htmlFor="appointment-customer" className="block mb-1">Nome do {customerLabel} *</label>
                  <input id="appointment-customer"
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={150}
                    placeholder="Ex: João Silva"
                    value={appForm.customer_name}
                    onChange={e => setAppForm({...appForm, customer_name: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="appointment-phone" className="block mb-1">WhatsApp do {customerLabel}</label>
                  <input id="appointment-phone"
                    type="tel"
                    autoComplete="tel"
                    aria-describedby="appointment-phone-help"
                    placeholder="Ex: 841234567"
                    value={appForm.customer_phone}
                    onChange={e => setAppForm({...appForm, customer_phone: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <p id="appointment-phone-help" className="mt-1 text-xs font-normal text-slate-600">Adiciona o número para enviar lembretes por WhatsApp.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="appointment-service" className="block mb-1">Serviço / Procedimento</label>
                    <select id="appointment-service"
                      value={appForm.service_id}
                      onChange={e => setAppForm({...appForm, service_id: e.target.value})}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                    >
                      <option value="">Selecione...</option>
                      {services.filter((service) => service.active || service.id === editingAppointment?.service_id)
                        .map((service) => <option key={service.id} value={service.id}>{service.name}{service.active ? "" : " (inativo)"}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="appointment-professional" className="block mb-1">Profissional Responsável</label>
                    <select id="appointment-professional"
                      value={appForm.professional_id}
                      onChange={e => setAppForm({...appForm, professional_id: e.target.value})}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                    >
                      <option value="">Selecione...</option>
                      {professionals.filter((professional) => professional.active || professional.id === editingAppointment?.professional_id)
                        .map((professional) => <option key={professional.id} value={professional.id}>{professional.name}{professional.active ? "" : " (inativo)"}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="appointment-date" className="block mb-1">Data *</label>
                    <input id="appointment-date"
                      type="date"
                      required
                      value={appForm.appointment_date}
                      onChange={e => setAppForm({...appForm, appointment_date: e.target.value})}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="appointment-time" className="block mb-1">Horário de Início *</label>
                    <input id="appointment-time"
                      type="time"
                      aria-describedby="appointment-time-zone"
                      required
                      value={appForm.start_time}
                      onChange={e => setAppForm({...appForm, start_time: e.target.value})}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                    />
                    <p id="appointment-time-zone" className="mt-1 font-normal text-slate-600">{!rescheduling && editingAppointment?.time_zone || timeZone}</p>
                  </div>
                </div>

                <div>
                  <label htmlFor="appointment-notes" className="block mb-1">Observações Internas (Opcional)</label>
                  <textarea id="appointment-notes"
                    rows={2}
                    maxLength={1000}
                    placeholder="Ex: Preferência de horário"
                    value={appForm.notes}
                    onChange={e => setAppForm({...appForm, notes: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </fieldset>

              {appointmentError && <p role="alert" className="font-medium text-red-700">{appointmentError}</p>}
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" disabled={savingAppointment} onClick={() => setShowAppModal(false)}>Cancelar</Button>
                <Button type="submit" disabled={savingAppointment} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6">
                  {savingAppointment ? "A guardar…" : editingAppointment ? "Guardar alterações" : "Agendar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO SERVIÇO */}
      {showServiceModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">{serviceForm.id ? "Editar Serviço" : "Novo Serviço"}</h3>
              <button onClick={() => setShowServiceModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSaveService} className="space-y-4 text-xs font-semibold text-slate-700">
              <div>
                <label className="block mb-1">Nome do Procedimento *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Consulta Geral, Limpeza Dental..."
                  value={serviceForm.name}
                  onChange={e => setServiceForm({...serviceForm, name: e.target.value})}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Duração (minutos)</label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={serviceForm.duration_minutes}
                    onChange={e => setServiceForm({...serviceForm, duration_minutes: Number(e.target.value)})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block mb-1">Preço (MT / MZN)</label>
                  <input
                    type="number"
                    min={0}
                    value={serviceForm.price}
                    onChange={e => setServiceForm({...serviceForm, price: Number(e.target.value)})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1">Descrição</label>
                <textarea
                  rows={2}
                  placeholder="Breve descrição do serviço..."
                  value={serviceForm.description}
                  onChange={e => setServiceForm({...serviceForm, description: e.target.value})}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowServiceModal(false)}>Cancelar</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6">Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO PROFISSIONAL */}
      {showProfModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">{profForm.id ? "Editar Profissional" : "Novo Profissional"}</h3>
              <button onClick={() => setShowProfModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSaveProfessional} className="space-y-4 text-xs font-semibold text-slate-700">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Dra. Maria Santos"
                    value={profForm.name}
                    onChange={e => setProfForm({...profForm, name: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1">Cargo / Especialidade</label>
                  <input
                    type="text"
                    placeholder="Ex: Clínico Geral, Dentista..."
                    value={profForm.role}
                    onChange={e => setProfForm({...profForm, role: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1.5">Dias de Trabalho</label>
                <div className="flex gap-2 flex-wrap">
                  {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(day => {
                    const isSelected = profForm.working_days.includes(day);
                    return (
                      <button
                        type="button"
                        key={day}
                        onClick={() => {
                          const next = isSelected
                            ? profForm.working_days.filter(d => d !== day)
                            : [...profForm.working_days, day];
                          setProfForm({...profForm, working_days: next});
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                          isSelected
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                            : "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        {DAY_LABELS[day]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Horário Início</label>
                  <input
                    type="time"
                    value={profForm.start_time}
                    onChange={e => setProfForm({...profForm, start_time: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1">Horário Fim</label>
                  <input
                    type="time"
                    value={profForm.end_time}
                    onChange={e => setProfForm({...profForm, end_time: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Início do Almoço</label>
                  <input
                    type="time"
                    value={profForm.break_start}
                    onChange={e => setProfForm({...profForm, break_start: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1">Fim do Almoço</label>
                  <input
                    type="time"
                    value={profForm.break_end}
                    onChange={e => setProfForm({...profForm, break_end: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowProfModal(false)}>Cancelar</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6">Salvar</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
