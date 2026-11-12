# ROADMAP DE IMPLEMENTAÇÃO E RESOLUÇÃO — KAZIX AGENTX

Este documento estabelece o estado de execução das fases de resolução, endurecimento de segurança, integração e homologação da plataforma SaaS.

---

## FASE 2: SEGURANÇA CRÍTICA (P0) — ✅ CONCLUÍDO
- [x] **2.1 Supabase & Credenciais**:
  - Removida chave `service_role` e URLs estáticas em `backend/supabaseAdmin.ts`.
  - Removida chave de fallback em `src/supabase.ts` (manter apenas `anon_key` via variáveis de ambiente).
  - Implementada validação estrita com `fail-fast` no arranque do backend caso variáveis obrigatórias faltem.
- [x] **2.2 Rastreio de Ficheiros Sensíveis no Git**:
  - Removidos ficheiros de sessão do WhatsApp (`whatsapp_sessions_data/*.json`) e arquivos de `uploads/` do índice do Git (`git rm --cached`).
  - Adicionados `whatsapp_sessions_data/`, `uploads/`, `*.session`, `*.key` ao `.gitignore`.
- [x] **2.3 Autenticação & RBAC**:
  - Eliminados e-mails de administradores hardcoded em `backend/routes/auth.ts` e `backend/routes/ai.ts`.
  - Implementada verificação de papéis no banco com suporte a `superadmin`, `admin`, `manager`, `operator`, `user`.
- [x] **2.4 Proteção de Uploads & Ficheiros**:
  - Adicionado middleware de sanitização contra Path Traversal em `/uploads/:filename` com cabeçalho `X-Content-Type-Options: nosniff`.
- [x] **2.5 Proteção de Privilégios no Agente de IA**:
  - Removida regex de nome ("emerson") e tags ("admin") em `backend/agentManager.ts`. Apenas telefones autorizados na tabela `users.admin_phones` ou utilizadores autenticados podem acionar ferramentas administrativas.

---

## FASE 3: MOTOR WHATSAPP & ABSTRAÇÃO DE TRANSPORTE (P1) — ✅ CONCLUÍDO
- [x] Formalizada máquina de estados de conexão: `disconnected → connecting → qr_ready → connected → reconnecting`.
- [x] Implementada interface `IWhatsAppTransport` em `backend/lib/whatsappTransport.ts` que desacopla o gerenciamento de sessões e permite futuramente conectar a Meta WhatsApp Cloud API oficial sem refatorar o CRM.
- [x] Garantida deduplicação atómica de mensagens recebidas em memória (`recentMessageIds`) e persistência segura em banco baseada em `msg_id`.

---

## FASE 4: AGENTE DE IA AUTÓNOMO & FERRAMENTAS REAIS (P1) — ✅ CONCLUÍDO
- [x] Corrigidas as ferramentas de CRM do agente (`createLead`, `moveLeadStage`, `getPipelineMetrics`):
  - Mapeamento para o campo oficial `stage` com atualização síncrona do campo legado `status`.
  - Alinhamento dos valores das etapas: `"novo"`, `"em_atendimento"`, `"proposta_enviada"`, `"venda_fechada"`, `"perdido"` (substituindo o antigo termo divergente `"ganho"`).
- [x] Memória de conversação durável: reconstrução automática do histórico recente das últimas 8 interações a partir da tabela `messages`, mantendo o contexto mesmo após reinício do servidor.
- [x] Bloqueio estrito de execução quando o agente estiver desativado (`is_active = false`), eliminando fallback inseguro.

---

## FASE 5: CRM E FUNIL DE VENDAS (P1) — ✅ CONCLUÍDO
- [x] Estabelecido `stage` como a fonte única da verdade para etapas no banco de dados com sincronização bidirecional em tempo real para o campo `status`.
- [x] Unificação dos filtros do Kanban (`Leads.tsx`) e métricas do pipeline (`getPipelineMetrics.ts`).

---

## FASE 6: AUTOMAÇÕES, MENUS E AGENDADOR (P1) — ✅ CONCLUÍDO
- [x] Blindado `scheduler.ts` com recuperação de órfãos (`processing > 15m`), trava atómica contra concorrência e fila de re-tentativa exponencial (até 3 tentativas).
- [x] Normalização de captura automática de leads no `automationManager.ts` preservando `stage: "novo"` e `status: "novo"`.

---

## FASE 8: ADMINISTRAÇÃO, PLANOS E LICENÇAS (P1) — ✅ CONCLUÍDO
- [x] Limpeza e saneamento de subscrições duplicadas no banco com política de 1 subscrição ativa por utilizador.
- [x] Validação estrita de limites diários de mensagens por plano no backend (`backend/routes/whatsapp.ts`).
- [x] Reformulação visual da página de ativação comercial (`Activate.tsx`) com dados M-Pesa / eMola e suporte a contas admin ilimitadas.

---

## FASE 10: DEVOPS, DOCKER & PRODUÇÃO (P1) — ✅ CONCLUÍDO
- [x] Restringidas portas no `docker-compose.yml` para `127.0.0.1:3000:3000`, forçando tráfego externo a passar pelo Nginx.
- [x] Configuração Nginx atualizada para `agentx.kazix.site` com suporte completo a WebSocket, HTTP/2 e certificados SSL Certbot.
- [x] Definidos limites de memória no Docker Compose (`mem_limit: 1800m`, `mem_reservation: 512m`) otimizados para a VPS de ~3.7 GiB de RAM.

---

## FASE 11: TESTES AUTOMATIZADOS (P1) — ✅ CONCLUÍDO
- [x] Framework de testes `vitest` instalado e configurado em `package.json` (`npm test`).
- [x] Implementados 4 ficheiros de testes unitários com 19 testes automatizados cobrindo RBAC, normalização telefónica/LID, pipeline CRM e deduplicação do WhatsApp (100% de aprovação).
- [x] Compilação TypeScript (`npm run lint`) com 0 erros estáticos e build de produção Vite (`npm run build`) validado.
