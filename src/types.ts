export type Plan = 'Free' | 'Basic' | 'Pro' | 'Premium' | 'Admin';

export interface Subscription {
  id: string;
  user_id: string;
  plan: Plan;
  messages_used: number;
  automations_used: number;
  end_date: string;
}

export type LeadStage = 
  | 'novo'
  | 'em_atendimento'
  | 'proposta_enviada'
  | 'venda_fechada'
  | 'perdido';

export interface LeadStageConfig {
  id: LeadStage;
  label: string;
  color: string;
  bgLight: string;
  borderColor: string;
}

export const LEAD_STAGES: LeadStageConfig[] = [
  { id: 'novo', label: 'Novo Contacto', color: 'text-blue-600', bgLight: 'bg-blue-50', borderColor: 'border-blue-200' },
  { id: 'em_atendimento', label: 'Em Atendimento', color: 'text-amber-600', bgLight: 'bg-amber-50', borderColor: 'border-amber-200' },
  { id: 'proposta_enviada', label: 'Proposta Enviada', color: 'text-purple-600', bgLight: 'bg-purple-50', borderColor: 'border-purple-200' },
  { id: 'venda_fechada', label: 'Venda Fechada', color: 'text-emerald-600', bgLight: 'bg-emerald-50', borderColor: 'border-emerald-200' },
  { id: 'perdido', label: 'Perdido', color: 'text-rose-600', bgLight: 'bg-rose-50', borderColor: 'border-rose-200' },
];

export interface Contact {
  id: string;
  user_id: string;
  phone: string;
  name: string;
  tags?: string[];
  notes?: string;
  ai_paused?: boolean;
  ai_paused_at?: string;
  unread_count?: number;
  last_message_at?: string;
  last_message_text?: string;
  created_at?: string;
}

export interface Lead {
  id: string;
  user_id: string;
  contact_id?: string;
  phone: string;
  name?: string;
  last_message?: string;
  intent?: string;
  last_action?: string;
  status?: string;
  stage: LeadStage;
  value?: number;
  source?: string;
  assigned_to?: string;
  notes?: string;
  follow_up_date?: string;
  created_at?: string;
  updated_at?: string;
  contacts?: Contact;
}

export interface Message {
  id: string;
  user_id: string;
  contact_id: string;
  text: string;
  type: 'inbound' | 'outbound';
  msg_id?: string;
  media_url?: string;
  media_type?: string;
  media_mimetype?: string;
  media_filename?: string;
  is_automated?: boolean;
  automation_id?: string;
  is_read?: boolean;
  timestamp: string;
  contacts?: Contact;
}
