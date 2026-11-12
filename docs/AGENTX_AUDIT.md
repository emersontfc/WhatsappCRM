# AUDITORIA TÉCNICA E INVENTÁRIO FUNCIONAL — KAZIX AGENTX
**Data da Auditoria:** 12 de Novembro de 2026  
**Ambiente:** Windows (Dev) / Ubuntu VPS 3.7 GiB RAM (Produção Prevista)  
**Domínio:** `agentx.kazix.site`  
**Repositório:** `https://github.com/emersontfc/WhatsappCRM` (Branch: `feature/audit-repair-production`)

---

## 1. RESUMO EXECUTIVO DA AUDITORIA

O projeto **Kazix AgentX / WhatsAppCRM** é uma solução SaaS completa para automação de atendimento comercial, CRM e agente autónomo via WhatsApp, desenvolvida com React (TypeScript), Node.js (Express), Baileys e Supabase (PostgreSQL).

A auditoria exaustiva ao código-fonte, configurações e base de dados revelou que:
1. **Fundação e UI:** O frontend possui uma estrutura visual rica, componentes estilizados com Tailwind CSS e páginas dedicadas para quase todas as funções comerciais (Kanban de Leads, Mensagens em tempo real, Agente de IA, Agendamentos, Automações e Planos).
2. **Vulnerabilidades de Segurança Críticas (P0):**
   - Chave `service_role` administrativa do Supabase exposta como fallback estático no código em `backend/supabaseAdmin.ts` e erroneamente importada no frontend em `src/supabase.ts`.
   - Ficheiros de credenciais de sessão do WhatsApp (`whatsapp_sessions_data/*.json`) e uploads de utilizadores (`uploads/*`) foram commitados e estavam a ser rastreados no Git.
   - Rotas de registo e IA continham e-mails de administradores codificados estaticamente (`isAdminEmail = email === "..."`).
   - Identificação de privilégios de administrador no Agente de IA via regex no nome do contacto (`/emerson/i.test(contactData.name)`) ou etiqueta, permitindo escalada indevida de privilégios por mensagem de terceiros.
   - A pasta `/uploads` era servida publicamente via `express.static` sem verificação de autenticação ou isolamento de tenant.
3. **Inconsistências Funcionais Críticas (P1):**
   - Inconsistência no CRM: A tabela `leads` e o frontend utilizam a coluna `stage` (`novo`, `em_atendimento`, `proposta_enviada`, `venda_fechada`, `perdido`), enquanto as ferramentas do Agente de IA (`createLead`, `moveLeadStage`, `getPipelineMetrics`) gravavam e consultavam a coluna legada `status`, além de usarem termos divergentes como `"ganho"` em vez de `"venda_fechada"`.
   - A memória conversacional do Agente de IA (`contextCache`) e o estado dos menus de automação (`menuStateCache`) operavam apenas em memória RAM (`Map`), perdendo todo o contexto ao reiniciar o servidor ou contentor Docker.
   - O agendador (`scheduler.ts`) executava em `setInterval` simples sem controlo atómico de concorrência ou recuperação de falhas idempotente.
4. **DevOps & Infraestrutura (P1):**
   - O `docker-compose.yml` expunha a porta `3000:3000` publicamente para a rede em vez de restringir a `127.0.0.1:3000:3000` para o proxy Nginx.
   - Ausência de suite de testes automatizados (`vitest`/`jest`) configurada no `package.json`.

---

## 2. MATRIZ GERAL DE AUDITORIA FUNCIONAL E TÉCNICA

| Módulo / Funcionalidade | Estado Real | Problema Identificado | Prioridade | Solução de Engenharia |
|---|---|---|---|---|
| **Segurança — Credenciais Supabase** | Inseguro | Chave `service_role` administrativa embutida em código claro em `backend/supabaseAdmin.ts` e `src/supabase.ts`. | **P0** | Remover todas as chaves estáticas. Exigir variáveis de ambiente no boot com fail-fast seguro. Frontend deve usar exclusivamente a chave pública `anon`. |
| **Segurança — Repositório & Git** | Inseguro | Pasta `whatsapp_sessions_data/` (com chaves criptográficas ativas) e `uploads/` rastreadas no Git. | **P0** | Remover do tracking do Git com `git rm --cached`, adicionar regras estritas no `.gitignore`, proteger arquivos locais. |
| **Segurança — Autenticação & RBAC** | Inseguro | Verificação de administradores por lista estática de e-mails em `auth.ts` e `ai.ts`. Falta de RBAC hierárquico. | **P0** | Eliminar e-mails hardcoded. Implementar RBAC estruturado (`superadmin`, `org_admin`, `manager`, `operator`, `user`) e validação de tenant. |
| **Segurança — Armazenamento `/uploads`** | Inseguro | Servido via `express.static` sem autenticação. Qualquer ficheiro podia ser baixado por URL pública. | **P0** | Implementar middleware autenticado com validação de tenant, MIME type e prevenção contra path traversal. |
| **Segurança — IA Privilege Escalation** | Inseguro | Agente de IA tratava remetente como admin se o nome do contacto contivesse "emerson" ou tag "admin". | **P0** | Eliminar regex de nome/tag. Autorização exclusiva baseada em identidade verificada no backend (JWT/telefone administrativo registado). |
| **WhatsApp — Máquina de Estados & Conexão** | Parcialmente implementado | Estados de conexão misturavam `connecting`, `qr`, `connected`. Sem camada de abstração de transporte. | **P1** | Implementar máquina de estados formal (`disconnected → connecting → qr_ready → connected → reconnecting`). Criar interface de transporte `IWhatsAppTransport`. |
| **WhatsApp — Envio e Receção Multimédia** | Totalmente operacional | Envio e receção de áudio Opus, imagens, vídeos e documentos funcionando via Baileys e FFmpeg. | **OK** | Manter e adicionar validação de quotas diárias por plano. |
| **WhatsApp — Roteamento de LIDs e 1-on-1** | Totalmente operacional | LIDs de 15 dígitos suportados e integrados no envio `@lid` e filtros da interface. | **OK** | Garantir que números moçambicanos e internacionais continuem visíveis sem cortes de tamanho. |
| **Agente de IA — Gestão e CRUD** | Parcialmente implementado | CRUD básico existe, mas sem validação de horários de funcionamento ou controle de custos/timeouts. | **P1** | Implementar validação de horário comercial, timeout por inferência e bloqueio seguro caso o agente esteja desativado. |
| **Agente de IA — Ferramentas (Tools)** | Funcionalidade com bug de integração | Ferramentas (`create_lead`, `move_lead_stage`, `get_pipeline_metrics`) gravavam `status` e `"ganho"` em vez de `stage` e `"venda_fechada"`. | **P1** | Unificar campos no banco e nas ferramentas. `stage` como fonte única da verdade compatível com o Kanban. |
| **Agente de IA — Memória Persistente** | Funcionalidade insegura / volátil | Memória conversacional (`contextCache`) operava apenas num `Map` em memória RAM, perdida no restart. | **P1** | Persistir histórico de contexto diretamente na tabela `messages` e carregar sob demanda com retenção configurável. |
| **CRM — Contactos & Leads Kanban** | Totalmente operacional | Kanban funcional, cálculo de métricas comerciais, exportação CSV, adição manual de leads. | **OK** | Sincronizar perfeitamente as movimentações de etapas entre utilizadores manuais e o Agente de IA. |
| **CRM — Isolamento Multi-Tenant** | Parcialmente implementado | Consultas utilizam `user_id`, mas sem suporte explícito a múltiplos operadores numa mesma empresa (`org_id`). | **P1** | Estruturar modelo de `company_id` / `org_id` mantendo retrocompatibilidade total com `user_id`. |
| **Automações — Gatilhos de Palavras-Chave** | Totalmente operacional | Normalização NFD sem acentos e atraso simulado de digitação implementados. | **OK** | Manter e expandir testes unitários. |
| **Automações — Menus Inteligentes** | Parcialmente implementado | `menuStateCache` em memória RAM. Respostas de menus perdidas se o servidor reiniciar durante a conversa. | **P1** | Persistir estado ativo do menu na tabela `smart_menus` ou estado transitório no PostgreSQL. |
| **Agendador — Mensagens & Status** | Parcialmente implementado | `scheduler.ts` roda via `setInterval`. Sem bloqueio atómico contra execução duplicada em clusters. | **P1** | Implementar trava de processamento com transação no banco de dados e controle de tentativas (backoff). |
| **Agendamentos de Consultas** | Totalmente operacional | Rotas `/api/appointments`, lembretes automáticos de 24h e 2h no WhatsApp, cálculo de slots. | **OK** | Manter e assegurar fuso horário Moçambique (`Africa/Maputo`). |
| **Planos & Licenças — Ativação** | Totalmente operacional | Ativação via códigos M-Pesa/eMola com planos Starter (300 MT), Pro (900 MT) e Premium (1.800 MT). | **OK** | Garantir que a validação de quotas de mensagens e contatos seja atómica e ocorra sempre no backend. |
| **Interface — Dashboard & Mensagens** | Totalmente operacional | Chat web com visualização de mensagens recebidas/enviadas, suporte a áudio gravado e tags. | **OK** | Revisar estados de carregamento e mensagens de erro para melhor acessibilidade. |
| **DevOps — Docker & Nginx** | Parcialmente implementado | Dockerfile otimizado com Debian Slim e FFmpeg. Nginx com SSL e WebSockets. Porta 3000 exposta externamente. | **P1** | Limitar porta no `docker-compose.yml` para `127.0.0.1:3000:3000`. Configurar limites de memória (`deploy.resources.limits`). |
| **Testes Automatizados** | Inexistente | Nenhuma suite de testes unitários ou de integração configurada no `package.json`. | **P1** | Instalar `vitest` e criar testes para RBAC, ferramentas de IA, funil CRM, normalização de telefone e agendamento. |

---

## 3. PLANO DE AÇÃO IMEDIATO (FASE 2 EM DIANTE)

1. **FASE 2 (Segurança):**
   - Limpeza definitiva das credenciais no código (`backend/supabaseAdmin.ts` e `src/supabase.ts`).
   - Remoção de `whatsapp_sessions_data/` e `uploads/` do Git e adição ao `.gitignore`.
   - Remoção de e-mails de admin hardcoded e regex de nomes no Agente de IA.
   - Proteção autenticada de `/uploads` contra acesso anónimo e path traversal.
2. **FASE 3 & 4 (WhatsApp e IA):**
   - Camada de abstração `WhatsAppTransport` para Baileys e futura Cloud API.
   - Correção do alinhamento de etapas do funil nas ferramentas de IA (`stage: 'venda_fechada'`).
   - Persistência da memória do agente usando o histórico real da tabela `messages`.
3. **FASE 5 & 6 (CRM e Automações):**
   - Alinhamento de fonte única de verdade entre `stage` e `status` com triggers no banco.
   - Idempotência no processamento do `scheduler.ts`.
4. **FASE 10 & 11 (DevOps e Testes):**
   - Instalação e configuração do `vitest`.
   - Criação de testes unitários e de integração com mocks.
   - Ajuste de portas e limites de memória no `docker-compose.yml`.
