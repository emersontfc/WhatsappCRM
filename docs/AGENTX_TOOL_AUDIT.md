# Auditoria e Matriz de Ferramentas — Kazix AgentX

**Data:** 15 de Novembro de 2026  
**Responsável:** Equipa de Engenharia Full-Stack & Agentes Autónomos Kazix  
**Ambiente:** Node.js 22 / TypeScript / Supabase PostgreSQL / Baileys WhatsApp  
**Total de Ferramentas Registadas:** 24 ferramentas formais

---

## 1. Matriz de Auditoria do Registro Central de Ferramentas

| Ferramenta | Categoria | Papel Autorizado | Nível de Risco | Estado Anterior | Estado Atual | Tratamento de Erros |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`schedule_message`** | Automações | `admin` | Médio | ⚠️ Falha em datas relativas | ✅ **Corrigido** | Suporta linguagem natural ('amanhã às 9h') via `dateTimeParser`, fuso `Africa/Maputo`. Retorna `RECIPIENT_NOT_FOUND` / `INVALID_ARGUMENTS`. |
| **`list_scheduled_messages`** | Automações | `admin` | Baixo | ❌ Não existia | ✅ **Criado** | Lista mensagens e faturas agendadas com paginação e status ('pending', 'sent', 'failed'). |
| **`cancel_scheduled_message`** | Automações | `admin` | Médio | ❌ Não existia | ✅ **Criado** | Cancela agendamentos pendentes por ID ou por destinatário com confirmação atómica. |
| **`post_whatsapp_status`** | Mensagens | `admin` | Médio | ❌ Não existia | ✅ **Criado** | Publicação IMEDIATA no Status do WhatsApp (texto, imagem, vídeo). Valida sessão (`SESSION_NOT_CONNECTED`). |
| **`schedule_status`** | Automações | `admin` | Médio | ⚠️ Falha na data formatada | ✅ **Corrigido** | Agenda postagem no Status para data futura. Suporta texto puro e mídia com `dateTimeParser`. |
| **`list_scheduled_status`** | Automações | `admin` | Baixo | ❌ Não existia | ✅ **Criado** | Lista status futuros agendados pelo utilizador. |
| **`cancel_scheduled_status`** | Automações | `admin` | Médio | ❌ Não existia | ✅ **Criado** | Cancela status pendentes antes da publicação. |
| **`getProductsCatalog`** | Comércio | `admin`, `lead` | Baixo | ✅ Funcional | ✅ **Mantido** | Consulta catálogo ativo de produtos e serviços. |
| **`createOrder`** | Comércio | `admin`, `lead` | Médio | ✅ Funcional | ✅ **Mantido** | Cria pedidos formais (`AGX-XXXXXX`) e instruções M-Pesa / e-Mola. |
| **`getOrderStatus`** | Comércio | `admin`, `lead` | Baixo | ✅ Funcional | ✅ **Mantido** | Rastreia situação de pedidos no CRM. |
| **`submitPaymentProof`** | Pagamentos | `admin`, `lead` | Médio | ✅ Funcional | ✅ **Mantido** | Extração de comprovativos M-Pesa/e-Mola e envio para fila de aprovação. |
| **`getFinancialMetrics`** | Admin | `admin` | Crítico | ✅ Funcional | ✅ **Mantido** | Métricas de faturamento e taxas de conversão (protegida para administradores). |
| **`qualifyLead`** | CRM | `admin`, `lead` | Baixo | ✅ Funcional | ✅ **Mantido** | Pontuação de leads (lead scoring) e tags de interesse. |
| **`createMarketingCampaign`** | Marketing | `admin` | Médio | ✅ Funcional | ✅ **Mantido** | Disparos segmentados com salvaguarda anti-spam (mínimo de 10s). |
| **`get_pending_conversations`**| CRM | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Lista conversas não respondidas. |
| **`get_pipeline_metrics`** | CRM | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Métricas das etapas do funil de vendas. |
| **`search_contact`** | CRM | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Busca contactos por telefone ou nome. |
| **`moveLeadStage`** | CRM | `admin` | Médio | ✅ Funcional | ✅ **Mantido** | Avança lead entre estágios do funil. |
| **`create_lead`** | CRM | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Cadastro rápido de novos leads. |
| **`sendDirectMessage`** | Mensagens | `admin` | Médio | ✅ Funcional | ✅ **Mantido** | Envio direto de mensagem para contacto. |
| **`pause_ai`** | Mensagens | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Pausa atendimento automático para um contacto. |
| **`resume_ai`** | Mensagens | `admin` | Baixo | ✅ Funcional | ✅ **Mantido** | Retoma atendimento por IA. |
| **`createKeywordAutomation`** | Automações | `admin` | Médio | ✅ Funcional | ✅ **Mantido** | Cria gatilhos de palavras-chave. |
| **`createReminderFollowup`** | Automações | `admin` | Médio | ✅ Funcional | ✅ **Mantido** | Lembretes automáticos para tarefas futuras. |

---

## 2. Códigos de Erro Estruturados Padronizados

Todas as ferramentas agora devolvem respostas estruturadas com código e flag de possibilidade de repetição (`retryable`):

```json
{
  "success": false,
  "code": "SESSION_NOT_CONNECTED",
  "message": "A sessão WhatsApp não está conectada. Conecte o aparelho antes de prosseguir.",
  "retryable": true
}
```

Códigos oficiais implementados:
- `SUCCESS`: Execução bem-sucedida com persistência confirmada.
- `SESSION_NOT_CONNECTED`: Sessão Baileys desconectada; orienta o utilizador a reconectar.
- `RECIPIENT_NOT_FOUND`: Número ou contacto não localizado no catálogo do CRM.
- `INVALID_ARGUMENTS`: Parâmetros obrigatórios ausentes ou em formato inválido.
- `RESOURCE_NOT_FOUND`: Agendamento ou pedido inexistente ao tentar cancelar.
- `PERSISTENCE_FAILED`: Falha na gravação no Supabase; erro reportado sem falsa confirmação.
- `EXECUTION_FAILED`: Erro em tempo de execução capturado com stack trace seguro.
