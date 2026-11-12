import { ToolDefinition, ToolContext, ToolResult } from "../types.ts";
import { supabaseAdmin } from "../../supabaseAdmin.ts";

export const qualifyLeadTool: ToolDefinition = {
  name: "qualifyLead",
  description: "Atualiza a pontuação de interesse, etiquetas (tags) e notas comerciais de um lead qualificado.",
  category: "crm",
  allowedRoles: ["admin", "lead"],
  riskLevel: "low",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      phone: {
        type: "string",
        description: "Telefone do lead a ser qualificado (se omitido, usa o do contato atual)"
      },
      interestLevel: {
        type: "string",
        description: "Nível de interesse: 'alto', 'medio' ou 'baixo'",
        enum: ["alto", "medio", "baixo"]
      },
      tag: {
        type: "string",
        description: "Etiqueta comercial a adicionar (ex: 'Interessado em 5GB', 'VIP', 'Decisor')"
      },
      notes: {
        type: "string",
        description: "Resumo da necessidade identificada ou anotação comercial"
      }
    }
  },
  execute: async (args: { phone?: string; interestLevel?: string; tag?: string; notes?: string }, ctx: ToolContext): Promise<ToolResult> => {
    try {
      const targetPhone = (args.phone || ctx.phone).replace(/\D/g, "");

      // 1. Fetch contact
      const { data: contacts } = await supabaseAdmin
        .from("contacts")
        .select("id, name, tags, notes")
        .eq("user_id", ctx.userId)
        .or(`phone.eq.${targetPhone},phone.eq.258${targetPhone},phone.eq.${targetPhone.replace(/^258/, "")}`)
        .limit(1);

      const contact = contacts?.[0];

      if (contact) {
        const currentTags: string[] = Array.isArray(contact.tags) ? contact.tags : [];
        const newTags = args.tag ? Array.from(new Set([...currentTags, args.tag])) : currentTags;
        const currentNotes = contact.notes ? `${contact.notes}\n` : "";
        const updatedNotes = args.notes ? `${currentNotes}[Qualificação]: ${args.notes} (${args.interestLevel || "normal"})` : contact.notes;

        await supabaseAdmin
          .from("contacts")
          .update({
            tags: newTags,
            notes: updatedNotes
          })
          .eq("id", contact.id);
      }

      // 2. Update lead if exists
      const { data: leads } = await supabaseAdmin
        .from("leads")
        .select("id, notes")
        .eq("user_id", ctx.userId)
        .eq("phone", targetPhone)
        .limit(1);

      if (leads && leads.length > 0) {
        await supabaseAdmin
          .from("leads")
          .update({
            updated_at: new Date().toISOString()
          })
          .eq("id", leads[0].id);
      }

      return {
        success: true,
        message: `Lead ${targetPhone} qualificado com sucesso! Etiqueta "${args.tag || "N/A"}" registrada com nível de interesse ${args.interestLevel || "médio"}.`,
        data: {
          phone: targetPhone,
          tag: args.tag,
          interestLevel: args.interestLevel
        }
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro ao qualificar lead: ${err.message}`,
        error: err.message
      };
    }
  }
};

