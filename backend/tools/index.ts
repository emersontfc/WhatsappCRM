import { ToolDefinition, ToolContext, ToolResult, UserRole } from "./types.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";

// Import all tools
import { getPendingConversationsTool } from "./crm/getPendingConversations.ts";
import { getPipelineMetricsTool } from "./crm/getPipelineMetrics.ts";
import { searchContactTool } from "./crm/searchContact.ts";
import { moveLeadStageTool } from "./crm/moveLeadStage.ts";
import { createLeadTool } from "./crm/createLead.ts";
import { sendDirectMessageTool } from "./messaging/sendDirectMessage.ts";
import { pauseAITool } from "./messaging/pauseAI.ts";
import { resumeAITool } from "./messaging/resumeAI.ts";
import { createKeywordAutomationTool } from "./automations/createKeywordAutomation.ts";
import { createReminderFollowupTool } from "./automations/createReminderFollowup.ts";
import { scheduleMessageTool } from "./automations/scheduleMessage.ts";
import { scheduleStatusTool } from "./automations/scheduleStatus.ts";

export * from "./types.ts";

export const ALL_TOOLS: ToolDefinition[] = [
  getPendingConversationsTool,
  getPipelineMetricsTool,
  searchContactTool,
  moveLeadStageTool,
  createLeadTool,
  sendDirectMessageTool,
  pauseAITool,
  resumeAITool,
  createKeywordAutomationTool,
  createReminderFollowupTool,
  scheduleMessageTool,
  scheduleStatusTool,
];

/**
 * Returns tools available for a given user role (admin vs lead)
 */
export function getToolsForRole(role: UserRole): ToolDefinition[] {
  return ALL_TOOLS.filter(tool => tool.allowedRoles.includes(role));
}

/**
 * Generates a prompt-friendly catalog of tools with parameter specifications
 */
export function getToolsPromptDescription(role: UserRole): string {
  const tools = getToolsForRole(role);
  if (tools.length === 0) return "";

  const toolDescriptions = tools.map(t => {
    const params = JSON.stringify(t.parameters.properties, null, 2);
    return `• FERRAMENTA: "${t.name}"
  Descrição: ${t.description}
  Parâmetros aceitos: ${params}`;
  }).join("\n\n");

  return `\n\n=== FERRAMENTAS DO AGENTEX DISPONÍVEIS ===\nVocê tem acesso direto para acionar as seguintes ferramentas do sistema quando necessário:\n\n${toolDescriptions}\n
QUANDO VOCÊ DECIDIR USAR UMA FERRAMENTA:
Responda em formato JSON estruturado com os seguintes campos:
{
  "reply": "Texto explicativo ou confirmação que será lido pelo usuário",
  "tool": "nome_exato_da_ferramenta",
  "args": { /* argumentos correspondentes */ }
}

SE NÃO PRECISAR USAR NENHUMA FERRAMENTA:
Responda em JSON:
{
  "reply": "Sua resposta conversacional normal",
  "tool": null,
  "args": {}
}`;
}

/**
 * Safely executes a tool by name with scope, anti-loop cooldown and audit logging
 */
export async function executeToolByName(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
  const tool = ALL_TOOLS.find(t => t.name === name);

  if (!tool) {
    console.warn(`[Tool Registry] Tool "${name}" not found.`);
    return { success: false, message: `Ferramenta "${name}" não encontrada no sistema.` };
  }

  // 1. Role validation
  if (!tool.allowedRoles.includes(ctx.role)) {
    console.warn(`[Tool Registry] Access denied for role "${ctx.role}" to tool "${name}".`);
    return { success: false, message: `Permissão negada: seu nível de acesso não permite usar "${name}".` };
  }

  console.log(`[Tool Registry] Executing "${name}" for user ${ctx.userId} (Role: ${ctx.role}) with args:`, args);

  // 2. Audit logging
  try {
    await supabaseAdmin.from("agent_logs").insert({
      user_id: ctx.userId,
      phone: ctx.phone,
      action: name,
      data: args || {},
      created_at: new Date().toISOString()
    });
  } catch (logErr) {
    console.warn("[Tool Registry] Failed to insert agent log:", logErr);
  }

  // 3. Execution with scope isolation
  try {
    return await tool.execute(args || {}, ctx);
  } catch (err: any) {
    console.error(`[Tool Registry] Error executing tool "${name}":`, err);
    return {
      success: false,
      message: `Erro ao executar ferramenta "${name}".`,
      error: err.message
    };
  }
}
