import { supabaseAdmin } from "../supabaseAdmin.ts";

const stages = ["novo", "em_atendimento", "proposta_enviada", "venda_fechada", "perdido"] as const;
type ManualLeadStage = typeof stages[number];

export function manualLeadStage(value: unknown): ManualLeadStage | undefined {
  return stages.find((stage) => stage === value);
}

type SaveLead = {
  phone: string;
  contactId?: string | null;
  name?: string | null;
  stage?: ManualLeadStage;
  source?: "manual" | "whatsapp" | "ai" | "wa";
  value?: number | null;
  notes?: string | null;
  lastMessage?: string | null;
};

type SavedLead = {
  id: string;
  user_id: string;
  phone: string;
  contact_id: string | null;
  name: string | null;
  stage: ManualLeadStage;
  status: string;
};

export async function saveManualSalesLead(userId: string, input: SaveLead): Promise<SavedLead> {
  const { data, error } = await supabaseAdmin.rpc("agentx_save_manual_lead", {
    p_user: userId, p_phone: input.phone, p_contact: input.contactId ?? null,
    p_name: input.name ?? null, p_stage: input.stage ?? null, p_source: input.source ?? null,
    p_value: input.value ?? null, p_notes: input.notes ?? null, p_message: input.lastMessage ?? null,
    p_set_value: input.value !== undefined, p_set_notes: input.notes !== undefined
  });
  if (error) throw error;
  if (!data?.id) throw new Error("Lead write returned no identifier");
  return data;
}
