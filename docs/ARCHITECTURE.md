# Arquitetura do Kazix AgentX 2.0

## 1. Visão Geral da Plataforma

O **Kazix AgentX 2.0** é uma plataforma SaaS empresarial de agentes inteligentes autónomos e CRM omnicanal para WhatsApp, projetada para automatizar o ciclo completo de relacionamento com o cliente:
1. **Atendimento e Qualificação:** Interpretação contextual via LLM (Google Gemini / Anthropic Claude / OpenAI / Groq) sem dependência de árvores rígidas de palavras-chave.
2. **Comércio e Vendas:** Consulta em tempo real a catálogos de produtos e serviços, cálculo de totais, verificação de stock e geração de pedidos com identificador único (`AGX-XXXXXX`).
3. **Pagamentos e Comprovativos:** Emissão de instruções de pagamento para Moçambique (M-Pesa Vodacom, e-Mola Movitel, Transferências Bancárias e Referências), extração determinística por regex e multimodal com IA de dados de transação de comprovativos (SMS, imagens, PDFs).
4. **Governança e Verificação em Duas Etapas:** Fila de validação humana para pagamentos, auditoria em tempo real (`agent_operations`) e limitação financeira por agente.
5. **Entrega Digital Automatizada:** Envio seguro e idempotente de credenciais, links ou vouchers diretamente pelo WhatsApp após aprovação autorizada.

```
+-----------------------------------------------------------------------------------+
|                                 WHATSAPP CLIENT                                   |
|               (Texto, Imagem de Comprovativo, Consulta de Catálogo)               |
+-----------------------------------------------------------------------------------+
                                         │  ▲
                            Baileys WPP  │  │  Mensagens Formatadas
                                         ▼  │
+-----------------------------------------------------------------------------------+
|                              BACKEND NODE.JS / EXPRESS                            |
|                                                                                   |
|  +─────────────────────────────────────────────────────────────────────────────+  |
|  |                           UNIVERSAL AGENT ENGINE                            |  |
|  |  • Multi-Especialização (Vendas, Pagamentos, Leads, Suporte, Admin, Multi)   |  |
|  |  • Modelo de Governança (Autonomia 1-3, Risco Baixo/Médio/Crítico)           |  |
|  |  • Limites Financeiros & Formatação Humanizada para WhatsApp                |  |
|  +─────────────────────────────────────────────────────────────────────────────+  |
|         │                                       │                                 |
|         ▼                                       ▼                                 |
|  +─────────────────────────+          +────────────────────────────────────────+  |
|  |  CENTRAL TOOL REGISTRY  |          |       PAYMENT & COMMERCE SERVICE       |  |
|  |  • 19 Ferramentas       |          |  • Extrator Regex (M-Pesa / e-Mola)    |  |
|  |  • Validação Zod / JSON |          |  • Fallback Multimodal Gemini Vision   |  |
|  |  • Controlo de Risco    |          |  • Entrega Digital Idempotente         |  |
|  +─────────────────────────+          +────────────────────────────────────────+  |
|         │                                       │                                 |
+─────────┼───────────────────────────────────────┼─────────────────────────────────+
          ▼                                       ▼
+───────────────────────────────────────────────────────────────────────────────────+
|                               SUPABASE / POSTGRESQL                               |
|   • products  • orders  • order_items  • payment_verifications  • agent_operations|
|   • contacts  • crm_deals  • agents  • whatsapp_sessions  • audit_logs            |
+───────────────────────────────────────────────────────────────────────────────────+
                                         ▲
                                         │  REST APIs (/api/commerce, /api/agent)
+-----------------------------------------------------------------------------------+
|                        FRONTEND REACT 19 / TAILWIND CSS                           |
|   • Dashboard & Métricas Financeiras  • Vendas & Pedidos (/orders)                |
|   • Validação 1-Click de Pagamentos   • Construtor Visual de Agentes (/agent)     |
|   • Linha Temporal de Operações       • Chat WhatsApp em Tempo Real               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Camada de Dados e Modelo Relacional

O schema do AgentX 2.0 foi estendido através da migração `08_agentx_2_0_commerce_operations.sql`, complementando as tabelas existentes (`contacts`, `crm_deals`, `agents`, `whatsapp_sessions`).

### 2.1 Novas Tabelas Comerciais

1. **`products`**
   - Catálogo de produtos físicos e digitais por organização (`user_id`).
   - Atributos: `id`, `user_id`, `name`, `description`, `price`, `currency`, `category`, `stock_quantity`, `is_digital`, `digital_content`, `is_active`, `metadata`, `created_at`, `updated_at`.

2. **`orders`**
   - Pedidos comerciais formais gerados por agentes ou pelo painel.
   - Atributos: `id`, `user_id`, `order_number` (ex: `AGX-492104`), `contact_id`, `status` (`pending`, `verification_pending`, `paid`, `fulfilled`, `cancelled`, `refunded`), `subtotal`, `discount_amount`, `total_amount`, `currency`, `payment_method`, `delivery_method`, `delivery_status`, `notes`, `created_at`, `updated_at`.

3. **`order_items`**
   - Itens de cada pedido.
   - Atributos: `id`, `order_id`, `product_id`, `product_name`, `quantity`, `unit_price`, `total_price`, `metadata`.

4. **`payment_verifications`**
   - Fila de auditoria e validação de comprovativos de pagamento.
   - Atributos: `id`, `user_id`, `order_id`, `contact_id`, `provider` (`mpesa`, `emola`, `bank_transfer`, `reference`, `other`), `transaction_reference`, `amount_detected`, `currency`, `sender_phone`, `sender_name`, `proof_type` (`sms_text`, `image`, `pdf`), `proof_url`, `confidence_score`, `status` (`pending`, `approved`, `rejected`), `reviewed_by`, `reviewed_at`, `notes`, `created_at`.

5. **`agent_operations`**
   - Linha temporal de auditoria de todas as operações sensíveis executadas por agentes e administradores.
   - Atributos: `id`, `user_id`, `agent_id`, `order_id`, `contact_id`, `action_type`, `status` (`success`, `failed`, `pending_approval`), `details`, `created_at`.

6. **Extensões na Tabela `agents`**
   - `specialization`: `vendas`, `pagamentos`, `marketing`, `leads`, `agendamentos`, `suporte`, `administracao`, `multifuncional`.
   - `autonomy_level`: 1 (supervisionado), 2 (semi-autónomo com limites), 3 (autónomo em operações autorizadas).
   - `risk_tolerance`: `low`, `medium`, `high`.
   - `enabled_tools`: array de strings com as ferramentas ativadas.
   - `financial_limit`: valor monetário máximo permitido para operações sem confirmação prévia.

---

## 3. Fluxo de Vida de um Pedido e Segurança de Pagamento

Nenhum agente de IA tem permissão de marcar diretamente um pedido como `paid` ou acionar a entrega digital sem validação. O ciclo é estritamente governado:

```
[Cliente no WhatsApp: "Quero 5GB"]
               │
               ▼
   [Agente: getProductsCatalog]
               │
               ▼
      [Agente: createOrder]
               │  Status do Pedido: 'pending'
               ▼
[Cliente envia comprovativo SMS/Imagem]
               │
               ▼
 [Serviço: paymentProofExtractor]
   • Extrai: Ref, Valor, Remetente, Provedor
               │
               ▼
  [Agente: submitPaymentProof]
   • Cria registo em 'payment_verifications'
   • Altera status do pedido para: 'verification_pending'
   • Notifica Administrador via Dashboard & Timeline
               │
               ▼
  [Administrador Humano no Dashboard]
   • Analisa referência, valor e remetente
   • Clica em "Aprovar Pagamento" (/api/commerce/orders/:id/approve)
               │
               ▼
   [CommerceService.approveOrder]
   • Altera status do pedido para 'paid'
   • Aciona automaticamente 'fulfillOrder' (idempotente)
   • Envia credenciais/produto digital via WhatsApp ao cliente
   • Regista na linha temporal 'agent_operations'
```

---

## 4. Otimização para a Infraestrutura de Produção

- **Ambiente Alvo:** VPS Ubuntu com 3.7 GiB de RAM e CPU partilhada (`agentx.kazix.site`).
- **Eficiência de Recursos:**
  - Extração de comprovativos via Regex nativo de alta velocidade (< 5ms de CPU, 0 tokens de IA gastos) para 95% dos comprovativos SMS de M-Pesa e e-Mola.
  - Fallback para Gemini Vision apenas quando o utilizador envia imagem ou ficheiro PDF.
  - Code-splitting na compilação do Vite (`vendor-react`, `vendor-supabase`, `vendor-ui`).
  - Cache de conexão Supabase com reconnection automática e timeout estrito.
  - Rate limiting e espaçamento mínimo anti-spam (10s) nas ferramentas de marketing.
