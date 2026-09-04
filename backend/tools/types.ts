export type UserRole = "admin" | "lead";

export interface ToolContext {
  userId: string;
  phone: string;
  jid: string;
  role: UserRole;
  whatsappManager: any;
  userPhone?: string;
}

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
}

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: "crm" | "messaging" | "automations" | "scheduling" | "dashboard";
  allowedRoles: UserRole[]; // Who can trigger this tool: admin only or both admin and lead
  parameters: ToolParametersSchema;
  execute: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}
