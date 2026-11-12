# Catálogo Central de Ferramentas dos Agentes — Kazix AgentX 2.0

O **Kazix AgentX 2.0** disponibiliza um Registro Central de Ferramentas (`backend/tools/`) composto por **19 ferramentas formais**, cada uma com esquema estrito de parâmetros, nível de risco atribuído e governança de permissões.

---

## 1. Tabela Resumo das 19 Ferramentas

| Ferramenta | Categoria | Risco | Requer Aprovação | Especializações Recomendadas |
| :--- | :--- | :---: | :---: | :--- |
| **`getProductsCatalog`** | Comércio | Baixo | Não | Vendas, Suporte, Marketing, Multi |
| **`createOrder`** | Comércio | Médio | Não | Vendas, Pagamentos, Multi |
| **`getOrderStatus`** | Comércio | Baixo | Não | Vendas, Pagamentos, Suporte, Multi |
| **`submitPaymentProof`** | Pagamentos | Médio | Não | Pagamentos, Vendas, Multi |
| **`qualifyLead`** | CRM | Baixo | Não | Leads, Vendas, Marketing, Multi |
| **`updateCrmStage`** | CRM | Médio | Não | Vendas, Leads, Multi |
| **`createMarketingCampaign`** | Marketing | Médio | Sim | Marketing, Admin |
| **`getFinancialMetrics`** | Admin | Crítico | Sim | Administração, Admin |
| **`createAppointment`** | Agendamentos | Baixo | Não | Agendamentos, Vendas, Multi |
| **`checkAvailability`** | Agendamentos | Baixo | Não | Agendamentos, Suporte, Multi |
| **`cancelAppointment`** | Agendamentos | Médio | Não | Agendamentos, Suporte, Multi |
| **`searchKnowledgeBase`** | Conhecimento | Baixo | Não | Suporte, Vendas, Multi |
| **`escalateToHuman`** | Suporte | Baixo | Não | Suporte, Todos |
| **`sendWhatsAppTemplate`** | Mensagens | Médio | Não | Marketing, Vendas |
| **`addContactTag`** | CRM | Baixo | Não | Leads, Suporte, Vendas |
| **`removeContactTag`** | CRM | Baixo | Não | Leads, Suporte, Vendas |
| **`getContactHistory`** | CRM | Baixo | Não | Suporte, Vendas, Admin |
| **`generatePixPayment`** | Pagamentos | Médio | Não | Pagamentos, Vendas |
| **`verifyPixPayment`** | Pagamentos | Médio | Não | Pagamentos, Vendas |

---

## 2. Detalhes das Principais Ferramentas Comerciais do AgentX 2.0

### 2.1 `getProductsCatalog`
- **Descrição:** Consulta produtos e serviços disponíveis no catálogo ativo da organização com preços e stock.
- **Parâmetros de Entrada:**
  - `category` *(opcional, string)*: Filtrar por categoria (ex: "Planos", "Hardware", "Consultoria").
  - `limit` *(opcional, number)*: Limite de itens a retornar (padrão 10).
- **Retorno:**
  - `products`: Lista de produtos com `id`, `name`, `price`, `currency`, `description`, `stock_quantity`, `is_digital`.
  - `count`: Quantidade de itens encontrados.

---

### 2.2 `createOrder`
- **Descrição:** Cria formalmente um pedido de compra para o contacto com itens selecionados e instruções de pagamento.
- **Parâmetros de Entrada:**
  - `contactPhone` *(obrigatório, string)*: Número de WhatsApp do comprador.
  - `items` *(obrigatório, array)*: Lista de objetos com `productId` e `quantity`.
  - `notes` *(opcional, string)*: Observações sobre a encomenda.
- **Retorno:**
  - `orderNumber`: Identificador único (ex: `AGX-492104`).
  - `totalAmount`: Valor total calculado.
  - `currency`: Meticais (`MT`).
  - `status`: `"pending"`.
  - `paymentInstructions`: Detalhes de contas M-Pesa, e-Mola e Bancárias para liquidação.

---

### 2.3 `getOrderStatus`
- **Descrição:** Consulta o status atual de um pedido específico ou dos pedidos recentes de um contacto.
- **Parâmetros de Entrada:**
  - `orderNumber` *(opcional, string)*: Código do pedido (ex: `AGX-492104`).
  - `contactPhone` *(opcional, string)*: Número do contacto.
- **Retorno:**
  - `orderNumber`, `status`, `totalAmount`, `paymentStatus`, `deliveryStatus`, `items`.

---

### 2.4 `submitPaymentProof`
- **Descrição:** Submete um comprovativo de pagamento recebido para validação administrativa.
- **Parâmetros de Entrada:**
  - `orderNumber` *(obrigatório, string)*: Código do pedido correspondente.
  - `proofText` *(opcional, string)*: Texto copiado da mensagem SMS do comprovativo.
  - `proofUrl` *(opcional, string)*: URL ou base64 da imagem/PDF do comprovativo.
  - `provider` *(opcional, string)*: `"mpesa"`, `"emola"`, `"bank_transfer"` ou `"reference"`.
- **Retorno:**
  - `verificationId`: ID da validação criada.
  - `orderNumber`: Número do pedido atualizado para `verification_pending`.
  - `extractedData`: Dados de valor, remetente e transação identificados pelo motor de extração.
  - `status`: `"pending_verification"`.

---

### 2.5 `qualifyLead`
- **Descrição:** Atribui pontuação de interesse (lead scoring), etiquetas comerciais e notas de maturidade a um contacto.
- **Parâmetros de Entrada:**
  - `contactPhone` *(obrigatório, string)*: Telefone do contacto.
  - `scoreDelta` *(obrigatório, number)*: Pontos a somar (-20 a +50).
  - `tags` *(opcional, array de strings)*: Etiquetas comerciais a associar.
  - `qualificationNotes` *(opcional, string)*: Resumo da qualificação observada pelo agente.
- **Retorno:**
  - `newScore`: Pontuação acumulada do lead.
  - `interestLevel`: Classificação calculada (`"frio"`, `"morno"`, `"quente"`, `"cliente"`).

---

### 2.6 `createMarketingCampaign`
- **Descrição:** Cria e agenda uma campanha promocional com salvaguarda anti-spam e espaçamento inteligente.
- **Parâmetros de Entrada:**
  - `name` *(obrigatório, string)*: Nome da campanha.
  - `targetTag` *(obrigatório, string)*: Etiqueta dos contactos destinatários.
  - `messageTemplate` *(obrigatório, string)*: Conteúdo da mensagem a disparar.
  - `scheduledAt` *(opcional, string ISO)*: Data/hora para execução.
  - `minIntervalSeconds` *(opcional, number)*: Intervalo mínimo entre disparos (mínimo forçado: 10 segundos).
- **Retorno:**
  - `campaignId`: Identificador da campanha.
  - `targetContactsCount`: Quantidade de contactos elegíveis.
  - `estimatedDurationMinutes`: Tempo estimado para conclusão segura sem risco de bloqueio no WhatsApp.

---

### 2.7 `getFinancialMetrics`
- **Descrição:** Fornece métricas consolidadas de vendas, receita e pedidos pendentes ao administrador.
- **Restrição:** Ferramenta protegida. Requer permissão administrativa e rejeita chamadas feitas por contactos externos.
- **Retorno:**
  - `totalRevenue`: Receita acumulada faturada.
  - `paidOrdersCount`: Quantidade de pedidos liquidados.
  - `pendingVerificationsCount`: Comprovativos à espera de conferência.
  - `conversionRate`: Taxa percentual de conversão de leads em clientes.
