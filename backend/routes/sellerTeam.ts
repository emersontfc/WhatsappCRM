import express, { type Response } from "express";
import type { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { isSellerTeamRole, parseSellerTeamAccess, resolveSellerTeamAccess, sellerTeamId, sellerTeamTasks } from "../services/sellerTeam.ts";
import { retrySellerNotice } from "../services/sellerNotices.ts";

const routes = express.Router();

function failure(res: Response, error: unknown) {
  switch ((error as { code?: string } | null)?.code) {
    case "42501": return res.status(403).json({ error: "Sem acesso a esta empresa ou tarefa." });
    case "P0002": return res.status(404).json({ error: "Não foi possível encontrar o registo indicado. Confirma os dados com a equipa." });
    case "22023": return res.status(400).json({ error: "Confirma os dados indicados." });
    case "23505":
    case "P0001": return res.status(409).json({ error: "O estado mudou ou a empresa já está associada. Atualiza antes de repetir." });
    default: return res.status(503).json({ error: "Não foi possível concluir a operação da equipa. Atualiza para conferir o estado." });
  }
}

function action(handle: (req: AuthRequest, res: Response, actor: string) => Promise<unknown>): express.RequestHandler {
  return (req: AuthRequest, res) => {
    if (!req.user?.id) return res.status(401).json({ error: "Inicia sessão para consultar a equipa." });
    res.set("Cache-Control", "no-store");
    void handle(req, res, req.user.id).catch((error: unknown) => failure(res, error));
  };
}

for (const param of ["organizationId", "itemId"]) {
  routes.param(param, (req, res, next, value) => {
    if (!sellerTeamId.test(value)) return res.status(400).json({ error: "Identificador inválido." });
    req.params[param] = value.toLowerCase();
    next();
  });
}

routes.get("/companies", action(async (_req, res, actor) => {
  const { data, error } = await supabaseAdmin.rpc("agentx_seller_team_list", { p_actor: actor })
    .abortSignal(AbortSignal.timeout(6_000));
  if (error) throw error;
  return res.json({ success: true, data: (data ?? []).flatMap((row: any) =>
    isSellerTeamRole(row.role) && typeof row.name === "string" && sellerTeamId.test(row.organization_id)
      ? [{ organizationId: row.organization_id, name: row.name, role: row.role, linked: row.linked === true }] : []) });
}));

routes.post("/companies", action(async (req, res, actor) => {
  const { name, organizationId } = req.body ?? {};
  if (organizationId != null ? typeof organizationId !== "string" || !sellerTeamId.test(organizationId)
    : typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
    return res.status(400).json({ error: "Escolhe uma empresa ou indica um nome entre 2 e 120 caracteres." });
  }
  const { data, error } = await supabaseAdmin.rpc("agentx_link_seller_organization", {
    p_actor: actor, p_org: organizationId?.toLowerCase() ?? null, p_name: typeof name === "string" ? name.trim() : null
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  const access = parseSellerTeamAccess(data);
  if (!access) throw new Error("Company link was not acknowledged");
  return res.status(201).json({ success: true,
    data: { organizationId: access.organizationId, name: access.name, role: access.role, linked: true } });
}));

routes.get("/companies/:organizationId/members", action(async (req, res, actor) => {
  const { data, error } = await supabaseAdmin.rpc("agentx_seller_team_members", { p_actor: actor, p_org: req.params.organizationId })
    .abortSignal(AbortSignal.timeout(6_000));
  if (error) throw error;
  return res.json({ success: true, data: (data ?? []).flatMap((row: any) =>
    isSellerTeamRole(row.role) && typeof row.email === "string" && sellerTeamId.test(row.user_id)
      ? [{ userId: row.user_id, email: row.email, role: row.role }] : []) });
}));

routes.put("/companies/:organizationId/members", action(async (req, res, actor) => {
  const { email, memberId, role } = req.body ?? {};
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  const remove = role === null && typeof memberId === "string" && sellerTeamId.test(memberId);
  if (!remove && (!(role === "operator" || role === "finance_admin") || address.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
    return res.status(400).json({ error: "Indica o email da conta confirmada e escolhe uma função." });
  }
  const { error } = await supabaseAdmin.rpc("agentx_seller_team_set_member", {
    p_actor: actor, p_org: req.params.organizationId, p_role: role,
    p_email: remove ? null : address, p_member: remove ? memberId : null
  }).abortSignal(AbortSignal.timeout(8_000));
  if (error?.code === "P0002") return res.status(404).json({ error: "A conta indicada tem de existir no AgentX e ter o email confirmado." });
  if (error) throw error;
  return res.json({ success: true });
}));

routes.get(["/personal/tasks", "/companies/:organizationId/tasks"], action(async (req, res, actor) => {
  const organizationId = req.params.organizationId;
  const access = organizationId ? await resolveSellerTeamAccess(actor, organizationId) : { accountId: actor, role: "owner" } as const;
  if (!access) return failure(res, { code: "42501" });
  return res.json({ success: true, data: await sellerTeamTasks(access) });
}));

routes.post(["/personal/notices/:itemId/retry", "/companies/:organizationId/notices/:itemId/retry"], action(async (req, res, actor) => {
  const queued = await retrySellerNotice(actor, req.params.organizationId ?? null, req.params.itemId);
  if (!queued) return res.status(409).json({ error: "O aviso já mudou de estado. Atualiza a fila." });
  return res.json({ success: true });
}));

routes.post(["/personal/proof-events/:itemId/resolve", "/companies/:organizationId/proof-events/:itemId/resolve"], action(async (req, res, actor) => {
  const { data, error } = await supabaseAdmin.rpc("agentx_resolve_direct_proof_event", {
    p_actor: actor, p_org: req.params.organizationId ?? null, p_event: req.params.itemId
  }).abortSignal(AbortSignal.timeout(6_000));
  if (error) throw error;
  if (data !== true) return res.status(409).json({ error: "O comprovativo já mudou de estado. Atualiza a fila." });
  return res.json({ success: true });
}));

export default routes;
