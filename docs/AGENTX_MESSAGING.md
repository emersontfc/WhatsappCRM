# KAZIX AGENTX — SISTEMA DE MENSAGENS E ARQUITETURA BAILEYS 7

**Versão:** 2.1 (Definitiva)  
**Data:** 15 de Novembro de 2026  
**Módulos Envolvidos:** `backend/whatsappManager.ts`, `src/pages/Messages.tsx`, `backend/routes/whatsapp.ts`, `backend/agentManager.ts`, `backend/automationManager.ts`, `supabase/migrations/10_contacts_lid_support.sql`

---

## 1. DIAGNÓSTICO E PROBLEMAS CORRIGIDOS

### 1.1 Invenção de Números de Telefone a partir de LIDs (`@lid`)
- **Problema Anterior:** A função `getOrCreateContact()` extraía dígitos cegamente de qualquer JID (`jid.split("@")[0].replace(/\D/g, "")`). Quando um utilizador enviava mensagem a partir de um identificador LID (ex: `104928502847592@lid`), o sistema interpretava esses 15 dígitos como se fossem um número telefónico e prefixava com o código moçambicano `258`, gerando telefones falsos (ex: `258104928502847592`) e duplicando contactos.
- **Correção Definitiva:**
  - Separação clara entre identificadores de grupo (`@g.us`), transmissões (`@broadcast`), newsletters (`@newsletter`), telefones (`@s.whatsapp.net`) e LIDs (`@lid`).
  - LIDs **nunca** geram números telefónicos falsos. Se o número real não estiver disponível, o contacto é guardado com `lid = "<digitos_lid>"` e `phone = ""`.
  - Integração com Baileys 7: extração de `remoteJidAlt` e `participantAlt` dos metadados da mensagem para associar e emparelhar automaticamente o número de telefone real com o LID correspondente no mesmo contacto.
  - Consulta ao repositório Signal (`socket.signalRepository.lidMapping`) do Baileys para resolver pares LID/PN.

### 1.2 Fusões Falsas de Contactos por Nome Fuzzy
- **Problema Anterior:** O código anterior executava `ilike("name", ...cleanName...)`, fundindo contactos diferentes que partilhassem palavras comuns nos seus push names (ex: "Carlos", "John").
- **Correção:** Eliminação da correspondência fuzzy de nomes. A identificação de contactos é rigorosamente baseada na identidade WhatsApp verificada (telefone e/ou LID).

### 1.3 Mensagens Duplicadas e Inserções Concorrentes
- **Problema Anterior:**
  - Quando um operador enviava uma mensagem em `/api/whatsapp/send`, o método `whatsappManager.sendMessage` inseria a mensagem na tabela `messages` via `syncMessage()`. Imediatamente a seguir, a própria rota `/send` executava uma **segunda inserção manual** na tabela `messages`.
  - Em `backend/automationManager.ts`, o envio de respostas automáticas, menus e quick replies também chamava `sendMessage` e depois executava outra inserção manual.
  - Isso gerava mensagens duplicadas na interface e no banco de dados.
- **Correção:**
  - `syncMessage()` é a **única fonte da verdade** para persistência e deduplicação de mensagens.
  - Todas as chamadas usam verificação atómica por `(user_id, msg_id)`.
  - A Migration 10 limpou mensagens históricas duplicadas e aplicou o índice de unicidade `CREATE UNIQUE INDEX idx_messages_user_msg_id ON public.messages(user_id, msg_id) WHERE msg_id IS NOT NULL AND msg_id != '';`.

### 1.4 Incremento Duplo do Contador de Não Lidas (`unread_count`)
- **Problema Anterior:** Para cada mensagem recebida, tanto `syncMessage()` quanto `handleIncomingMessage()` incrementavam o `unread_count` em `+1`, fazendo o contador saltar de 2 em 2.
- **Correção:** O incremento de `unread_count` foi unificado exclusivamente dentro de `syncMessage()`.

---

## 2. MIGRAÇÃO 10 NO SUPABASE (`10_contacts_lid_support.sql`)

Aplicada e verificada com sucesso no Supabase remoto:
```sql
-- 1. Suporte para LID em contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lid TEXT;
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;

-- 2. Índices de alta performance
CREATE INDEX IF NOT EXISTS idx_contacts_user_lid ON public.contacts(user_id, lid);
CREATE INDEX IF NOT EXISTS idx_contacts_user_phone ON public.contacts(user_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_last_message ON public.contacts(user_id, last_message_at DESC NULLS LAST);

-- 3. Rastreamento e deduplicação atómica
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS msg_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_filename TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_user_contact_ts ON public.messages(user_id, contact_id, timestamp ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_user_msg_id ON public.messages(user_id, msg_id) WHERE msg_id IS NOT NULL AND msg_id != '';
```

---

## 3. EXPERIÊNCIA DA ABA MENSAGENS (ESTILO WHATSAPP WEB)

Melhorias implementadas em `src/pages/Messages.tsx`:

1. **Lista Dinâmica de Conversas (Sidebar):**
   - Suporte completo a contactos com LID: exibição limpa de `WhatsApp (xxxx)` e subtítulo `LID: xxxxxxxx` quando o número não estiver disponível.
   - Pesquisa em tempo real por **Nome**, **Telefone**, **LID** e **Texto da Última Mensagem**.
   - Filtros dinâmicos: Todos, Não Lidas, IA Ativa, Humano, Leads.
   - Badges verdes de mensagens não lidas e indicadores de estado da IA.

2. **Renderização Rica de Mídia:**
   - **Notas de Voz:** Player inline exclusivo (`VoiceMessagePlayer`) com botão Play/Pause, barra de progresso interativa (seek), tempo decorrido/total e seletor de velocidade (1x, 1.5x, 2x).
   - **Fotos:** Miniatura com cantos arredondados e efeito hover para abrir no **Lightbox Modal** ampliado com zoom e botão de download.
   - **Vídeos:** Player HTML5 nativo com controles completos.
   - **Documentos:** Cartão estilizado com ícone do arquivo, nome do documento, extensão e botão de download direto.
   - **Stickers:** Exibição transparente autêntica do WhatsApp sem fundo de balão desnecessário.

3. **Auto-Scroll Inteligente:**
   - O chat detecta se o utilizador está perto do fim da conversa (`isNearBottom`) antes de rolar automaticamente.
   - Se o utilizador tiver rolado para cima para ler o histórico antigo, a tela não salta bruscamente.
   - Um botão flutuante estilizado `[↓]` surge para permitir descer instantaneamente para as mensagens mais recentes.

4. **Envio de Anexos Direto da Caixa de Entrada:**
   - Botão de clipe (`Paperclip`) para selecionar fotos, vídeos, notas de áudio e documentos direto da interface.
   - Upload automático via `/api/media/upload` e envio em segundo plano com preview otimista instantâneo.

5. **Alternância entre Operador Humano e IA (Handover):**
   - Botão de alternância no cabeçalho da conversa:
     - `[Assumir Conversa]` pausa a IA nesta conversa específica (`contacts.ai_paused = true`).
     - `[Retomar IA]` devolve a conversa ao agente autónomo (`contacts.ai_paused = false`).
   - `handleAgentMessage` respeita rigorosamente a flag `ai_paused` e não interfere nas conversas em atendimento humano.
