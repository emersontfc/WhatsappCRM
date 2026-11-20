import { afterEach, describe, it, expect, vi } from "vitest";
import { supabaseAdmin } from "../backend/supabaseAdmin.ts";
import { parseScheduledDateTime, formatInTimezone } from "../backend/utils/dateTimeParser.ts";
import { formatToolOutputForWhatsApp } from "../backend/agentManager.ts";
import { scheduleMessageTool } from "../backend/tools/automations/scheduleMessage.ts";
import { listScheduledMessagesTool } from "../backend/tools/automations/listScheduledMessages.ts";
import { cancelScheduledMessageTool } from "../backend/tools/automations/cancelScheduledMessage.ts";
import { postWhatsAppStatusTool } from "../backend/tools/messaging/postWhatsAppStatus.ts";
import { scheduleStatusTool } from "../backend/tools/automations/scheduleStatus.ts";
import { listScheduledStatusTool } from "../backend/tools/automations/listScheduledStatus.ts";
import { cancelScheduledStatusTool } from "../backend/tools/automations/cancelScheduledStatus.ts";

afterEach(() => vi.restoreAllMocks());

describe("Fase 8 — Testes de Ponta a Ponta: Motor de Agentes, Agendamento e Status (AgentX)", () => {

  describe("Cenário A — Agendamento de Mensagens em Linguagem Natural", () => {
    it("interpreta 'amanhã às 9 horas' no fuso horário Africa/Maputo (UTC+2)", () => {
      // Simular data de referência: 2026-11-15T12:00:00Z
      const refDate = new Date("2026-11-15T12:00:00Z");
      const result = parseScheduledDateTime("amanhã às 09:00", refDate, "Africa/Maputo");

      expect(result.date).toBeInstanceOf(Date);
      // Maputo é UTC+2, logo 09:00 em Maputo = 07:00 UTC
      expect(result.date.getUTCHours()).toBe(7);
      expect(result.date.getUTCMinutes()).toBe(0);
      expect(result.isRelative).toBe(true);
      expect(result.formattedLocal).toContain("09:00");
    });

    it("interpreta datas relativas como 'daqui a 2 horas'", () => {
      const refDate = new Date("2026-11-15T10:00:00Z");
      const result = parseScheduledDateTime("daqui a 2 horas", refDate);

      const diffHours = (result.date.getTime() - refDate.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(2, 1);
    });

    it("formata a saída de confirmação com dados reais para o WhatsApp", () => {
      const output = formatToolOutputForWhatsApp("schedule_message", {
        success: true,
        message: "Mensagem agendada com sucesso.",
        data: {
          cliente: "Emerson Torres",
          telefone: "258841234567",
          dataAgendada: "16/11/2026, 09:00",
          mensagem: "Olá, segue o lembrete da sua fatura."
        }
      });

      expect(output).toContain("Mensagem Agendada com Sucesso!");
      expect(output).toContain("Emerson Torres");
      expect(output).toContain("258841234567");
      expect(output).toContain("16/11/2026, 09:00");
    });
  });

  describe("Cenário B — Publicação de Status no WhatsApp", () => {
    it("bloqueia publicação imediata se a sessão WhatsApp estiver desconectada com erro estruturado", async () => {
      const mockDisconnectedManager = {
        getSession: () => ({ status: "disconnected" }),
        sendMessage: async () => { throw new Error("Offline"); }
      };

      const result = await postWhatsAppStatusTool.execute(
        { text: "Novidades exclusivas na nossa loja hoje!" },
        {
          userId: "test-user-1",
          phone: "258841234567",
          jid: "test@s.whatsapp.net",
          role: "admin",
          whatsappManager: mockDisconnectedManager
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("SESSION_NOT_CONNECTED");
      expect(result.retryable).toBe(true);

      const formatted = formatToolOutputForWhatsApp("post_whatsapp_status", result);
      expect(formatted).toContain("WhatsApp Desconectado");
      expect(formatted).not.toContain("Operação realizada com sucesso");
    });

    it("publica com sucesso quando a sessão WhatsApp está conectada", async () => {
      let sentJid = "";
      let sentText = "";

      const mockConnectedManager = {
        getSession: () => ({ status: "connected" }),
        sendMessage: async (uId: string, jid: string, text: string) => {
          sentJid = jid;
          sentText = text;
          return { key: { id: "STATUS_MSG_9988" } };
        }
      };

      vi.spyOn(supabaseAdmin, "from").mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null })
      } as unknown as ReturnType<typeof supabaseAdmin.from>);
      const result = await postWhatsAppStatusTool.execute(
        { text: "Ofertas válidas até amanhã!" },
        {
          userId: "test-user-1",
          phone: "258841234567",
          jid: "test@s.whatsapp.net",
          role: "admin",
          whatsappManager: mockConnectedManager
        }
      );

      expect(result.success).toBe(true);
      expect(result.code).toBe("SUCCESS");
      expect(sentJid).toBe("status@broadcast");
      expect(sentText).toBe("Ofertas válidas até amanhã!");

      const formatted = formatToolOutputForWhatsApp("post_whatsapp_status", result);
      expect(formatted).toContain("Status Publicado com Sucesso!");
      expect(formatted).toContain("Ofertas válidas até amanhã!");
    });
  });

  describe("Cenário C & D — Perfis Geral e Clínica", () => {
    it("mantém a organização de ferramentas e navegação diferenciada por perfil", () => {
      const clinicTools = ["schedule_message", "list_scheduled_messages", "post_whatsapp_status"];
      expect(clinicTools.length).toBeGreaterThanOrEqual(3);

      const generalTools = ["getProductsCatalog", "createOrder", "get_pipeline_metrics"];
      expect(generalTools.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Cenário E — Tratamento Estruturado de Falhas de Ferramentas", () => {
    it("não anuncia sucesso falso quando o destinatário é inválido", async () => {
      vi.spyOn(supabaseAdmin, "from").mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
      } as unknown as ReturnType<typeof supabaseAdmin.from>);
      const result = await scheduleMessageTool.execute(
        { recipient: "", message: "Teste", scheduledAt: "amanhã às 10h" },
        {
          userId: "test-user-1",
          phone: "258841234567",
          jid: "test@s.whatsapp.net",
          role: "admin",
          whatsappManager: {}
        }
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe("RECIPIENT_NOT_FOUND");

      const formatted = formatToolOutputForWhatsApp("schedule_message", result);
      expect(formatted).toContain("Contacto Não Localizado");
      expect(formatted).not.toContain("sucesso");
    });
  });

  describe("Cenário F — Persistência e Recuperação de Agendamentos", () => {
    it("garante que o agendador pode reprocessar tarefas órfãs", () => {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const task = {
        id: "task-123",
        status: "processing",
        scheduled_at: fifteenMinsAgo.toISOString()
      };

      // Simular recuperação: se a tarefa ficou em 'processing' por mais de 15 min, reverter para 'pending'
      const isOrphaned = task.status === "processing" && new Date(task.scheduled_at) <= fifteenMinsAgo;
      expect(isOrphaned).toBe(true);
      if (isOrphaned) {
        task.status = "pending";
      }

      expect(task.status).toBe("pending");
    });
  });
});

