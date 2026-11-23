import type { Express } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth.ts";
import type { DeliveryWorkerState } from "../services/digitalDeliveryWorker.ts";
import { makePlatformChecks } from "../services/platformChecks.ts";

type Dependencies = {
  databaseConfigured: boolean;
  frontendReady: () => boolean;
  release: string | null;
  schedulerEnabled: boolean;
  whatsappStatus: (userId: string) => string | undefined;
  deliveryStatus: () => { state: DeliveryWorkerState; lastSuccessAt: string | null };
};

export function registerOperations(app: Express, deps: Dependencies) {
  const checks = makePlatformChecks(deps.databaseConfigured);
  app.get("/api/ready", async (_req, res) => {
    const crm = await checks.check("crm");
    const frontend = deps.frontendReady();
    const ready = crm === "ready" && frontend;
    res.set("Cache-Control", "no-store").status(ready ? 200 : 503).json({ ready, release: deps.release });
  });

  app.get("/api/operations", authenticate, async (req: AuthRequest, res) => {
    if (!req.user?.id) return res.status(401).json({ error: "Inicia sessão para ver o estado da operação." });
    const modules = await checks.all();
    res.set("Cache-Control", "no-store").json({
      success: true, release: deps.release, modules,
      whatsapp: deps.whatsappStatus(req.user.id) ?? "disconnected",
      schedulerEnabled: deps.schedulerEnabled, deliveryWorker: deps.deliveryStatus()
    });
  });
}
