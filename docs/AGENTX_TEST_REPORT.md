# RELATÓRIO DE TESTES AUTOMATIZADOS — KAZIX AGENTX 2.0

**Data:** 15 de Novembro de 2026  
**Responsável:** Equipa de Engenharia de Qualidade Kazix  
**Ambiente de Execução:** Local / Node.js 22 (Debian Bookworm / Windows Runtime)  
**Framework de Testes:** Vitest 5.1.0

---

## 1. RESUMO DA COBERTURA GLOBAL

| Categoria | Ficheiro de Teste | Testes Executados | Aprovados | Falhados | Taxa de Sucesso | Estado |
|---|---|---|---|---|---|---|
| **TypeScript Typecheck** | Global (`tsc --noEmit`) | 1 | 1 | 0 | 100% | ✅ Aprovado |
| **Vite Production Build** | Frontend (`vite build`) | 1 | 1 | 0 | 100% | ✅ Aprovado |
| **Persistência de Perfil (Fase 6)** | `tests/business-type-persistence.test.ts` | 7 | 7 | 0 | 100% | ✅ Aprovado |
| **Agendamento & Status (Fase 8)** | `tests/agent-scheduling-status.test.ts` | 8 | 8 | 0 | 100% | ✅ Aprovado |
| **AgentX Comércio & Pagamentos** | `tests/agentx-commerce-flow.test.ts` | 10 | 10 | 0 | 100% | ✅ Aprovado |
| **RBAC & Permissões** | `tests/auth-rbac.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Normalização Telefónica & JIDs** | `tests/phone-normalization.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Pipeline CRM & Estágios** | `tests/crm-pipeline.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Deduplicação & Estado WhatsApp** | `tests/whatsapp-dedup.test.ts` | 4 | 4 | 0 | 100% | ✅ Aprovado |
| **Sistema de Mensagens & Baileys 7 LID** | `tests/messaging-system.test.ts` | 8 | 8 | 0 | 100% | ✅ Aprovado |
| **TOTAL GERAL** | 8 ficheiros de teste automatizado | **52** | **52** | **0** | **100%** | **PRONTO PARA PRODUÇÃO** |

---

## 2. DETALHES DOS TESTES DE PERSISTÊNCIA DE PERFIL (`business-type-persistence.test.ts`)

- ✅ **Teste 1:** Entrar com perfil Clínica → Alterar para Geral → Recarregar página → Continua Geral.
- ✅ **Teste 2:** Alterar para Geral → Terminar sessão → Entrar novamente → Continua Geral (fonte única no Supabase).
- ✅ **Teste 3:** Alterar perfil num dispositivo → Entrar noutro dispositivo → Carrega o perfil correto via `/api/company/profile`.
- ✅ **Teste 4:** Alterar perfil → Navegar entre páginas → A sidebar permanece consistente.
- ✅ **Teste 5:** Falha ao guardar configuração → Apresentar erro → Não fingir que a alteração foi guardada.
- ✅ **Teste 6:** Utilizador de outra empresa → Bloqueado pelo isolamento multi-tenant.
- ✅ **Teste 7:** Alterar Clínica para Geral e voltar para Clínica → Dados, contactos e permissões permanecem 100% intactos.

---

## 3. DETALHES DO MOTOR DE AGENDAMENTO E STATUS (`agent-scheduling-status.test.ts`)

- ✅ **Cenário A (Agendamento em Linguagem Natural):** Interpreta "amanhã às 9 horas" com precisão no fuso horário `Africa/Maputo` (UTC+2); interpreta "daqui a 2 horas"; formata saída com dados reais para o WhatsApp.
- ✅ **Cenário B (Publicação de Status no WhatsApp):** Bloqueia publicação com código `SESSION_NOT_CONNECTED` quando a sessão está offline; publica com sucesso para `status@broadcast` quando conectada.
- ✅ **Cenários C & D (Perfis Diferenciados):** Organização consistente de ferramentas entre Clínica e Geral.
- ✅ **Cenário E (Falhas Estruturadas):** Erros de contacto não geram falsa confirmação de sucesso.
- ✅ **Cenário F (Recuperação de Reinício):** Tarefas órfãs em 'processing' por mais de 15 minutos são revertidas para 'pending' e processadas no próximo ciclo.

---

## 4. COMPILAÇÃO E BUILDS DE PRODUÇÃO

1. **TypeScript Typecheck (`tsc --noEmit`):**
   - 0 erros de compilação em 100% dos ficheiros do frontend, backend e suíte de testes.
2. **Vite Production Build (`vite build`):**
   - 2.176 módulos transformados com sucesso em 23.10s.
   - Chunks minificados e ativos gerados em `dist/`.

---

## 5. DETALHES DOS TESTES DO SISTEMA DE MENSAGENS (`messaging-system.test.ts`)

- ✅ **Teste 1:** Bloqueio de contactos espúrios para grupos (`@g.us`), transmissões (`@broadcast`) e newsletters.
- ✅ **Teste 2:** Normalização correta de JID de telefone moçambicano (`@s.whatsapp.net`).
- ✅ **Teste 3:** Proibição absoluta de inventar telefones a partir de LIDs (`@lid`); isolamento em coluna própria `lid`.
- ✅ **Teste 4:** Emparelhamento dinâmico Baileys 7 via `remoteJidAlt` no mesmo contacto sem duplicar.
- ✅ **Teste 5:** Formatação visual graciosa de contactos por LID na interface (`getContactDisplay`).
- ✅ **Teste 6:** Deduplicação atómica de mensagens por `msg_id` em reconexões e histórico.
- ✅ **Teste 7:** Persistência de mídias ricas (áudio, fotos, vídeos, documentos e stickers).
- ✅ **Teste 8:** Alternância instantânea de atendimento Humano vs IA (`ai_paused`).
