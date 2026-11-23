# Guia de Agendamento de Mensagens — Kazix AgentX

## 1. Visão Geral

Em **Agenda**, escolha **Contacto**, **Grupo** ou **Status**, componha a mensagem, indique a data e grave. As publicações para **Grupo** aparecem na conversa do grupo e aceitam texto, imagens, vídeo ou documentos. O servidor guarda o agendamento e tenta o envio na hora escolhida, mesmo com o painel fechado. A ligação WhatsApp tem de estar ativa no servidor.

Em **Marcações**, configure serviços e horários, crie uma marcação ou partilhe o link público. O separador **Lembretes** mostra a confirmação e os lembretes por WhatsApp, com opções automáticas de 24 h e 2 h quando ativadas. O painel usa o fuso horário configurado na empresa.

Em **Grupos**, a conta ligada precisa de permissão de administrador para abrir ou fechar a conversa aos membros, gerir participantes e ativar **Comprovativos no grupo**. Para publicidade imediata, **Promoção** envia texto ou detalhes de um produto do catálogo para a conversa selecionada.

Para submeter um comprovativo, o cliente inclui o número `AGX-…` no texto do recibo ou na legenda de uma imagem ou PDF de até 5 MiB. O AgentX verifica o número do participante e associa a prova ao pedido dele. Em **Pedidos → Comprovativos**, a equipa pode descarregar o anexo privado e registar a aprovação ou rejeição depois de conferir o pagamento no prestador. Os dados escritos no texto ou na legenda ajudam a revisão. A equipa lê o conteúdo das imagens e dos PDF no anexo descarregado.

---

## 2. Motor de Linguagem Natural e Datas (`dateTimeParser.ts`)

O agente compreende instruções relativas e absolutas em Português sem exigir formatos técnicos do utilizador:

| Expressão em Português | Resolução Técnica | Fuso Horário Padrão |
| :--- | :--- | :--- |
| `"amanhã às 9 horas"` | Dia seguinte às 09:00 locais | `Africa/Maputo` (UTC+2) |
| `"sexta-feira às 15 horas"` | Próxima sexta-feira às 15:00 locais | `Africa/Maputo` (UTC+2) |
| `"hoje às 18 horas"` | Hoje às 18:00 (ou amanhã se já passou) | `Africa/Maputo` (UTC+2) |
| `"daqui a 2 horas"` | Horário atual + 120 minutos | Relativo à hora atual |
| `"em 30 minutos"` | Horário atual + 30 minutos | Relativo à hora atual |
| `"2026-11-20 10:00"` | 20 de Novembro de 2026 às 10:00 locais | `Africa/Maputo` (UTC+2) |

---

## 3. Ciclo de Vida do Agendamento

```
[Administrador: "Agenda mensagem para o João amanhã às 9h"]
                     │
                     ▼
        [Agente: schedule_message]
                     │
                     ▼
   [Resolução do Contacto & Validação de Fuso]
                     │
                     ▼
  [Persistência no Supabase: scheduled_messages]
           • status: 'pending'
           • scheduled_at: ISO UTC calculado
                     │
                     ▼
   [Confirmação ao Utilizador com Dados Reais]
                     │
                     ▼
          [Scheduler Background Worker]
           • Verifica a cada 60 segundos
           • lte('scheduled_at', now)
           • Altera atomicamente para 'processing'
           • Dispara via WhatsApp Baileys
           • Altera para 'sent' (ou 'failed' com retry)
```

---

## 4. Ferramentas Disponíveis no Agente

1. **`schedule_message`**:
   - Parâmetros: `recipient`, `message`, `scheduledAt`, `mediaUrl` (opcional), `mediaFilename` (opcional).
2. **`list_scheduled_messages`**:
   - Parâmetros: `status` ('pending', 'sent', 'failed', 'all'), `limit`.
3. **`cancel_scheduled_message`**:
   - Parâmetros: `scheduleId` ou `recipient`.

---

## 5. Resiliência e Recuperação de Falhas

- O servidor bloqueia o agendamento enquanto tenta enviar. Uma falha confirmada antes do envio permite nova tentativa. Se o envio ficar sem confirmação, a Agenda indica que é necessário consultar o WhatsApp antes de repetir.

