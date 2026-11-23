import {
  Stethoscope,
  CalendarCheck,
  CalendarPlus,
  BellRing,
  MessageSquare,
  Bot,
  TrendingUp,
  UserPlus,
  Zap,
  Send,
  Scissors,
  UserCheck,
  Activity,
  Users,
  Clock,
  UtensilsCrossed,
  Store,
  Briefcase
} from "lucide-react";
import { apiFetch } from "./api";

export type CanonicalBusinessType = "general" | "clinic" | "retail" | "restaurant" | "services";
export type BusinessNiche = CanonicalBusinessType | "geral" | "clinica" | "vendas" | "servicos";

export function toCanonicalNiche(raw: string | null | undefined): CanonicalBusinessType {
  if (!raw) return "general";
  const lower = String(raw).trim().toLowerCase();
  if (lower === "clinic" || lower === "clinica" || lower === "saude" || lower === "consultorio") return "clinic";
  if (lower === "retail" || lower === "vendas" || lower === "comercio" || lower === "loja" || lower === "ecommerce") return "retail";
  if (lower === "restaurant" || lower === "restaurante" || lower === "bar" || lower === "lanchonete") return "restaurant";
  if (lower === "services" || lower === "servicos" || lower === "estetica" || lower === "salao") return "services";
  return "general";
}

export interface NicheConfig {
  id: CanonicalBusinessType;
  label: string;
  badge: string;
  icon: any;
  tagline: string;
  description: string;
  features: string[];
  kpi1: { label: string; icon: any; color: string; bg: string };
  kpi2: { label: string; icon: any; color: string; bg: string };
  kpi3: { label: string; icon: any; color: string; bg: string };
  leadsTitle: string;
  leadsSubtitle: string;
  emptyLeadsText: string;
  quickActions: { label: string; icon: any; path: string; isPrimary?: boolean }[];
}

const BASE_NICHE_CONFIGS: Record<CanonicalBusinessType, NicheConfig> = {
  general: {
    id: "general",
    label: "Geral / Flexível",
    badge: "Modo Multiuso & Negócios",
    icon: Activity,
    tagline: "Visão global de conversas, automações e atendimento multicanal.",
    description: "Modo genérico adaptado para qualquer tipo de negócio que precisa de comunicação e automação eficiente via WhatsApp.",
    features: ["Atendimento Humano + IA", "Disparos Agendados", "Gestão de Contactos", "Menus Interativos"],
    kpi1: { label: "Contactos Ativos", icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Leads Capturados", icon: UserPlus, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Mensagens do Bot", icon: MessageSquare, color: "text-purple-600", bg: "bg-purple-50" },
    leadsTitle: "Interações & Contactos Recentes",
    leadsSubtitle: "Últimos contactos ativos no WhatsApp",
    emptyLeadsText: "Nenhum contacto ativo recentemente.",
    quickActions: [
      { label: "Nova Mensagem", icon: MessageSquare, path: "/messages", isPrimary: true },
      { label: "Novo Contacto", icon: UserPlus, path: "/contacts" },
      { label: "Agendamentos", icon: Clock, path: "/schedule" },
      { label: "Configurar Agente", icon: Bot, path: "/agent" },
    ]
  },
  clinic: {
    id: "clinic",
    label: "Clínica & Saúde",
    badge: "Consultório e clínica",
    icon: Stethoscope,
    tagline: "Agenda de consultas, serviços, profissionais e lembretes por WhatsApp.",
    description: "Ideal para clínicas médicas, dentistas, psicólogos, consultórios e laboratórios que precisam gerenciar horários e pacientes.",
    features: ["Marcações", "Lembretes 24 h e 2 h", "Link de marcação", "Horários da equipa"],
    kpi1: { label: "Consultas Agendadas", icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Pacientes em Espera", icon: Stethoscope, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Lembretes Automáticos", icon: BellRing, color: "text-purple-600", bg: "bg-purple-50" },
    leadsTitle: "Próximas Consultas & Pacientes em Espera",
    leadsSubtitle: "Pacientes que iniciaram triagem ou solicitaram agendamento",
    emptyLeadsText: "Nenhum paciente aguardando atendimento no momento.",
    quickActions: [
      { label: "Novo Agendamento", icon: CalendarPlus, path: "/appointments", isPrimary: true },
      { label: "Atender Paciente", icon: MessageSquare, path: "/messages" },
      { label: "Disparar Lembretes", icon: BellRing, path: "/schedule" },
      { label: "Triagem Inteligente (IA)", icon: Bot, path: "/agent" },
    ]
  },
  retail: {
    id: "retail",
    label: "Comércio & Vendas",
    badge: "Modo Comercial & Pipeline",
    icon: TrendingUp,
    tagline: "Funil de vendas, catálogo de produtos, pedidos e fechamento comercial.",
    description: "Ideal para lojas físicas e digitais, corretores, agências e distribuidores focados em pedidos e conversão de leads.",
    features: ["Catálogo de Produtos", "Pedidos & Pagamentos", "Pipeline Comercial", "Atendente IA de Vendas"],
    kpi1: { label: "Pipeline Comercial", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Pedidos em Aberto", icon: UserPlus, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Ações da IA Comercial", icon: Zap, color: "text-amber-600", bg: "bg-amber-50" },
    leadsTitle: "Oportunidades Quentes do Funil",
    leadsSubtitle: "Leads com maior probabilidade de conversão nas últimas horas",
    emptyLeadsText: "Nenhum lead em negociação aberta no momento.",
    quickActions: [
      { label: "Ver Pedidos", icon: TrendingUp, path: "/orders", isPrimary: true },
      { label: "Cadastrar Lead", icon: UserPlus, path: "/leads" },
      { label: "Abrir Conversas", icon: MessageSquare, path: "/messages" },
      { label: "Agente de Vendas (IA)", icon: Bot, path: "/agent" },
    ]
  },
  restaurant: {
    id: "restaurant",
    label: "Restaurante & Gastronomia",
    badge: "Modo Alimentação & Pedidos",
    icon: UtensilsCrossed,
    tagline: "Cardápio digital, reservas de mesa e pedidos automáticos pelo WhatsApp.",
    description: "Ideal para restaurantes, bares, lanchonetes, pizzarias e delivery.",
    features: ["Cardápio Inteligente", "Recebimento de Pedidos", "Reserva de Mesas", "Avisos de Entrega"],
    kpi1: { label: "Pedidos do Dia", icon: UtensilsCrossed, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Clientes Atendidos", icon: UserCheck, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Menus Ativos", icon: Zap, color: "text-amber-600", bg: "bg-amber-50" },
    leadsTitle: "Últimos Pedidos & Reservas",
    leadsSubtitle: "Clientes com solicitações de pedidos ou reservas abertas",
    emptyLeadsText: "Nenhum pedido recente em aberto.",
    quickActions: [
      { label: "Ver Pedidos", icon: UtensilsCrossed, path: "/orders", isPrimary: true },
      { label: "Mensagens", icon: MessageSquare, path: "/messages" },
      { label: "Cardápio / Menus", icon: Activity, path: "/menus" },
      { label: "Robô de Atendimento", icon: Bot, path: "/agent" },
    ]
  },
  services: {
    id: "services",
    label: "Serviços & Estética",
    badge: "Serviços e estética",
    icon: Scissors,
    tagline: "Agenda de serviços, horários por profissional e lembretes por WhatsApp.",
    description: "Ideal para barbearias, salões de beleza, spas, personal trainers e profissionais liberais que atendem por marcação.",
    features: ["Marcação de Sessões", "Cardápio de Serviços", "Avisos por WhatsApp", "Histórico de Clientes"],
    kpi1: { label: "Horários Marcados", icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Clientes Atendidos", icon: UserCheck, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Automações de Menu", icon: Activity, color: "text-purple-600", bg: "bg-purple-50" },
    leadsTitle: "Próximos Agendamentos de Clientes",
    leadsSubtitle: "Clientes que reservaram serviços pelo WhatsApp",
    emptyLeadsText: "Nenhum agendamento pendente no momento.",
    quickActions: [
      { label: "Novo Horário", icon: CalendarPlus, path: "/appointments", isPrimary: true },
      { label: "Ver Conversas", icon: MessageSquare, path: "/messages" },
      { label: "Cardápio de Serviços", icon: Activity, path: "/menus" },
      { label: "Assistente 24h (IA)", icon: Bot, path: "/agent" },
    ]
  }
};

// Proxy handler to allow accessing NICHE_CONFIGS by canonical or legacy keys seamlessly
export const NICHE_CONFIGS: Record<string, NicheConfig> = new Proxy(BASE_NICHE_CONFIGS as any, {
  get(target, prop: string) {
    const canonical = toCanonicalNiche(prop);
    return target[canonical] || target.general;
  }
});

export const DEFAULT_NICHE: CanonicalBusinessType = "general";

export function getStoredNiche(): CanonicalBusinessType {
  if (typeof window === "undefined") return DEFAULT_NICHE;
  const saved = localStorage.getItem("crm_niche");
  if (saved) return toCanonicalNiche(saved);
  return DEFAULT_NICHE;
}

export function setStoredNiche(niche: BusinessNiche): void {
  if (typeof window === "undefined") return;
  const canonical = toCanonicalNiche(niche);
  localStorage.setItem("crm_niche", canonical);
  window.dispatchEvent(new CustomEvent("crm_niche_changed", { detail: canonical }));
}

/**
 * Single Source of Truth: Loads business profile from backend.
 * Caches in localStorage as secondary fallback.
 */
export async function fetchBusinessProfile(): Promise<{ type: CanonicalBusinessType; name: string; timezone: string }> {
  try {
    const res = await apiFetch("/api/company/profile");
    if (res?.success && res.data?.type) {
      const canonical = toCanonicalNiche(res.data.type);
      if (typeof window !== "undefined") {
        localStorage.setItem("crm_niche", canonical);
      }
      return {
        type: canonical,
        name: res.data.name || "Minha Empresa",
        timezone: res.data.timezone || "Africa/Maputo"
      };
    }
  } catch (err) {
    console.warn("[Niches] Could not fetch remote business profile, falling back to local:", err);
  }
  return {
    type: getStoredNiche(),
    name: "Minha Empresa",
    timezone: "Africa/Maputo"
  };
}

/**
 * Updates business profile both on backend and in local state.
 */
export async function saveBusinessProfile(type: BusinessNiche, name?: string, timezone?: string): Promise<boolean> {
  const canonical = toCanonicalNiche(type);
  setStoredNiche(canonical);
  try {
    const res = await apiFetch("/api/company/profile", {
      method: "PUT",
      body: JSON.stringify({ type: canonical, name, timezone })
    });
    return !!res?.success;
  } catch (err) {
    console.error("[Niches] Error saving business profile to backend:", err);
    return false;
  }
}
