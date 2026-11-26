import express, { type Response } from "express";
import multer from "multer";
import type { AuthRequest } from "../middleware/auth.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { whatsappManager } from "../whatsappManager.ts";
import { canPostInGroup, isGroupJid } from "../services/groupModeration.ts";
import { scheduleDeadline, scheduleUuid, writableScheduleGroup, disconnectedSchedule } from "../services/schedulePolicy.ts";
import { dispatchScheduled } from "../services/scheduledDispatch.ts";
import { CATALOG_CAPTION_LIMIT, CATALOG_COVER_LIMIT, campaignCode, campaignMessage, catalogCoverType,
  loadCatalogCover, merchantCampaignPhone, ownedCatalogCover, storeCatalogCover } from "../services/catalogCampaigns.ts";

const campaigns = express.Router();
const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CATALOG_COVER_LIMIT, files: 1 } }).single("image");

function unavailable(res: Response, error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "P0002") return res.status(409).json({ error: "O produto precisa de fotografia, preço e stock disponível." });
  if (code === "23505") return res.status(409).json({ error: "Este pedido já foi usado para outra publicação. Consulta as campanhas." });
  if (code === "22023") return res.status(400).json({ error: "Confirma os dados e a data da campanha." });
  if (["PGRST202", "PGRST205", "42P01", "42703"].includes(code ?? "")) {
    return res.status(503).json({ error: "A gestão de campanhas precisa da migração 29." });
  }
  return res.status(503).json({ error: "Não foi possível concluir a operação da campanha." });
}

const campaignProducts = (userId: string) => supabaseAdmin.from("products").select("id,name,price,currency,stock,catalog_cover_path")
  .eq("user_id", userId).eq("is_active", true).gt("price", 0).gt("stock", 0);

type CampaignState = { id: string; scheduleId?: string | null; created: boolean; status: string };

function campaignStatus(publishedAt?: string | null, jobStatus?: string | null) {
  return publishedAt ? "sent" : (jobStatus === "sent" ? "failed" : jobStatus ?? "cancelled");
}

async function existingCampaignRequest(userId: string, requestKey: string, productId: string, groupJid: string, caption: string): Promise<CampaignState | null> {
  const signal = AbortSignal.timeout(8_000);
  const { data, error } = await supabaseAdmin.from("agentx_catalog_campaigns").select("id,product_id,group_jid,caption,published_at")
    .eq("user_id", userId).eq("request_key", requestKey).abortSignal(signal).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.product_id !== productId || data.group_jid !== groupJid || data.caption !== caption) throw { code: "23505" };
  const job = await supabaseAdmin.from("scheduled_messages").select("id,status").eq("user_id", userId).eq("campaign_id", data.id)
    .abortSignal(signal).maybeSingle();
  if (job.error) throw job.error;
  return { id: data.id, scheduleId: job.data?.id, created: false, status: campaignStatus(data.published_at, job.data?.status) };
}

async function completeCampaignRequest(res: Response, userId: string, campaign: CampaignState, publishNow: boolean) {
  const responseCode = campaign.created ? 201 : 200;
  if (publishNow && campaign.status === "pending" && campaign.scheduleId) {
    try {
      const result = await dispatchScheduled("scheduled_messages", campaign.scheduleId, userId, new Date().toISOString());
      if (result.status) return res.status(responseCode).json({ success: true, id: campaign.id, status: result.status, warning: result.error });
    } catch {
      // The Agenda claim remains authoritative if delivery or the response cannot be confirmed.
      return res.status(responseCode).json({ success: true, id: campaign.id, status: "queued" });
    }
  }
  return res.status(responseCode).json({ success: true, id: campaign.id, status: campaign.status });
}

function scheduledCampaignTime(value: unknown) {
  const time = typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN;
  const now = Date.now();
  return time > now && time <= now + 180 * 24 * 60 * 60_000 ? new Date(time).toISOString() : null;
}

async function campaignDestinations(userId: string) {
  try {
    const groups = await scheduleDeadline(whatsappManager.getGroups(userId), 8_000);
    const identity = whatsappManager.getMe(userId);
    const phone = merchantCampaignPhone(identity);
    if (!phone) return { groups: [], whatsappError: "Não foi possível confirmar o número do WhatsApp desta conta." };
    return { groups: Object.values(groups).filter((group) => isGroupJid(group.id) && canPostInGroup(group, identity))
      .map(({ id, subject }) => ({ id, name: subject || id })).sort((left, right) => left.name.localeCompare(right.name, "pt-MZ")) };
  } catch (error) {
    return { groups: [], whatsappError: disconnectedSchedule(error)
      ? "Liga o WhatsApp para escolher um grupo." : "Não foi possível consultar os teus grupos de WhatsApp." };
  }
}

campaigns.get("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para consultar as campanhas." });
  try {
    const signal = AbortSignal.timeout(8_000);
    const [products, recent, destinations] = await Promise.all([
      campaignProducts(userId).order("name").limit(100).abortSignal(signal),
      supabaseAdmin.from("agentx_catalog_campaigns").select("id,product_name,group_name,scheduled_at,published_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(30).abortSignal(signal),
      campaignDestinations(userId)
    ]);
    if (products.error || recent.error) throw products.error ?? recent.error;
    const entries = recent.data ?? [];
    const jobs = entries.length ? await supabaseAdmin.from("scheduled_messages").select("id,campaign_id,status,scheduled_at,error")
      .eq("user_id", userId).in("campaign_id", entries.map(({ id }) => id)).abortSignal(AbortSignal.timeout(8_000)) : null;
    if (jobs?.error) throw jobs.error;
    const jobByCampaign = new Map((jobs?.data ?? []).map((row) => [row.campaign_id, row]));
    return res.set("Cache-Control", "no-store").json({ success: true, data: {
      products: (products.data ?? []).map(({ catalog_cover_path, ...product }) => ({ ...product, hasCover: ownedCatalogCover(userId, catalog_cover_path) })),
      ...destinations,
      schedulerEnabled: process.env.DISABLE_SCHEDULER !== "true",
      campaigns: entries.map((entry) => {
        const job = jobByCampaign.get(entry.id);
        return { ...entry, scheduled_at: job?.scheduled_at ?? entry.scheduled_at,
          status: campaignStatus(entry.published_at, job?.status),
          error: job?.error ?? null };
      })
    } });
  } catch (error) {
    return unavailable(res, error);
  }
});

campaigns.get("/products/:id/cover", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para consultar a fotografia." });
  if (!scheduleUuid.test(req.params.id)) return res.status(404).json({ error: "Produto não encontrado." });
  try {
    const { data, error } = await supabaseAdmin.from("products").select("catalog_cover_path")
      .eq("id", req.params.id).eq("user_id", userId).eq("is_active", true)
      .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) throw error;
    const cover = await loadCatalogCover(userId, data?.catalog_cover_path);
    if (!cover) return res.status(404).json({ error: "A fotografia não está disponível." });
    return res.set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").type(cover.mimetype).send(cover.image);
  } catch (error) {
    return unavailable(res, error);
  }
});

campaigns.post("/products/:id/cover", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para guardar a fotografia." });
  if (!scheduleUuid.test(req.params.id)) return res.status(404).json({ error: "Produto não encontrado." });
  coverUpload(req, res, async (uploadError) => {
    if (uploadError || !req.file || !catalogCoverType(req.file.buffer)) {
      return res.status(400).json({ error: "Escolhe uma imagem JPEG, PNG ou WebP de até 5 MiB." });
    }
    try {
      if (!await storeCatalogCover(userId, req.params.id, req.file.buffer)) {
        return res.status(409).json({ error: "O produto ficou indisponível ou foi alterado. Atualiza o catálogo." });
      }
      return res.json({ success: true });
    } catch (error) {
      return unavailable(res, error);
    }
  });
});

campaigns.post("/preview", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para rever a campanha." });
  const { productId, caption = "" } = req.body ?? {};
  if (typeof productId !== "string" || !scheduleUuid.test(productId) ||
      typeof caption !== "string" || caption.trim().length > CATALOG_CAPTION_LIMIT) {
    return res.status(400).json({ error: "Seleciona um produto e confirma o texto da campanha." });
  }
  try {
    const { data, error } = await campaignProducts(userId).eq("id", productId).abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) throw error;
    if (!data || !ownedCatalogCover(userId, data.catalog_cover_path)) return unavailable(res, { code: "P0002" });
    return res.set("Cache-Control", "no-store").json({ success: true, preview: campaignMessage(data, caption.trim(), "") });
  } catch (error) {
    return unavailable(res, error);
  }
});

campaigns.post("/", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para publicar uma campanha." });
  const { productId, groupJid, requestKey, publishNow, scheduledAt, caption = "" } = req.body ?? {};
  if (typeof productId !== "string" || !scheduleUuid.test(productId) || typeof requestKey !== "string" || !scheduleUuid.test(requestKey) ||
    typeof groupJid !== "string" || !isGroupJid(groupJid) || typeof publishNow !== "boolean" ||
    typeof caption !== "string" || caption.trim().length > CATALOG_CAPTION_LIMIT) {
    return res.status(400).json({ error: "Seleciona um produto, um grupo e um horário válidos." });
  }
  try {
    const existing = await existingCampaignRequest(userId, requestKey, productId, groupJid, caption.trim());
    if (existing) return await completeCampaignRequest(res, userId, existing, publishNow);
    const when = publishNow ? new Date().toISOString() : scheduledCampaignTime(scheduledAt);
    if (!when) return res.status(400).json({ error: "Escolhe uma data futura dentro dos próximos 180 dias." });
    if (!publishNow && process.env.DISABLE_SCHEDULER === "true") {
      return res.status(409).json({ error: "A Agenda automática está desligada. Podes publicar agora." });
    }
    const group = await writableScheduleGroup(userId, groupJid);
    if (!group || group.id !== groupJid) return res.status(403).json({ error: "A conta ligada não pode publicar nesse grupo." });
    const phone = merchantCampaignPhone(whatsappManager.getMe(userId));
    if (!phone) return res.status(409).json({ error: "Confirma o número ligado ao WhatsApp antes de publicar." });
    const { data: campaign, error } = await supabaseAdmin.rpc("agentx_queue_catalog_campaign", {
      p_user: userId, p_key: requestKey, p_product: productId, p_group: groupJid, p_group_name: (group.subject || groupJid).trim().slice(0, 200),
      p_merchant_phone: phone, p_code: campaignCode(), p_caption: caption.trim(), p_when: when
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    if (!campaign?.id || !campaign.status) throw new Error("Campaign persistence unconfirmed");
    return await completeCampaignRequest(res, userId, campaign, publishNow);
  } catch (error) {
    if (disconnectedSchedule(error)) return res.status(409).json({ error: "Liga o WhatsApp antes de publicar num grupo." });
    return unavailable(res, error);
  }
});

async function updateCampaignSchedule(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para gerir o agendamento." });
  if (!scheduleUuid.test(req.params.id)) return res.status(400).json({ error: "Campanha inválida." });
  const deleting = req.method === "DELETE";
  const when = deleting ? null : scheduledCampaignTime(req.body?.scheduledAt);
  if (!deleting && !when) return res.status(400).json({ error: "Escolhe uma data futura dentro dos próximos 180 dias." });
  if (!deleting && process.env.DISABLE_SCHEDULER === "true") return res.status(409).json({ error: "A Agenda automática está desligada." });

  try {
    const table = supabaseAdmin.from("scheduled_messages");
    const mutation = deleting ? table.delete() : table.update({ scheduled_at: when, error: null, retry_at: null });
    const { data, error } = await mutation.eq("campaign_id", req.params.id).eq("user_id", userId).eq("status", "pending")
      .select("id").abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) throw error;
    if (!data?.id) return res.status(409).json({ error: "A campanha não está disponível na fila de agendamentos." });
    return res.json({ success: true, status: deleting ? "cancelled" : "pending" });
  } catch (error) {
    return unavailable(res, error);
  }
}

campaigns.patch("/:id/schedule", updateCampaignSchedule);
campaigns.delete("/:id/schedule", updateCampaignSchedule);

campaigns.get("/lead-origins/:id", async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Inicia sessão para consultar a origem do lead." });
  if (!scheduleUuid.test(req.params.id)) return res.status(400).json({ error: "Lead inválido." });
  try {
    const { data, error } = await supabaseAdmin.from("agentx_catalog_campaign_interests")
      .select("created_at,agentx_catalog_campaigns!inner(id,product_name,group_name)")
      .eq("user_id", userId).eq("lead_id", req.params.id).eq("agentx_catalog_campaigns.user_id", userId)
      .order("created_at", { ascending: false }).limit(5).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw error;
    const campaignIds = (data ?? []).map((entry) => (entry.agentx_catalog_campaigns as unknown as { id: string }).id);
    const orders = campaignIds.length ? await supabaseAdmin.from("orders").select("catalog_campaign_id,order_number")
      .eq("user_id", userId).eq("lead_id", req.params.id).in("catalog_campaign_id", campaignIds)
      .order("created_at", { ascending: false }).limit(20).abortSignal(AbortSignal.timeout(8_000)) : null;
    if (orders?.error) throw orders.error;
    return res.set("Cache-Control", "no-store").json({ success: true, data: data ?? [], orders: orders?.data ?? [] });
  } catch (error) {
    return unavailable(res, error);
  }
});

export default campaigns;
