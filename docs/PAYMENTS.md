# Guia do Módulo de Pagamentos — Kazix AgentX 2.0

## 1. Visão Geral

O módulo de pagamentos do **Kazix AgentX 2.0** foi concebido especificamente para a realidade comercial de Moçambique e mercados emergentes, onde predominam as carteiras móveis (M-Pesa e e-Mola) e transferências bancárias manuais, aliando a agilidade do agente de IA ao rigor do controlo humano contra fraudes.

---

## 2. Métodos de Pagamento Suportados

| Provedor | Rede / Instituição | Prefixo de Transação | Identificador de Rede |
| :--- | :--- | :--- | :--- |
| **M-Pesa** | Vodacom Moçambique | Alfanumérico (ex: `2K3J4H5G`, `9K8J7H`) | 84, 85 |
| **e-Mola** | Movitel Moçambique | `EM` + dígitos (ex: `EM99887766`) | 86, 87 |
| **Transferência Bancária** | BCI, Millennium BIM, Standard Bank, Moza | Ref. do Comprovativo Bancário | Contas / NIB da Empresa |
| **Referência de Pagamento** | Pagamentos por Entidade/Referência | Numérico (9 a 12 dígitos) | SIBS / SIMO |

---

## 3. Motor de Extração de Comprovativos (`paymentProofExtractor.ts`)

O motor de extração opera em duas camadas sequenciais:

### 3.1 Camada 1: Regex Determinístico de Alto Desempenho (SMS Copiado / Texto)
- Execução local em Node.js com tempo de resposta inferior a 5 milissegundos.
- Consumo de 0 tokens de IA e 0 custos de API externa.
- Reconhece formatos oficiais de mensagens de notificação de recebimento M-Pesa e e-Mola:
  - *Exemplo M-Pesa:* `"Confirmado. Recebeu 500.00 MT de 841234567 Emerson Torres em 2026-11-12 14:30. Transaccao: 2K3J4H5G."`
  - *Exemplo e-Mola:* `"Recebeu 1,200.00MT de 876200662 em 2026-11-13 09:15. Transacao: EM99887766. Novo saldo: 3,000.00MT."`
- **Campos extraídos:**
  - `provider`: `"mpesa"` ou `"emola"`.
  - `transactionReference`: Código único da transação em maiúsculas.
  - `amount`: Valor numérico em meticais (MT).
  - `currency`: `"MT"`.
  - `senderPhone`: Número de telefone do remetente (normalizado).
  - `senderName`: Nome do remetente quando presente na mensagem.
  - `confidenceScore`: `>= 0.95` quando referência e valor são identificados com precisão.

### 3.2 Camada 2: Fallback Multimodal com Google Gemini Vision (Imagens e PDFs)
- Ativado quando o cliente anexa uma captura de ecrã (screenshot) ou ficheiro PDF de comprovativo.
- Utiliza o modelo multimodal Gemini para extrair e estruturar os mesmos atributos em JSON rigoroso.
- Se a confiança for baixa (`< 0.60`), o sistema sinaliza no dashboard para inspeção manual detalhada pelo operador.

---

## 4. Governança e Regra Fundamental de Segurança

> [!CAUTION]
> **REGRA DE OURO DO AGENTX 2.0:**
> Sob nenhuma circunstância a inteligência artificial tem permissão de marcar um pedido como `paid` (pago) ou despachar produtos/serviços digitais apenas com base em mensagens de texto do utilizador.

1. **Submissão:** O envio do comprovativo cria um registo na tabela `payment_verifications` com status `pending`.
2. **Transição do Pedido:** O pedido associado transita de `pending` para `verification_pending`.
3. **Alerta ao Administrador:** O dashboard `/orders` (separador *Validações Pendentes*) exibe o comprovativo com todos os detalhes extraídos e botão de 1-clique para aprovação ou rejeição.
4. **Aprovação Autorizada:** Apenas um utilizador autenticado com sessão válida pode invocar `POST /api/commerce/orders/:id/approve` ou `POST /api/commerce/orders/:id/reject`.
5. **Auditoria:** Toda aprovação ou rejeição fica gravada em `payment_verifications` com `reviewed_by` e na tabela `agent_operations`.

---

## 5. Entrega Digital Idempotente (`fulfillOrder`)

Assim que a aprovação é confirmada:
1. O status do pedido é alterado para `paid`.
2. O serviço `CommerceService.fulfillOrder(orderId, userId)` é executado.
3. Se os itens do pedido forem produtos digitais (`is_digital = true`), o conteúdo digital (`digital_content` — ex: chave de licença, link de acesso, instruções de ativação) é recuperado.
4. Uma mensagem formatada oficial do **AgentX 2.0** é disparada diretamente para o WhatsApp do cliente através da sessão ativa de Baileys.
5. O status do pedido transita para `fulfilled` e `delivery_status = 'delivered'`.
6. **Proteção contra Duplicatas:** Se o método for chamado novamente para o mesmo pedido já entregue, o sistema rejeita a operação com `status: "already_fulfilled"`, impedindo disparos duplicados ou entrega múltipla de licenças.

---

## 6. Endpoints REST da API de Comércio

Todos os endpoints exigem cabeçalho de autenticação Bearer Token (`authenticate` middleware):

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `GET` | `/api/commerce/products` | Lista catálogo de produtos ativos da conta. |
| `POST` | `/api/commerce/products` | Cria novo produto físico ou digital. |
| `GET` | `/api/commerce/orders` | Lista pedidos com filtros por status (`pending`, `paid`, etc.). |
| `POST` | `/api/commerce/orders` | Criação manual ou programática de pedido. |
| `GET` | `/api/commerce/verifications` | Fila de comprovativos pendentes de validação. |
| `POST` | `/api/commerce/orders/:id/approve` | Aprovação administrativa do pagamento e disparo de entrega. |
| `POST` | `/api/commerce/orders/:id/reject` | Rejeição do comprovativo com registo do motivo. |
| `GET` | `/api/commerce/orders/:id/timeline` | Histórico completo de eventos do pedido. |
| `GET` | `/api/commerce/operations-feed` | Feed unificado de operações recentes de agentes e comércio. |
