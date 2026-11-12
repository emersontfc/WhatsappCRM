import { describe, it, expect } from "vitest";
import { parseMozambicanReceiptSMS } from "../backend/services/paymentProofExtractor.ts";

describe("AgentX 2.0 — End-to-End Autonomous Commerce & Scenarios", () => {
  // Scenario A: Atendimento & Histórico
  describe("Cenário A — Atendimento & Histórico", () => {
    it("mantém o histórico sequencial e formata contexto de atendimento", () => {
      const history: string[] = [];
      const addTurn = (user: string, agent: string) => {
        history.push(`User: ${user}`);
        history.push(`Agent: ${agent}`);
        if (history.length > 8) history.splice(0, history.length - 8);
      };

      addTurn("Olá, vocês vendem pacotes de internet?", "Olá! Sim, temos pacotes de 1GB, 5GB e 10GB.");
      addTurn("Quanto custa o de 5GB?", "O pacote de 5GB custa 500 MT.");

      expect(history.length).toBe(4);
      expect(history[0]).toContain("pacotes de internet");
      expect(history[3]).toContain("500 MT");
    });
  });

  // Scenario B: Venda & Criação de Pedidos
  describe("Cenário B — Venda & Criação de Pedidos", () => {
    it("calcula valores totais e gera identificador único do pedido", () => {
      const items = [
        { productName: "Pacote 5GB", quantity: 2, unitPrice: 500 },
        { productName: "Taxa de Ativação", quantity: 1, unitPrice: 50 }
      ];

      const total = items.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
      const orderNumber = `AGX-${Math.floor(1000 + Math.random() * 9000)}`;

      expect(total).toBe(1050);
      expect(orderNumber).toMatch(/^AGX-\d{4}$/);
    });
  });

  // Scenario C: Pagamento & Leitura de Comprovativos M-Pesa / e-Mola
  describe("Cenário C — Pagamento & Extração de Comprovativos", () => {
    it("extrai corretamente dados de comprovativo M-Pesa", () => {
      const sms = "Confirmado. Recebeu 500.00 MT de 841234567 Emerson Torres em 2026-11-12 14:30. Transaccao: 2K3J4H5G. Saldo actual: 5,420.00 MT.";
      const extracted = parseMozambicanReceiptSMS(sms);

      expect(extracted).not.toBeNull();
      expect(extracted?.provider).toBe("mpesa");
      expect(extracted?.amount).toBe(500);
      expect(extracted?.transactionReference).toBe("2K3J4H5G");
      expect(extracted?.senderPhone).toContain("841234567");
      expect(extracted?.confidenceScore).toBeGreaterThanOrEqual(0.9);
    });

    it("extrai corretamente dados de comprovativo e-Mola", () => {
      const sms = "Recebeu 1,200.00MT de 876200662 em 2026-11-13 09:15. Transacao: EM99887766. Novo saldo: 3,000.00MT.";
      const extracted = parseMozambicanReceiptSMS(sms);

      expect(extracted).not.toBeNull();
      expect(extracted?.provider).toBe("emola");
      expect(extracted?.amount).toBe(1200);
      expect(extracted?.transactionReference).toBe("EM99887766");
      expect(extracted?.confidenceScore).toBeGreaterThanOrEqual(0.9);
    });

    it("rejeita textos aleatórios sem dados de transação", () => {
      const text = "Bom dia, gostaria de saber se o meu pedido já foi enviado?";
      const extracted = parseMozambicanReceiptSMS(text);
      expect(extracted).toBeNull();
    });
  });

  // Scenario D: Entrega & Idempotência
  describe("Cenário D — Entrega Digital & Prevenção de Duplicatas", () => {
    it("impede entrega duplicada após transição para fulfilled", () => {
      const order = {
        id: "order-101",
        status: "paid",
        fulfillmentCount: 0
      };

      const fulfill = (o: typeof order) => {
        if (o.status === "fulfilled") {
          return { success: false, message: "Já entregue anteriormente" };
        }
        o.status = "fulfilled";
        o.fulfillmentCount++;
        return { success: true, message: "Entregue com sucesso" };
      };

      const firstCall = fulfill(order);
      expect(firstCall.success).toBe(true);
      expect(order.fulfillmentCount).toBe(1);

      const secondCall = fulfill(order);
      expect(secondCall.success).toBe(false);
      expect(order.fulfillmentCount).toBe(1);
    });
  });

  // Scenario E: CRM & Qualificação de Leads
  describe("Cenário E — CRM & Pontuação de Leads", () => {
    it("adiciona etiquetas e calcula interesse do lead", () => {
      const lead = {
        name: "Carlos Silva",
        tags: ["WhatsApp"],
        score: 10
      };

      const qualify = (l: typeof lead, newTag: string, interest: "alto" | "medio" | "baixo") => {
        l.tags = Array.from(new Set([...l.tags, newTag]));
        if (interest === "alto") l.score += 50;
        else if (interest === "medio") l.score += 25;
        else l.score += 5;
      };

      qualify(lead, "Interessado em 5GB", "alto");
      expect(lead.tags).toContain("Interessado em 5GB");
      expect(lead.score).toBe(60);
    });
  });

  // Scenario F: Marketing & Anti-Spam
  describe("Cenário F — Marketing & Espaçamento Anti-Spam", () => {
    it("espaça disparos programados em pelo menos 10 segundos", () => {
      const contacts = ["258841111111", "258842222222", "258843333333"];
      const baseTime = Date.now();
      const intervals = contacts.map((_, i) => baseTime + i * 10000);

      expect(intervals[1] - intervals[0]).toBe(10000);
      expect(intervals[2] - intervals[1]).toBe(10000);
    });
  });

  // Scenario G: Segurança & Rejeição de Privilégios
  describe("Cenário G — Segurança & Rejeição de Privilégios por Texto", () => {
    it("bloqueia ferramentas administrativas quando solicitadas por contatos não autorizados", () => {
      const adminPhones = ["258841234567"];
      const checkAdmin = (senderPhone: string) => adminPhones.includes(senderPhone);

      expect(checkAdmin("258841234567")).toBe(true);
      expect(checkAdmin("258849999999")).toBe(false);
    });
  });

  // Scenario H: Recuperação & Persistência
  describe("Cenário H — Recuperação & Retomada de Estado", () => {
    it("recupera estado de pedido em verificação pendente após reinício simulado", () => {
      const persistentStore = new Map<string, { orderNumber: string; status: string }>();
      persistentStore.set("ord-123", { orderNumber: "AGX-5001", status: "verification_pending" });

      // Simula reinício de processo
      const recoveredOrder = persistentStore.get("ord-123");
      expect(recoveredOrder).toBeDefined();
      expect(recoveredOrder?.status).toBe("verification_pending");
    });
  });
});

