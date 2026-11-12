import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { commerceService } from "../../services/commerceService.ts";

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
      category: {
        type: "string",
        description: "Categoria opcional para filtrar produtos (ex: 'Pacotes', 'Cursos', 'Serviços')"
      }
    }
  },
  execute: async (args: { category?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const products = await commerceService.listProducts(ctx.userId, args.category);

      if (!products || products.length === 0) {
        return {
          success: true,
          message: "Nenhum produto cadastrado no momento.",
          data: []
        };
      }

      const formatted = products.map((p: any) => ({
        id: p.id,
        name: p.name,
        price: `${p.price} ${p.currency || "MT"}`,
        category: p.category,
        description: p.description,
        stock: p.stock
      }));

      return {
        success: true,
        message: `${products.length} produtos encontrados no catálogo.`,
        data: formatted
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao consultar catálogo: ${err.message}`,
        error: err.message
      };
    }
  }
};

