import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { groupParticipant, isGroupAdmin, isGroupJid } from "./groupModeration.ts";
import { scheduleDeadline } from "./schedulePolicy.ts";

type Claim = { user_id: string; group_jid: string; claim_token: string; announce: boolean };
type Outcome = "confirmed" | "retry" | "no_permission" | "failed";

async function applyGroupAccess({ user_id: user, group_jid: jid, announce }: Claim): Promise<Outcome> {
  if (!isGroupJid(jid)) return "failed";
  try {
    const group = await scheduleDeadline(whatsappManager.getGroupMetadata(user, jid), 8_000);
    if (group.id !== jid) return "failed";
    const identity = whatsappManager.getMe(user);
    if (!isGroupAdmin(groupParticipant(group, identity?.id, identity?.lid, identity?.phoneNumber))) return "no_permission";
    // This also reconciles an earlier acknowledgement lost after the provider applied a setting.
    if (group.announce === announce) return "confirmed";

    await scheduleDeadline(whatsappManager.updateGroupAccess(user, jid, "announce", announce), 45_000);
    const updated = await scheduleDeadline(whatsappManager.getGroupMetadata(user, jid), 8_000);
    if (updated.id !== jid) return "failed";
    return updated.announce === announce ? "confirmed" : "retry";
  } catch {
    return "retry";
  }
}

export async function processGroupAccessSchedules(now = new Date()) {
  const { data, error } = await supabaseAdmin.rpc("agentx_claim_group_hours", { p_now: now.toISOString() })
    .abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  await Promise.all(((data ?? []) as Claim[]).map(async (claim) => {
    const outcome = await applyGroupAccess(claim);
    const { error: finishError } = await supabaseAdmin.rpc("agentx_finish_group_hours", {
      p_user: claim.user_id, p_group: claim.group_jid, p_claim: claim.claim_token,
      p_outcome: outcome, p_now: new Date().toISOString(),
    }).abortSignal(AbortSignal.timeout(8_000));
    if (finishError) console.warn("[Groups] Could not record the scheduled access result", finishError.code);
  }));
}
