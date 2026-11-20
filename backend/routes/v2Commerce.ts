import { randomUUID } from "node:crypto";
import express from "express";
import multer from "multer";
import type { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { parseMozambicanReceiptSMS } from "../services/paymentProofSms.ts";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SALES_ROLES = ["owner", "admin", "operator"];
const DIGITAL_BUCKET = "agentx-v2-digital";
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 } }).single("file");

function fail(res: express.Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

function databaseFailure(res: express.Response, error: { code?: string }) {
  switch (error.code) {
    case "42501": return fail(res, 403, "Organization access denied");
    case "P0002": return fail(res, 404, "Record not found");
    case "23505":
    case "P0001": return fail(res, 409, "Operation conflicts with an existing record or state");
    case "22023":
    case "23503":
    case "23514": return fail(res, 400, "Invalid operation data");
    default:
      console.error("[V2 Commerce] Database operation failed", { code: error.code });
      return fail(res, 503, "Commerce service unavailable");
  }
}

function handle(fn: (req: AuthRequest, res: express.Response) => Promise<unknown>): express.RequestHandler {
  return (req: AuthRequest, res, next) => {
    if (!req.user?.id) {
      fail(res, 401, "Authentication required");
      return;
    }
    res.set("Cache-Control", "no-store");
    void fn(req, res).catch(next);
  };
}

router.param("organizationId", (req, res, next, value) => {
  if (!UUID.test(value)) return fail(res, 400, "Invalid organization ID");
  req.params.organizationId = value.toLowerCase();
  next();
});
router.param("orderId", (_req, res, next, value) => {
  if (!UUID.test(value)) return fail(res, 400, "Invalid order ID");
  next();
});
router.param("proofId", (_req, res, next, value) => {
  if (!UUID.test(value)) return fail(res, 400, "Invalid proof ID");
  next();
});

router.get("/organizations", handle(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("organization_members")
    .select("organization_id,role,organizations!inner(name)")
    .eq("user_id", req.user!.id).eq("organizations.status", "active")
    .order("organization_id");
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data });
}));

router.get("/my-orders", handle(async (req, res) => {
  const { data, error } = await supabaseAdmin.from("agentx_orders")
    .select("id,organization_id,amount,currency,status,approved_at,settlement_reference,organizations!inner(name),agentx_digital_deliveries(order_id)")
    .eq("customer_user_id", req.user!.id).eq("organizations.status", "active")
    .order("created_at", { ascending: false }).order("id").limit(100);
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data });
}));

router.post("/organizations", handle(async (req, res) => {
  const { name, slug } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120 ||
      typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) {
    return fail(res, 400, "Invalid organization name or slug");
  }
  const { data, error } = await supabaseAdmin.rpc("agentx_create_organization", {
    p_actor: req.user!.id, p_name: name, p_slug: slug
  });
  if (error) return databaseFailure(res, error);
  return res.status(201).json({ success: true, data: { id: data } });
}));

router.put("/:organizationId/members/:memberId", handle(async (req, res) => {
  const { organizationId, memberId } = req.params;
  const { role } = req.body ?? {};
  if (!UUID.test(memberId) || (role !== null && !["admin", "finance_admin", "operator", "viewer"].includes(role))) {
    return fail(res, 400, "Invalid member or role");
  }
  const { error } = await supabaseAdmin.rpc("agentx_set_member", {
    p_org: organizationId, p_actor: req.user!.id, p_member: memberId, p_role: role
  });
  if (error) return databaseFailure(res, error);
  return res.sendStatus(204);
}));

router.post("/:organizationId/digital-assets", (req: AuthRequest, res, next) => {
  if (!req.user?.id) return fail(res, 401, "Authentication required");
  void Promise.resolve(supabaseAdmin.rpc("agentx_assert_role", {
    p_org: req.params.organizationId, p_actor: req.user.id, p_roles: SALES_ROLES
  })).then(({ error }) => {
    if (error) {
      databaseFailure(res, error);
      return;
    }
    upload(req, res, (uploadError) => {
      if (uploadError) {
        fail(res, uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400, "Invalid digital asset upload");
        return;
      }
      next();
    });
  }).catch(next);
}, handle(async (req, res) => {
  if (!req.file?.size) return fail(res, 400, "A digital asset file is required");
  const id = randomUUID();
  const { error } = await supabaseAdmin.storage.from(DIGITAL_BUCKET)
    .upload(`${req.params.organizationId}/${id}`, req.file.buffer, {
      contentType: "application/octet-stream", upsert: false
    });
  if (error) return fail(res, 503, "Digital asset could not be stored");
  return res.status(201).json({ success: true, data: { id } });
}));

router.put("/:organizationId/orders/:orderId", handle(async (req, res) => {
  const { organizationId, orderId } = req.params;
  const { customerId, customerPhone, amount, currency, digitalAssetId } = req.body ?? {};
  if (typeof customerId !== "string" || !UUID.test(customerId) ||
      typeof digitalAssetId !== "string" || !UUID.test(digitalAssetId) ||
      typeof customerPhone !== "string" || !/^\+?[1-9][0-9]{7,14}$/.test(customerPhone) ||
      typeof amount !== "string" || !/^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(amount) || amount === "0.00" ||
      typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return fail(res, 400, "Invalid digital order");
  }
  const { data, error } = await supabaseAdmin.rpc("agentx_create_digital_order", {
    p_org: organizationId, p_actor: req.user!.id, p_order: orderId, p_customer: customerId,
    p_phone: customerPhone, p_amount: amount, p_currency: currency, p_asset: digitalAssetId
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data: { id: data } });
}));

router.post("/:organizationId/orders/:orderId/payment-proofs", handle(async (req, res) => {
  const { organizationId, orderId } = req.params;
  const proof = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (proof.length < 10 || proof.length > 4000 || proof.includes("\0")) {
    return fail(res, 400, "Invalid payment proof text");
  }
  const extracted = parseMozambicanReceiptSMS(proof);
  const amount = extracted?.amount ?? 0;
  const { data, error } = await supabaseAdmin.rpc("agentx_submit_proof", {
    p_org: organizationId, p_order: orderId, p_actor: req.user!.id, p_text: proof,
    p_claimed_amount: amount > 0 && amount < 1e12 ? amount.toFixed(2) : null,
    p_reference: extracted?.transactionReference.slice(0, 100) || null
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data: { id: data } });
}));

const proofUpload = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single("file");

router.post("/:organizationId/orders/:orderId/proof-attachments", (req, res, next) => {
  proofUpload(req, res, (error) => {
    if (error) {
      fail(res, error.code === "LIMIT_FILE_SIZE" ? 413 : 400, "Invalid proof attachment");
      return;
    }
    next();
  });
}, handle(async (req, res) => {
  const bytes = req.file?.buffer;
  const signature = bytes?.subarray(0, 8).toString("hex") ?? "";
  const extension = signature.startsWith("ffd8ff") ? "jpg"
    : signature === "89504e470d0a1a0a" ? "png"
    : signature.startsWith("255044462d") ? "pdf" : null;
  if (!bytes || !extension) return fail(res, 400, "Choose a JPEG, PNG or PDF proof");
  const { data, error } = await supabaseAdmin.rpc("agentx_submit_proof_attachment", {
    p_org: req.params.organizationId, p_order: req.params.orderId, p_actor: req.user!.id,
    p_extension: extension, p_content: bytes.toString("base64")
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data: { id: data } });
}));

router.get("/:organizationId/payment-proofs/:proofId/attachment", handle(async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc("agentx_get_proof_attachment", {
    p_org: req.params.organizationId, p_proof: req.params.proofId, p_actor: req.user!.id
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data });
}));

router.get("/:organizationId/payment-proofs/pending", handle(async (req, res) => {
  const { organizationId } = req.params;
  const { data, error } = await supabaseAdmin.rpc("agentx_pending_proofs", {
    p_org: organizationId, p_actor: req.user!.id
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data });
}));

router.post("/:organizationId/payment-proofs/:proofId/review", handle(async (req, res) => {
  const { organizationId, proofId } = req.params;
  const { decision, note, settlementVerified, settlementMethod, settlementReference } = req.body ?? {};
  if (!["approve", "reject"].includes(decision)) return fail(res, 400, "Invalid decision");
  if (note !== undefined && (typeof note !== "string" || note.length > 1000 || note.includes("\0"))) {
    return fail(res, 400, "Invalid review note");
  }
  if (decision === "reject" && !note?.trim()) return fail(res, 400, "Rejection reason is required");
  const reference = typeof settlementReference === "string" ? settlementReference.trim().toUpperCase() : "";
  if (decision === "approve" && (settlementVerified !== true ||
      !["mpesa", "emola", "bank_transfer", "other"].includes(settlementMethod) ||
      !/^[A-Z0-9-]{4,100}$/.test(reference))) {
    return fail(res, 400, "Independent confirmation and verified settlement reference are required");
  }
  const { data, error } = await supabaseAdmin.rpc("agentx_review_payment", {
    p_organization_id: organizationId,
    p_proof_id: proofId,
    p_actor_id: req.user!.id,
    p_decision: decision,
    p_note: (note ?? "").trim(),
    p_settlement_method: decision === "approve" ? settlementMethod : null,
    p_settlement_reference: decision === "approve" ? reference : null
  });
  if (error) return databaseFailure(res, error);
  return res.json({ success: true, data });
}));

router.get("/:organizationId/orders/:orderId/download", handle(async (req, res) => {
  const { organizationId, orderId } = req.params;
  const { data: path, error } = await supabaseAdmin.rpc("agentx_get_digital_asset", {
    p_org: organizationId, p_order: orderId, p_actor: req.user!.id
  });
  if (error) return databaseFailure(res, error);
  if (typeof path !== "string" || !path.startsWith(`${organizationId}/`)) {
    return fail(res, 404, "Digital delivery not found");
  }
  const { data: signed, error: signingError } = await supabaseAdmin.storage.from(DIGITAL_BUCKET)
    .createSignedUrl(path, 60, { download: true });
  if (signingError) return fail(res, 503, "Digital download unavailable");
  return res.json({ success: true, data: { url: signed.signedUrl, expiresIn: 60 } });
}));

router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  console.error("[V2 Commerce] Unhandled request failure", err instanceof Error ? err.name : "unknown");
  return fail(res, 503, "Commerce service unavailable");
});

export default router;
