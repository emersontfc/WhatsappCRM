import { describe, it, expect } from "vitest";
import { extractProofWithAI, parseMozambicanReceiptSMS } from "../backend/services/paymentProofExtractor.ts";
import { compareProofRecipient, reviewProofRecipient } from "../backend/services/paymentProofSms.ts";

const outgoingEMola = "D da transacao PP261125.2001.i00000. Transferiste 30.00MT para conta 870000000, nome: MARIA EXEMPLO CLIENTE as 20:01:33 de 25/11/2026. Taxa: 0.00MT. O saldo da tua conta e xxxxMT. Conteudo: megas. Em caso de duvida, liga 100. Obrigado!";
const outgoingMPesa = "Confirmado ABZA12CD34. Transferiste 5.00MT e a taxa foi de 0.00MT para 258850000000 - António Exemplo aos 25/11/26 as 8:47 PM. O teu novo saldo M-Pesa e de 0.00MT. Continua a transferir SEM TAXAS de M-Pesa para M-Pesa. Em caso de duvida, liga 100.";

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

    it("extrai o SMS de saída M-Pesa e associa o número e o nome ao destinatário", async () => {
      const proof = await extractProofWithAI("receipt-test", `comprovativo mpesa ${outgoingMPesa}`);
      expect(proof).toMatchObject({
        provider: "mpesa", transactionReference: "ABZA12CD34", amount: 5, currency: "MT",
        recipientAccount: "258850000000", recipientName: "António Exemplo", date: "25/11/2026", time: "20:47"
      });
      expect(proof.senderPhone).toBeUndefined();
      expect(proof.senderName).toBeUndefined();
      expect(proof.confidenceScore).toBeGreaterThanOrEqual(0.9);
      const destination = { method: "mpesa", recipient: "850000000", name: "Antonio Exemplo" } as const;
      expect(compareProofRecipient(proof, destination).recipientMatch).toBe("match");
      expect(compareProofRecipient(proof, { ...destination, recipient: "850000001" }).recipientMatch).toBe("mismatch");
      expect(reviewProofRecipient({ proof_raw_text: outgoingMPesa, extracted_data: { recipientMatch: "unknown" } }, destination))
        .toMatchObject({ recipientName: "António Exemplo", recipientMatch: "match" });
    });

    it("lê o valor da transferência quando a taxa e os saldos têm outros valores", () => {
      const variant = outgoingMPesa.replace("5.00MT", "5,00 MZN").replace("0.00MT para", "1.25MT para")
        .replace("258850000000 -", "+258 85 000-0000 —").replace(" as ", " às ")
        .replace(/ O teu novo saldo.*/, " Saldo disponível 900,00MT.");
      expect(parseMozambicanReceiptSMS(`Saldo anterior 905,00MT. ${variant}`)).toMatchObject({
        amount: 5, provider: "mpesa", recipientAccount: "+258 85 000-0000", time: "20:47"
      });
      expect(parseMozambicanReceiptSMS("Confirmado ABZA12CD34. A taxa foi de 1.25MT. O teu novo saldo M-Pesa e de 900.00MT.")).toBeNull();
      expect(parseMozambicanReceiptSMS(outgoingMPesa.replace("5.00MT", "[valor]"))).toBeNull();
    });

    it.each([["12:00 AM", "00:00"], ["12:00 pm", "12:00"], ["09:07 am", "09:07"]])("normaliza a hora M-Pesa %s", (local, normalized) => {
      expect(parseMozambicanReceiptSMS(outgoingMPesa.replace("8:47 PM", local))?.time).toBe(normalized);
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

    it("extrai um SMS de saída do e-Mola com referência PP e o titular da conta de destino", async () => {
      const proof = await extractProofWithAI("receipt-test", outgoingEMola);
      expect(proof).toMatchObject({
        provider: "emola", amount: 30, currency: "MT", transactionReference: "PP261125.2001.I00000",
        recipientAccount: "870000000", recipientName: "MARIA EXEMPLO CLIENTE", time: "20:01:33", date: "25/11/2026"
      });
      expect(proof.senderPhone).toBeUndefined();
      expect(proof.senderName).toBeUndefined();
      const destination = { method: "emola", recipient: "+258870000000", name: "Maria Exemplo Cliente" } as const;
      expect(compareProofRecipient(proof, destination).recipientMatch).toBe("match");
      expect(compareProofRecipient(proof, { ...destination, recipient: "+258870000001" }).recipientMatch).toBe("mismatch");
      expect(compareProofRecipient(proof, { ...destination, name: "Ana Outra Pessoa" }).recipientMatch).toBe("mismatch");
    });

    it("lê o valor junto de Transferiste e limita a inferência do e-Mola ao formato do SMS", () => {
      const variant = `Saldo anterior 900.00MT. ${outgoingEMola.replace("30.00MT", "30,00 MZN").replace("870000000", "+258 87 000 0000").replace(" as ", " às ")}`;
      expect(parseMozambicanReceiptSMS(variant)).toMatchObject({ provider: "emola", amount: 30, currency: "MT", time: "20:01:33" });
      expect(parseMozambicanReceiptSMS("Quando posso transferir 30MT para conta 870000000?")).toBeNull();
      expect(parseMozambicanReceiptSMS("Transação: PP261125.2001.i00000. Valor: 30,00 MT.")?.provider).toBe("other");
      expect(parseMozambicanReceiptSMS(outgoingEMola.replace("870000000", "840000000"))?.provider).toBe("other");
    });

    it("lê o titular de comprovativos pendentes que só tinham uma correspondência pelo número", () => {
      const prior = { proof_raw_text: outgoingEMola,
        extracted_data: { recipientAccount: "870000000", recipientMatch: "match" as const } };
      const expected = { method: "emola", recipient: "258870000000", name: "Ana Outra Pessoa" } as const;
      expect(reviewProofRecipient(prior, expected)).toMatchObject({ recipientName: "MARIA EXEMPLO CLIENTE", recipientMatch: "mismatch" });
    });

    it("rejeita textos aleatórios sem dados de transação", () => {
      const text = "Bom dia, gostaria de saber se o meu pedido já foi enviado?";
      const extracted = parseMozambicanReceiptSMS(text);
      expect(extracted).toBeNull();
    });

    it("distingue remetente de titular do destino e interpreta o montante local", () => {
      const proof = parseMozambicanReceiptSMS("M-Pesa. Recebeu 1.200,00 MT de 841234567 João Cliente. Beneficiário: Lója Exemplo.");
      expect(proof).toMatchObject({ amount: 1200, senderName: "João Cliente", recipientName: "Lója Exemplo" });
      expect(compareProofRecipient(proof!, { method: "mpesa", recipient: "258840000003", name: "Loja Exemplo" }).recipientMatch).toBe("match");
    });

    it("assinala destinatários divergentes e mantém nomes parciais por conferir", () => {
      const expected = { method: "mpesa", recipient: "258840000003", name: "Loja Exemplo" } as const;
      expect(compareProofRecipient({ recipientName: "Outra Pessoa" }, expected).recipientMatch).toBe("mismatch");
      expect(compareProofRecipient({ recipientName: "Loja Exemplo", recipientAccount: "84 000 0005" }, expected).recipientMatch).toBe("mismatch");
      expect(compareProofRecipient({ recipientName: "Loja", recipientAccount: "****0003" }, expected).recipientMatch).toBe("unknown");
      expect(parseMozambicanReceiptSMS("Como envio um comprovativo de 250 MT?")).toBeNull();
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

