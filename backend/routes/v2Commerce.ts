import express from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireFinanceRole(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const userId = req.user?.id;
  const organizationId = req.params.organizationId;
  if (!userId) return res.status(401).json({ success: false, error: "Authentication required" });
  if (!UUID.test(organizationId)) return res.status(400).json({ success: false, error: "Invalid organization ID" });
  try {
    const { data, error } = await supabaseAdmin.from("organization_members")
      .select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data || !["owner", "finance_admin"].includes(data.role)) {
      return res.status(403).json({ success: false, error: "Finance approver role required" });
    }
    return next();
  } catch (err) {
    console.error("[V2 Commerce] Access verification failed", err);
    return res.status(503).json({ success: false, error: "Unable to verify organization permissions" });
  }
}

router.get("/:organizationId/payment-proofs/pending", requireFinanceRole, async (req: AuthRequest, res) => {
  const { organizationId } = req.params;
  const { data, error } = await supabaseAdmin.from("agentx_payment_proofs")
    .select("id,order_id,claimed_amount,transaction_reference,created_at,status")
    .eq("organization_id", organizationId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(50);
  if (error) return res.status(503).json({ success: false, error: "Cannot retrieve payment queue" });
  return res.json({ success: true, data: data ?? [] });
});

router.post("/:organizationId/payment-proofs/:proofId/review", requireFinanceRole, async (req: AuthRequest, res) => {
  const { organizationId, proofId } = req.params;
  const actorId = req.user!.id;
  const { decision, note, settlementVerified } = req.body ?? {};
  if (!UUID.test(proofId) || !["approve", "reject"].includes(decision)) {
    return res.status(400).json({ success: false, error: "Invalid proof or decision" });
  }
  if (decision === "approve" && settlementVerified !== true) {
    return res.status(400).json({ success: false, error: "Independent confirmation of received funds is required" });
  }
  if (decision === "reject" && (typeof note !== "string" || !note.trim())) {
    return res.status(400).json({ success: false, error: "Rejection reason is required" });
  }
  if (note !== undefined && (typeof note !== "string" || note.length > 1000)) {
    return res.status(400).json({ success: false, error: "Invalid review note" });
  }
  // PostgreSQL function locks proof/order, authorizes membership and inserts outbox atomically.
  // Never send a deliverable directly in this HTTP request.
  const { data, error } = await supabaseAdmin.rpc("agentx_review_payment", {
    p_organization_id: organizationId,
    p_proof_id: proofId,
    p_actor_id: actorId,
    p_decision: decision,
    p_note: (note ?? "").trim()
  });
  if (error) {
    console.error("[V2 Commerce] Review refused", { code: error.code, message: error.message });
    return res.status(error.code === "P0001" ? 409 : 503)
      .json({ success: false, error: "Payment review failed or is no longer available" });
  }
  return res.json({ success: true, data });
});

export default router;
