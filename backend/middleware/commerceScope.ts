import type { RequestHandler } from "express";
import type { SellerTeamRole } from "../../shared/sellerTeam.ts";
import type { AuthRequest } from "./auth.ts";
import { resolveSellerTeamAccess } from "../services/sellerTeam.ts";

type CommerceScope = {
  actorId: string;
  accountId: string;
  organizationId: string | null;
  role: SellerTeamRole;
  name?: string;
};

export type CommerceRequest = AuthRequest & { commerce?: CommerceScope };

const organizationIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const loadCommerceScope: RequestHandler = async (req: CommerceRequest, res, next) => {
  const actorId = req.user?.id;
  if (!actorId) {
    res.status(401).json({ error: "Inicia sessão para aceder aos pedidos." });
    return;
  }
  res.set("Cache-Control", "no-store");
  const selector = req.get("x-agentx-company");
  if (selector === undefined) {
    req.commerce = { actorId, accountId: actorId, organizationId: null, role: "owner" };
    next();
    return;
  }
  if (!organizationIdPattern.test(selector)) {
    res.status(400).json({ error: "Empresa inválida." });
    return;
  }
  try {
    const access = await resolveSellerTeamAccess(actorId, selector.toLowerCase());
    if (!access) {
      res.status(403).json({ error: "O teu acesso a esta empresa já não está disponível." });
      return;
    }
    req.commerce = { ...access, actorId };
    next();
  } catch {
    res.status(503).json({ error: "Não foi possível verificar as permissões da empresa. Tenta novamente." });
  }
};

export function requireCommerceRole(...roles: SellerTeamRole[]): RequestHandler {
  return (req: CommerceRequest, res, next) => {
    if (req.commerce && roles.includes(req.commerce.role)) return next();
    res.status(403).json({ error: "O teu papel na empresa não permite esta operação." });
  };
}
