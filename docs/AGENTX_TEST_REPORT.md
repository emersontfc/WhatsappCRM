# RELATÓRIO DE TESTES AUTOMATIZADOS — KAZIX AGENTX

**Data:** 13 de Novembro de 2026  
**Responsável:** Equipa de Engenharia de Qualidade Kazix  
**Ambiente de Execução:** Local / Node.js 22 (Debian Bookworm / Windows Runtime)  
**Framework de Testes:** Vitest 5.1.0

---

## 1. RESUMO DA COBERTURA

| Categoria | Ficheiro de Teste | Testes Executados | Aprovados | Falhados | Taxa de Sucesso | Estado |
|---|---|---|---|---|---|---|
| **TypeScript Typecheck** | Global (`tsc --noEmit`) | 1 | 1 | 0 | 100% | ✅ Aprovado |
| **Vite Production Build** | Frontend (`vite build`) | 1 | 1 | 0 | 100% | ✅ Aprovado |
| **RBAC & Permissões** | `tests/auth-rbac.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Normalização Telefónica & JIDs** | `tests/phone-normalization.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Pipeline CRM & Estágios** | `tests/crm-pipeline.test.ts` | 5 | 5 | 0 | 100% | ✅ Aprovado |
| **Deduplicação & Estado WhatsApp** | `tests/whatsapp-dedup.test.ts` | 4 | 4 | 0 | 100% | ✅ Aprovado |
| **TOTAL GERAL** | 4 ficheiros de teste unitário | **21** | **21** | **0** | **100%** | **PRONTO PARA PRODUÇÃO** |

---

## 2. DETALHES DAS EXECUÇÕES

### 2.1 Compilação Estática TypeScript
* **Comando:** `npm run lint` (`tsc --noEmit`)
* **Resultado:** 0 erros de compilação. Tipagem estrita mantida em 100% dos ficheiros do backend e frontend.

### 2.2 Build de Produção do Frontend
* **Comando:** `npm run build` (`vite build`)
* **Resultado:** 2.174 módulos transformados com sucesso em `dist/`. Chunks minificados e ativos gerados em 9.32s.

### 2.3 Suíte de Testes Automatizados (Vitest)
* **Comando:** `npm test` (`vitest run`)
* **Duração Total:** 669ms
* **Resultados por Módulo:**
  1. `tests/auth-rbac.test.ts`:
     - ✅ Validação da hierarquia de papéis (`superadmin` > `admin` > `manager` > `operator` > `user`).
     - ✅ Validação de herança de permissões administrativas.
     - ✅ Bloqueio de operadores/utilizadores em rotas restritas de admin.
     - ✅ Extração e validação do token JWT Bearer.
     - ✅ Rejeição de cabeçalhos de autenticação forjados ou vazios.
  2. `tests/phone-normalization.test.ts`:
     - ✅ Normalização de números de Moçambique com 9 dígitos (prefixo 258 automático para Vodacom 84/85, Movitel 86/87, Tmcel 82/83).
     - ✅ Preservação de números com código internacional já presente.
     - ✅ Roteamento automático de identificadores WhatsApp Multi-Device LID (15 dígitos) para sufixo `@lid`.
     - ✅ Identificação de IDs de grupos WhatsApp (`@g.us`) e canais de transmissão.
     - ✅ Sanitização de caracteres sujos (`+`, `-`, espaços, parênteses).
  3. `tests/crm-pipeline.test.ts`:
     - ✅ Aceitação e persistência dos 5 estágios canónicos (`novo`, `em_atendimento`, `proposta_enviada`, `venda_fechada`, `perdido`).
     - ✅ Mapeamento e normalização de termos legados (`ganho` e `fechado` convertidos em `venda_fechada`).
     - ✅ Mapeamento de `atendimento` e `in_progress` para `em_atendimento`.
     - ✅ Mapeamento de `proposta` para `proposta_enviada`.
     - ✅ Rejeição de estágios desconhecidos com mensagem de erro descritiva.
  4. `tests/whatsapp-dedup.test.ts`:
     - ✅ Ingestão imediata de mensagens com identificador único (`msg_id`).
     - ✅ Rejeição e deduplicação atómica de entregas repetidas dentro da janela de 10 minutos.
     - ✅ Expiração e limpeza automática de cache de deduplicação após TTL.
     - ✅ Validação da máquina de estados do transporte WhatsApp (`disconnected` → `connecting` → `qr_ready` → `connected` → `reconnecting`).
