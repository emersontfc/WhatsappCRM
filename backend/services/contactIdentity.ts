import { supabaseAdmin } from "../supabaseAdmin.ts";

type ContactIdentity = {
  phone?: string | null;
  name?: string | null;
  lid?: string | null;
  tags?: string[];
  replaceName?: boolean;
  existingOnly?: boolean;
  maxContacts?: number;
};

type SavedContact = { id?: string; phone?: string | null; name?: string | null; created?: boolean; limited?: boolean };

export async function saveContactIdentity(userId: string, input: ContactIdentity): Promise<SavedContact | null> {
  const { data, error } = await supabaseAdmin.rpc("agentx_save_contact", {
    p_user_id: userId,
    p_phone: input.phone || null,
    p_name: input.name || null,
    p_lid: input.lid || null,
    p_tags: input.tags ?? [],
    p_replace_name: input.replaceName ?? false,
    p_existing_only: input.existingOnly ?? false,
    p_max_contacts: input.maxContacts ?? null
  });
  if (error) throw error;
  return data;
}
