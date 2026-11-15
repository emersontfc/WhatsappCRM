# Guia de Agendamento de Mensagens — Kazix AgentX

## 1. Visão Geral

O módulo de agendamento de mensagens permite que tanto os administradores humanos (via interface `/schedule`) quanto os agentes inteligentes (via instruções de linguagem natural no chat) programem o envio futuro de mensagens, avisos e faturas em PDF diretamente para os contactos no WhatsApp.

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

- **Tarefas Órfãs:** Se o servidor for reiniciado enquanto uma mensagem estiver com status `processing`, o scheduler identifica automaticamente tarefas órfãs com mais de 15 minutos e reverte-as para `pending` para reprocessamento seguro.
- **Novas Tentativas:** Em caso de falha de conexão temporária, o scheduler aplica até 3 tentativas com intervalo progressivo de 5 minutos antes de marcar definitivamente como `failed`.
