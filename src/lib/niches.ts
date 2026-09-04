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
} from "lucide-react";

export type BusinessNiche = "clinica" | "vendas" | "servicos" | "geral";

export interface NicheConfig {
  id: BusinessNiche;
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

export const NICHE_CONFIGS: Record<BusinessNiche, NicheConfig> = {
  clinica: {
    id: "clinica",
    label: "Clínica & Saúde",
    badge: "Modo Consultório & Pacientes",
    icon: Stethoscope,
    tagline: "Gestão de consultas, triagem de pacientes e confirmações automáticas.",
    description: "Ideal para clínicas médicas, dentistas, psicólogos, consultórios e laboratórios que precisam gerenciar horários e pacientes.",
    features: ["Triagem de Pacientes", "Lembretes de Consultas", "Confirmação Automática", "Fila de Espera"],
    kpi1: { label: "Consultas Agendadas", icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Pacientes em Espera", icon: Stethoscope, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Lembretes de Consulta", icon: BellRing, color: "text-purple-600", bg: "bg-purple-50" },
    leadsTitle: "Próximas Consultas & Pacientes em Espera",
    leadsSubtitle: "Pacientes que iniciaram triagem ou solicitaram agendamento",
    emptyLeadsText: "Nenhum paciente aguardando atendimento no momento.",
    quickActions: [
      { label: "Novo Agendamento", icon: CalendarPlus, path: "/schedule", isPrimary: true },
      { label: "Atender Paciente", icon: MessageSquare, path: "/messages" },
      { label: "Disparar Lembretes", icon: BellRing, path: "/schedule" },
      { label: "Triagem Inteligente (IA)", icon: Bot, path: "/agent" },
    ]
  },
  vendas: {
    id: "vendas",
    label: "Vendas & CRM",
    badge: "Modo Comercial & Pipeline",
    icon: TrendingUp,
    tagline: "Funil de vendas, valor de oportunidades e fechamento de negócios.",
    description: "Ideal para lojas, corretores, agências, distribuidores e equipas de vendas focadas em fechar propostas e converter leads.",
    features: ["Pipeline Comercial", "Oportunidades Quentes", "Disparos Promocionais", "Atendente IA de Vendas"],
    kpi1: { label: "Pipeline Comercial", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Leads em Negociação", icon: UserPlus, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Ações da IA Comercial", icon: Zap, color: "text-amber-600", bg: "bg-amber-50" },
    leadsTitle: "Oportunidades Quentes do Funil",
    leadsSubtitle: "Leads com maior probabilidade de conversão nas últimas horas",
    emptyLeadsText: "Nenhum lead em negociação aberta no momento.",
    quickActions: [
      { label: "Cadastrar Lead", icon: UserPlus, path: "/leads", isPrimary: true },
      { label: "Abrir Conversas", icon: MessageSquare, path: "/messages" },
      { label: "Disparo em Massa", icon: Send, path: "/schedule" },
      { label: "Agente de Vendas (IA)", icon: Bot, path: "/agent" },
    ]
  },
  servicos: {
    id: "servicos",
    label: "Serviços & Estética",
    badge: "Modo Agendamentos & Salão",
    icon: Scissors,
    tagline: "Agendamento de horários, atendimento a clientes e fidelização.",
    description: "Ideal para barbearias, salões de beleza, spas, personal trainers e profissionais liberais que atendem por marcação.",
    features: ["Marcação de Sessões", "Cardápio de Serviços", "Avisos por WhatsApp", "Histórico de Clientes"],
    kpi1: { label: "Horários Marcados", icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
    kpi2: { label: "Clientes Atendidos", icon: UserCheck, color: "text-blue-600", bg: "bg-blue-50" },
    kpi3: { label: "Automações de Menu", icon: Activity, color: "text-purple-600", bg: "bg-purple-50" },
    leadsTitle: "Próximos Agendamentos de Clientes",
    leadsSubtitle: "Clientes que reservaram serviços pelo WhatsApp",
    emptyLeadsText: "Nenhum agendamento pendente no momento.",
    quickActions: [
      { label: "Novo Horário", icon: CalendarPlus, path: "/schedule", isPrimary: true },
      { label: "Ver Conversas", icon: MessageSquare, path: "/messages" },
      { label: "Cardápio de Serviços", icon: Activity, path: "/menus" },
      { label: "Assistente 24h (IA)", icon: Bot, path: "/agent" },
    ]
  },
  geral: {
    id: "geral",
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
      { label: "Configurar Robô", icon: Bot, path: "/agent" },
    ]
  }
};

export const DEFAULT_NICHE: BusinessNiche = "clinica";

export function getStoredNiche(): BusinessNiche {
  if (typeof window === "undefined") return DEFAULT_NICHE;
  const saved = localStorage.getItem("crm_niche") as BusinessNiche;
  if (saved && NICHE_CONFIGS[saved]) return saved;
  return DEFAULT_NICHE;
}

export function setStoredNiche(niche: BusinessNiche): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("crm_niche", niche);
  window.dispatchEvent(new CustomEvent("crm_niche_changed", { detail: niche }));
}
