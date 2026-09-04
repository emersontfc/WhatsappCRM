import React, { useState, useEffect } from "react";
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
  end_time: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled";
  notes?: string;
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

export default function Appointments() {
  const [activeTab, setActiveTab] = useState<"agenda" | "services" | "professionals" | "share">("agenda");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Data
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);

  // Filters & State
  const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [filterProf, setFilterProf] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals
  const [showAppModal, setShowAppModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showProfModal, setShowProfModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Forms
  const [appForm, setAppForm] = useState({
    customer_name: "",
    customer_phone: "",
    service_id: "",
    professional_id: "",
    appointment_date: new Date().toISOString().split("T")[0],
    start_time: "09:00",
    notes: ""
  });

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

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const user = await getUser();
      if (user) setUserId(user.id);

      const [appsRes, servRes, profRes] = await Promise.all([
        apiFetch("/api/appointments"),
        apiFetch("/api/appointments/services"),
        apiFetch("/api/appointments/professionals")
      ]);

      if (appsRes.success) setAppointments(appsRes.data || []);
      if (servRes.success) setServices(servRes.data || []);
      if (profRes.success) setProfessionals(profRes.data || []);
    } catch (err: any) {
      console.error("Error loading appointment data:", err);
      toast.error("Erro ao carregar dados da agenda.");
    } finally {
      setLoading(false);
    }
  };

  const reloadAppointments = async () => {
    try {
      const res = await apiFetch("/api/appointments");
      if (res.success) setAppointments(res.data || []);
    } catch (_) {}
  };

  // Status updates
  const handleUpdateStatus = async (appId: string, newStatus: Appointment["status"]) => {
    try {
      const res = await apiFetch(`/api/appointments/${appId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus })
      });
      if (res.success) {
        setAppointments(prev => prev.map(a => a.id === appId ? { ...a, status: newStatus } : a));
        toast.success(`Status alterado para ${newStatus}!`);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar status");
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
    if (!appForm.customer_name || !appForm.appointment_date || !appForm.start_time) {
      return toast.error("Preencha o nome, data e horário.");
    }

    try {
      const res = await apiFetch("/api/appointments", {
        method: "POST",
        body: JSON.stringify(appForm)
      });
      if (res.success) {
        toast.success("Consulta agendada com sucesso!");
        setShowAppModal(false);
        setAppForm({
          customer_name: "",
          customer_phone: "",
          service_id: "",
          professional_id: "",
          appointment_date: new Date().toISOString().split("T")[0],
          start_time: "09:00",
          notes: ""
        });
        reloadAppointments();
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao agendar consulta");
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
  });

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
  const totalToday = appointments.filter(a => a.appointment_date === new Date().toISOString().split("T")[0]).length;
  const confirmedToday = appointments.filter(a => a.appointment_date === new Date().toISOString().split("T")[0] && a.status === "confirmed").length;
  const pendingCount = appointments.filter(a => a.status === "scheduled").length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-6 sm:p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-md">
              Módulo de Saúde & Serviços
            </span>
            <Sparkles size={16} className="text-amber-300 animate-pulse" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Agenda & Gestão de Consultas
          </h1>
          <p className="text-emerald-100 text-xs sm:text-sm max-w-xl leading-relaxed">
            Organize horários, envie lembretes automáticos no WhatsApp e compartilhe seu link de auto-agendamento com pacientes e clientes.
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
            onClick={() => setShowAppModal(true)}
            className="bg-white text-emerald-800 hover:bg-emerald-50 rounded-2xl gap-2 font-bold shadow-lg"
          >
            <Plus size={18} /> Nova Consulta
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <CalendarIcon size={24} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Consultas Hoje</p>
            <p className="text-2xl font-black text-slate-800">{totalToday}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-teal-50 text-teal-600 rounded-2xl">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Confirmadas Hoje</p>
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
                  onClick={() => setFilterDate(new Date().toISOString().split("T")[0])}
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
            {filteredAppointments.length > 0 ? (
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
                    <div className="flex items-center gap-2 self-end sm:self-center">
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
                        onChange={(e) => handleUpdateStatus(app.id, e.target.value as any)}
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
                  Clique em "Nova Consulta" ou compartilhe o seu link público para os pacientes agendarem.
                </p>
                <Button
                  onClick={() => setShowAppModal(true)}
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

      {/* TAB 4: SHARE LINK */}
      {activeTab === "share" && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm max-w-2xl mx-auto space-y-6 text-center">
          <div className="h-16 w-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
            <Share2 size={32} />
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-black text-slate-900">Seu Link de Auto-Agendamento Online</h2>
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

      {/* MODAL: NOVA CONSULTA MANUAL */}
      {showAppModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">Agendar Nova Consulta</h3>
              <button onClick={() => setShowAppModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-4 text-xs font-semibold text-slate-700">
              <div>
                <label className="block mb-1">Nome do Paciente / Cliente *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João Silva"
                  value={appForm.customer_name}
                  onChange={e => setAppForm({...appForm, customer_name: e.target.value})}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block mb-1">WhatsApp do Paciente</label>
                <input
                  type="text"
                  placeholder="Ex: 841234567"
                  value={appForm.customer_phone}
                  onChange={e => setAppForm({...appForm, customer_phone: e.target.value})}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Serviço / Procedimento</label>
                  <select
                    value={appForm.service_id}
                    onChange={e => setAppForm({...appForm, service_id: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.price} MT)</option>)}
                  </select>
                </div>

                <div>
                  <label className="block mb-1">Profissional Responsável</label>
                  <select
                    value={appForm.professional_id}
                    onChange={e => setAppForm({...appForm, professional_id: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Data da Consulta *</label>
                  <input
                    type="date"
                    required
                    value={appForm.appointment_date}
                    onChange={e => setAppForm({...appForm, appointment_date: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block mb-1">Horário de Início *</label>
                  <input
                    type="time"
                    required
                    value={appForm.start_time}
                    onChange={e => setAppForm({...appForm, start_time: e.target.value})}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1">Observações Internas (Opcional)</label>
                <textarea
                  rows={2}
                  placeholder="Ex: Primeira consulta, trazer exames..."
                  value={appForm.notes}
                  onChange={e => setAppForm({...appForm, notes: e.target.value})}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowAppModal(false)}>Cancelar</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl px-6">Agendar</Button>
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
