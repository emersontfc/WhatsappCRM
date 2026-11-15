# Guia de Publicação no Status do WhatsApp — Kazix AgentX

## 1. Visão Geral

O módulo de Status / Stories do WhatsApp permite publicar comunicados, novidades, ofertas e avisos institucionais diretamente no status da conta conectada via Baileys, alcançando os contactos salvos na agenda da empresa.

---

## 2. Tipos de Publicação Suportados

1. **Status em Texto Puro:**
   - Mensagem formatada com cor de fundo institucional (`#075E54` - verde WhatsApp) e fonte nítida.
   - **Correção Efetuada:** A rota `/api/whatsapp/status` anteriormente exigia mídia obrigatória (`!mediaUrl || !mediaType`), bloqueando qualquer publicação em texto. O backend agora aceita texto puro de forma nativa e fiável.
2. **Status com Imagem:**
   - Imagem JPG/PNG com legenda descritiva.
3. **Status com Vídeo:**
   - Vídeos em formato MP4/WebM com legenda.

---

## 3. Ferramentas Integradas do Agente

| Ferramenta | Comando Típico do Utilizador | Ação Executada |
| :--- | :--- | :--- |
| **`post_whatsapp_status`** | *"Publica este texto no meu status agora."* | Valida a sessão e envia imediatamente para `status@broadcast`. |
| **`schedule_status`** | *"Agenda este status para amanhã às 8 horas."* | Calcula o horário em `Africa/Maputo` e grava em `scheduled_status`. |
| **`list_scheduled_status`** | *"Mostra os status que tenho agendados."* | Retorna a lista de postagens futuras pendentes. |
| **`cancel_scheduled_status`**| *"Cancela o status agendado."* | Altera o status para `cancelled`, impedindo a publicação. |

---

## 4. Tratamento do Destino `status@broadcast`

No protocolo Baileys / WhatsApp:
- O destino para envio de Stories é o JID canónico `status@broadcast`.
- É obrigatório incluir `statusJidList` nas opções do envio para definir os destinatários que têm permissão de visualizar o status.
- O sistema obtém a lista de telefones da tabela `contacts` da organização e adiciona o próprio número do utilizador (`myJid`).
- Caso a base de contactos esteja no início (0 contactos), o sistema inclui o número do próprio utilizador como fallback, garantindo que o Baileys não lance erro de lista vazia.

---

## 5. Segurança e Governança

- **Apenas Administradores:** Apenas utilizadores com papel `admin` ou gerentes autorizados podem solicitar publicações de status.
- **Validação de Sessão Conectada:** Se o WhatsApp estiver desconectado, a ferramenta rejeita a operação com código estruturado `SESSION_NOT_CONNECTED`, informando claramente ao operador para ler o QR Code antes de publicar.
