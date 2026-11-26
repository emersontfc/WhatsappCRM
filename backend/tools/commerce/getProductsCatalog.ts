import { supabaseAdmin } from "../../supabaseAdmin.ts";
import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService, normalizeCatalogText } from "../../services/commerceService.ts";
import { salesToolFailure } from "../../services/salesToolFailure.ts";

export async function recordCatalogInterest(ctx: ToolContext) {
  if (ctx.role !== "lead" || !/^\d{8,15}$/.test(ctx.phone)) return;
  try {
    const { error } = await supabaseAdmin.rpc("agentx_capture_sales_lead", {
      p_user: ctx.userId, p_phone: ctx.phone, p_contact: ctx.contactId ?? null,
      p_name: ctx.contactName ?? null, p_activity: "catalog", p_message: ctx.incomingText ?? null
    }).abortSignal(AbortSignal.timeout(3_000));
    if (error) console.warn("[Catalog] Could not capture the sales lead", error.code);
  } catch {
    console.warn("[Catalog] Sales lead write unavailable");
  }
}

export const getProductsCatalogTool: ToolDefinition = {
  name: "getProductsCatalog",
  description: "Consulta o catálogo de produtos e serviços disponíveis com preços reais, estoque e categorias.",
  category: "commerce",
  allowedRoles: ["admin", "lead"],
  riskLevel: "low",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Nome do produto, mesmo sem acentos" },
      category: {
        type: "string",
        description: "Categoria opcional para filtrar produtos (ex: 'Pacotes', 'Cursos', 'Serviços')"
      }
    }
  },
  execute: async (args: { category?: string; search?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const category = typeof args.category === "string" ? normalizeCatalogText(args.category) : "";
      const search = typeof args.search === "string" ? normalizeCatalogText(args.search) : "";
      const products = (await commerceService.listAgentProducts(ctx.userId))
        .filter((product) => normalizeCatalogText(product.category || "").includes(category) &&
          normalizeCatalogText(product.name).includes(search));

      await recordCatalogInterest(ctx);
      if (products.length === 0) {
        return { success: true, message: "Nenhum produto corresponde à pesquisa.", data: [] };
      }

      const formatted = products.slice(0, 20).map((p) => ({
        id: p.id,
        name: p.name,
        price: `${p.price} ${p.currency || "MT"}`,
        category: p.category,
        description: String(p.description ?? "").slice(0, 180),
        stock: p.stock
      }));

      return {
        success: true,
        message: products.length > formatted.length
          ? "A mostrar os primeiros 20 produtos. Indique um nome ou categoria para refinar."
          : undefined,
        data: formatted
      };
    } catch (error) {
      return salesToolFailure("getProductsCatalog", error, "Não foi possível consultar o catálogo da loja.");
    }
  }
};

