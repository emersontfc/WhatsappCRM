# Motor de Inteligência Artificial e Especializações — Kazix AgentX 2.0

## 1. O Motor de Agentes Universais (`agentManager.ts`)

O **Kazix AgentX 2.0** substitui arquiteturas rígidas baseadas em palavras-chave por um motor de agentes cognitivos alimentado por LLM de última geração.

Cada agente opera com um ciclo contínuo de raciocínio, planeamento e ação:
1. **Perceção:** Receção da mensagem do WhatsApp (texto, áudio transcrito, imagem de comprovativo).
2. **Contextualização:** Carregamento do histórico recente da conversa, dados do contacto (`contacts`), negócios abertos no CRM (`crm_deals`), pedidos associados (`orders`) e perfil do agente (`agents`).
3. **Planeamento e Decisão:** Avaliação da intenção do utilizador confrontada com as ferramentas autorizadas e regras de negócio.
4. **Execução de Ferramentas:** Chamada segura a funções do sistema registradas no Registro Central de Ferramentas.
5. **Formatação Humanizada:** Resposta estruturada e adaptada para WhatsApp (uso controlado de emojis, tópicos claros e ausência de termos técnicos de desenvolvimento).

---

## 2. As 8 Especializações de Agentes

Cada agente configurado na plataforma pode assumir uma ou mais das seguintes especializações:

### 2.1 Agente de Vendas (`vendas`)
- **Foco:** Apresentação de produtos, esclarecimento de dúvidas sobre preços, fecho de negócios e geração de pedidos comerciais.
- **Ferramentas Típicas:** `getProductsCatalog`, `createOrder`, `getOrderStatus`, `updateCrmStage`.
- **Comportamento:** Consulta sempre o catálogo real antes de informar preços ou disponibilidade. Guia o cliente passo a passo até à confirmação do pedido.

### 2.2 Agente de Pagamentos (`pagamentos`)
- **Foco:** Emissão de instruções de pagamento, receção de comprovativos e acompanhamento do status financeiro.
- **Ferramentas Típicas:** `submitPaymentProof`, `getOrderStatus`, `getProductsCatalog`.
- **Comportamento:** Informa com clareza as contas e números M-Pesa/e-Mola oficiais da empresa. Solicita que o cliente envie o SMS ou captura de tela do comprovativo. Nunca inventa confirmações financeiras.

### 2.3 Agente de Gestão de Leads (`leads`)
- **Foco:** Qualificação de contactos recebidos, scoring de interesse e organização no funil de vendas.
- **Ferramentas Típicas:** `qualifyLead`, `updateCrmStage`, `createAppointment`.
- **Comportamento:** Identifica a maturidade da compra do contacto, atribui etiquetas como `#lead-quente`, `#orçamento`, `#moçambique` e ajusta a etapa no CRM.

### 2.4 Agente de Marketing (`marketing`)
- **Foco:** Divulgação de ofertas, reativação de clientes inativos e campanhas segmentadas.
- **Ferramentas Típicas:** `createMarketingCampaign`, `getProductsCatalog`, `qualifyLead`.
- **Comportamento:** Garante respeito estrito ao espaçamento anti-spam (mínimo de 10 segundos entre envios) e só contacta bases devidamente segmentadas.

### 2.5 Agente de Agendamentos (`agendamentos`)
- **Foco:** Marcação de demonstrações, reuniões e consultas de serviço.
- **Ferramentas Típicas:** `createAppointment`, `checkAvailability`, `cancelAppointment`.
- **Comportamento:** Valida a agenda antes de confirmar qualquer horário e notifica tanto o cliente quanto a equipa comercial.

### 2.6 Agente de Suporte Técnico (`suporte`)
- **Foco:** Resolução de dúvidas de utilização, consulta de status de entregas e encaminhamento de chamados.
- **Ferramentas Típicas:** `getOrderStatus`, `searchKnowledgeBase`, `escalateToHuman`.
- **Comportamento:** Consulta o histórico do cliente antes de responder; em casos críticos ou dúvidas não resolvidas, transfere a conversa para um atendente humano.

### 2.7 Agente de Administração (`administracao`)
- **Foco:** Consulta de métricas internas, relatórios de faturamento e monitorização de operações.
- **Ferramentas Típicas:** `getFinancialMetrics`, `getOrderStatus`, `getProductsCatalog`.
- **Comportamento:** Ferramenta exclusiva de uso interno pelo administrador da conta. Rejeita solicitações provenientes de números de clientes comuns.

### 2.8 Agente Multifuncional (`multifuncional`)
- **Foco:** Combinação flexível de vendas, suporte, pagamentos e qualificação de leads numa única persona unificada.
- **Ferramentas Típicas:** Todas as ferramentas autorizadas no painel do agente.
- **Comportamento:** Faz a transição natural entre as diferentes fases do atendimento conforme o cliente expressa necessidades distintas.

---

## 3. Modelo de Governança, Autonomia e Limites Financeiros

Para proteger a integridade operacional e financeira da empresa, o AgentX 2.0 implementa 3 níveis de autonomia configuráveis no construtor de agentes (`/agent`):

| Nível de Autonomia | Designação | Capacidades do Agente |
| :---: | :--- | :--- |
| **Nível 1** | **Supervisionado** | O agente atua apenas como consultor de informação. Sugere respostas e planos de ação, mas não executa mutações no banco de dados sem confirmação humana direta. |
| **Nível 2** | **Semi-Autónomo** | O agente executa autonomamente operações de risco baixo e médio (criação de pedidos pendentes, agendamento de reuniões, qualificação de leads e submissão de comprovativos). Operações com valores superiores ao `financial_limit` exigem validação. |
| **Nível 3** | **Autónomo em Ações Autorizadas** | O agente executa com total independência todas as ferramentas permitidas em `enabled_tools`, respeitando a regra mandatória de que validação de comprovativos e entregas digitais continuam sob governança em duas etapas. |

### Tolerância ao Risco (`risk_tolerance`)
- **Baixo (`low`):** Solicita confirmação explícita do cliente a cada passo. Não aplica descontos nem altera dados sensíveis.
- **Médio (`medium`):** Conduz o fluxo padrão de vendas e qualificação com intervenção humana apenas nas exceções.
- **Alto (`high`):** Maximiza velocidade de conversão e automação dentro dos limites estipulados.

---

## 4. Recuperação e Retomada de Estado

Em caso de reinício do servidor Node.js ou da VPS:
- Todos os estados dos pedidos e comprovativos estão persistidos no Supabase (`orders.status`, `payment_verifications.status`).
- Quando uma nova mensagem de um cliente com pedido pendente chega, o agente consulta `getOrderStatus` ou o histórico de interações e retoma exatamente o ponto onde a conversa parou (ex: *"Ainda estamos a aguardar a validação do seu comprovativo de 500 MT para o pedido AGX-492104"*), sem reiniciar o fluxo do zero.
