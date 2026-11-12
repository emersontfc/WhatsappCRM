# ROADMAP DE IMPLEMENTAÇÃO E RESOLUÇÃO — KAZIX AGENTX

Este documento estabelece a sequência executiva de resolução de problemas, correções de segurança, integração e homologação da plataforma SaaS.

---

## FASE 2: SEGURANÇA CRÍTICA (P0) — EM EXECUÇÃO
- [ ] **2.1 Supabase & Credenciais**:
  - Remover chave `service_role` e URLs estáticas em `backend/supabaseAdmin.ts`.
  - Remover chave de fallback em `src/supabase.ts` (manter apenas `anon_key` via variáveis de ambiente).
  - Implementar validação estrita com `fail-fast` no arranque do backend caso variáveis obrigatórias faltem.
- [ ] **2.2 Rastreio de Ficheiros Sensíveis no Git**:
  - Remover ficheiros de sessão do WhatsApp (`whatsapp_sessions_data/*.json`) e arquivos de `uploads/` do índice do Git (`git rm --cached`).
  - Adicionar `whatsapp_sessions_data/`, `uploads/`, `*.session`, `*.key` ao `.gitignore`.
- [ ] **2.3 Autenticação & RBAC**:
  - Eliminar e-mails de administradores hardcoded em `backend/routes/auth.ts` e `backend/routes/ai.ts`.
  - Implementar verificação de papéis no banco com suporte a `superadmin`, `admin`, `manager`, `operator`, `user`.
- [ ] **2.4 Proteção de Uploads & Ficheiros**:
  - Adicionar middleware de verificação de autenticação e proteção contra Path Traversal em `/uploads/:filename`.
- [ ] **2.5 Proteção de Privilégios no Agente de IA**:
  - Remover regex de nome ("emerson") e tags ("admin") em `backend/agentManager.ts`. Apenas telefones autorizados na tabela `users.admin_phones` ou utilizadores autenticados podem acionar ferramentas administrativas.

---

## FASE 3: MOTOR WHATSAPP & ABSTRAÇÃO DE TRANSPORTE (P1)
- [ ] Formalizar máquina de estados de conexão: `disconnected → connecting → qr_ready → connected → reconnecting`.
- [ ] Implementar interface `IWhatsAppTransport` que desacopla o gerenciamento de sessões e permite futuramente conectar a Meta WhatsApp Cloud API sem refatorar o CRM.
- [ ] Garantir deduplicação atómica de mensagens recebidas baseada em `msg_id`.

---

## FASE 4: AGENTE DE IA AUTÓNOMO & FERRAMENTAS REAIS (P1)
- [ ] Corrigir as ferramentas de CRM do agente (`createLead`, `moveLeadStage`, `getPipelineMetrics`):
  - Mapear para o campo oficial `stage`.
  - Alinhar valores das etapas: `"novo"`, `"em_atendimento"`, `"proposta_enviada"`, `"venda_fechada"`, `"perdido"` (substituindo o antigo termo divergente `"ganho"`).
- [ ] Memória de conversação durável: reconstruir o histórico recente a partir da tabela `messages` sob demanda, garantindo que o agente mantenha o contexto mesmo após reinício do servidor.
- [ ] Bloqueio estrito de execução quando o agente estiver desativado (`is_active = false`).

---

## FASE 5: CRM E FUNIL DE VENDAS (P1)
- [ ] Estabelecer `stage` como a fonte única da verdade para etapas no banco de dados e garantir sincronização bidirecional com o campo legado `status`.
- [ ] Assegurar que métricas do pipeline reflitam valores em tempo real para os filtros do Kanban.

---

## FASE 6: AUTOMAÇÕES, MENUS E AGENDADOR (P1)
- [ ] Blindar `scheduler.ts` com trava de concorrência atómica para evitar envios duplicados em caso de lentidão temporária ou reinicializações.
- [ ] Persistência de estado dos menus inteligentes para não perder a navegação se o servidor reiniciar no meio de uma escolha de menu.

---

## FASE 8: ADMINISTRAÇÃO, PLANOS E LICENÇAS (P1)
- [ ] Garantir resgate atómico de senhas de ativação (`activate-license`) prevenindo condições de corrida (`race conditions`).
- [ ] Validação estrita de limites de mensagens por plano no backend (`backend/routes/whatsapp.ts`).

---

## FASE 10: DEVOPS, DOCKER & PRODUÇÃO (P1)
- [ ] Restringir portas no `docker-compose.yml` para `127.0.0.1:3000:3000`.
- [ ] Atualizar configurações do Nginx para `agentx.kazix.site`.
- [ ] Definir limites de memória no Docker Compose compatíveis com a VPS de 3.7 GiB de RAM.

---

## FASE 11: TESTES AUTOMATIZADOS (P1)
- [ ] Instalar `vitest` e `@types/node`.
- [ ] Implementar testes unitários para ferramentas de CRM, validação de limites de planos e normalização de números.
- [ ] Executar typecheck e build de produção para assegurar 0 erros.
