# 📚 Manual Completo de Uso — Plataforma WhatsCRM SaaS

Bem-vindo ao **WhatsCRM**, a plataforma completa de CRM, Atendimento, Inteligência Artificial, Automação e Agendamento de Consultas integrada diretamente ao WhatsApp.

Este guia prático foi criado para orientar administradores, equipes de vendas, secretárias e atendentes sobre como utilizar cada funcionalidade do sistema com máxima eficiência.

---

## 📑 Índice de Navegação
1. [Primeiros Passos & Conexão do WhatsApp](#1-primeiros-passos--conexão-do-whatsapp)
2. [Central de Mensagens & Inbox Comercial (`/messages`)](#2-central-de-mensagens--inbox-comercial-messages)
3. [Módulo de Envio de Áudios e Gravação de Voz](#3-módulo-de-envio-de-áudios-e-gravação-de-voz)
4. [Funil de Vendas & Gestão de Leads (`/leads`)](#4-funil-de-vendas--gestão-de-leads-leads)
5. [Agenda, Consultas & Auto-Agendamento Online (`/appointments`)](#5-agenda-consultas--auto-agendamento-online-appointments)
6. [Automações & Menus Inteligentes (`/automations` e `/menu-builder`)](#6-automações--menus-inteligentes-automations-e-menu-builder)
7. [Agente de Inteligência Artificial (`/agent`)](#7-agente-de-inteligência-artificial-agent)
8. [Gestão de Grupos & Disparos Programados (`/groups` e `/schedule`)](#8-gestão-de-grupos--disparos-programados-groups-e-schedule)
9. [Histórico de Atividades & Auditoria (`/activity`)](#9-histórico-de-atividades--auditoria-activity)
10. [Planos & Configurações da Conta (`/settings` e `/activate`)](#10-planos--configurações-da-conta-settings-e-activate)

---

## 1. Primeiros Passos & Conexão do WhatsApp

### Como conectar o seu número de WhatsApp:
1. No menu lateral, acesse **Configurações** (`/settings`).
2. Na seção **Conexão WhatsApp**, clique em **Gerar QR Code**.
3. Abra o WhatsApp no seu telemóvel:
   - **Android:** Toque nos 3 pontinhos no canto superior direito ➔ *Aparelhos conectados* ➔ *Conectar um aparelho*.
   - **iPhone (iOS):** Toque em *Definições / Ajustes* ➔ *Aparelhos conectados* ➔ *Conectar aparelho*.
4. Aponte a câmera do celular para o QR Code na tela do computador.
5. Assim que a tela exibir **"Conectado com sucesso ✅"**, seu número estará sincronizado com o WhatsCRM.

> [!TIP]
> **Reconexão Automática:** O sistema possui reconexão em background. Caso seu telemóvel fique sem internet momentaneamente, o sistema restabelece a conexão assim que a rede voltar sem que precise escanear o QR Code de novo.

---

## 2. Central de Mensagens & Inbox Comercial (`/messages`)

O Inbox é onde toda a comunicação 1-a-1 acontece em tempo real.

```
┌─────────────────────────┬───────────────────────────────────────┬─────────────────────────┐
│     Lista de Conversas  │          Janela de Chat Aberta        │       Painel CRM        │
│                         │                                       │                         │
│ • Busca por Nome/Telefone│ • Mensagens (Texto, Áudio, Mídia)     │ • Nome Editável         │
│ • Filtros (Não Lidas)   │ • Pré-escuta de Áudio WhatsApp        │ • Etiquetas (Tags)      │
│ • Status da IA (Ativa)  │ • Respostas Rápidas (/atalho)         │ • Estágio do Lead       │
│ • Prévia da Última Msg  │ • Botão de Pausa da IA (Humano)       │ • Notas Internas        │
└─────────────────────────┴───────────────────────────────────────┴─────────────────────────┘
```

### Principais recursos do Inbox:
* **Assumir Atendimento Humano (Pausa da IA):**
  - No topo da conversa, clique no botão **"IA Ativa"** para alternar para **"Atendimento Humano"**.
  - Quando o modo humano está ativado, o robô de IA não responde nessa conversa, permitindo que você converse livremente sem interferência da máquina.
* **Painel CRM Lateral:**
  - Clique no ícone de gráfico/tendência no topo do chat para abrir o painel direito.
  - **Editar Nome:** Altere o nome do contato.
  - **Etiquetas:** Adicione tags como `Cliente VIP`, `Proposta Enviada`, `Urgente`.
  - **Funil Comercial:** Mude o estágio do lead diretamente na conversa.
  - **Notas Rápidas:** Anote dados confidenciais ou detalhes da negociação.
* **Respostas Rápidas:**
  - Clique no ícone de lista na barra de envio para selecionar modelos de respostas pré-configurados com 1 clique.

---

## 3. Módulo de Envio de Áudios e Gravação de Voz

O WhatsCRM conta com um sistema de áudio que converte gravações do navegador para o formato nativo de notas de voz do WhatsApp (**OGG Opus 16kHz mono PTT**):

### Como gravar e enviar áudio:
1. Na barra inferior da conversa, clique no ícone de **Microfone** (🎙️).
2. Fale normalmente enquanto o cronômetro registra a duração do áudio.
3. Clique em **Parar Gravação** (⏹️).
4. **Pré-escuta:** Clique no botão **Play** (▶️) para ouvir o áudio que gravou antes de enviar.
5. Se gostar, clique em **Enviar** (🚀). Se quiser regravar, clique no ícone de **Lixeira** (🗑️) e grave novamente.

---

## 4. Funil de Vendas & Gestão de Leads (`/leads`)

O módulo de Leads organiza todos os potenciais clientes em um quadro visual no formato **Kanban**:

### Estágios do Funil:
1. **Novo Lead:** Contatos recém-chegados que ainda não foram abordados.
2. **Em Qualificação:** Em conversa inicial para entender o interesse.
3. **Proposta Enviada:** Proposta de preço ou orçamento entregue.
4. **Em Negociação:** Ajustes finais de proposta ou contrato.
5. **Venda Fechada (Ganho):** Negócio concluído e cliente ativado.
6. **Perdido:** Contato que declinou ou não deu seguimento.

### Como usar o Kanban:
* **Arrastar e Soltar (Drag & Drop):** Mova os cards de um estágio para o outro conforme a negociação avança.
* **Definir Valor do Negócio:** Clique no card para definir o valor financeiro em Meticais (MT) ou moeda local.
* **Abrir Conversa Direta:** Clique no ícone de mensagem do card para ir direto para o chat daquele lead.

---

## 5. Agenda, Consultas & Auto-Agendamento Online (`/appointments`)

Desenvolvido para **clínicas médicas, odontologia, salões de beleza, escritórios de advocacia, consultorias e prestadores de serviços**.

```
                           FLUXO DE AGENDAMENTO INTELIGENTE
                           
   [ Paciente / Cliente ] ──────▶ Abre link: seusite.com/book/SEU_ID
             │
             ├─ 1. Escolhe Procedimento (ex: Consulta Geral - 1.500 MT)
             ├─ 2. Escolhe Médico/Especialista (ex: Dr. Carlos)
             ├─ 3. Escolhe Dia & Horário Livre (Sem conflitos de agenda)
             └─ 4. Digita Nome e WhatsApp
             │
             ▼
   [ WhatsCRM Recebe Agendamento ]
             │
             ├─ Aparece no Calendário da Clínica imediatamente
             ├─ Envia Confirmação Instantânea no WhatsApp do Paciente
             ├─ Dispara Lembrete 24h antes (com opção de Confirmar/Reagendar)
             └─ Dispara Lembrete 2h antes no dia da consulta
```

### As 4 Abas do Módulo:
1. **Agenda & Horários:**
   - Calendário visual com visualização por dia, semana e mês.
   - Filtros por médico/profissional e status (*Agendado*, *Confirmado*, *Concluído*, *Cancelado*).
   - Botão verde de **WhatsApp** na linha da consulta para chamar o paciente com 1 clique.
2. **Serviços & Preços:**
   - Cadastre seus tipos de atendimento com nome, duração em minutos (ex: 30 min, 60 min) e preço em MT.
3. **Profissionais:**
   - Cadastre os membros da equipe com especialidade, dias de trabalho (ex: Seg a Sex), horário de expediente e intervalo de almoço.
4. **Link de Auto-Agendamento:**
   - Copie o seu link público ou faça download do **QR Code** para colocar na recepção ou nas redes sociais.

---

## 6. Automações & Menus Inteligentes (`/automations` e `/menu-builder`)

Permite que o WhatsApp responda automaticamente 24 horas por dia, 7 dias por semana:

### Automações por Palavras-Chave:
1. Vá em **Automações** (`/automations`) e clique em **Nova Automação**.
2. Defina os termos de disparo (ex: `preço, tabela, planos, catalogo`).
3. Escolha o tipo de resposta: **Texto**, **Áudio gravado** ou **Arquivo/PDF**.
4. Configure um delay (ex: 2 segundos) para simular digitação natural.

### Menus Numéricos Inteligentes:
1. Acesse **Menu Inteligente** (`/menu-builder`).
2. Crie um fluxo interativo com mensagem de boas-vindas:
   - *1. Nossos Serviços*
   - *2. Marcar Consulta*
   - *3. Falar com Atendente Humano*
3. O cliente digita apenas o número e o sistema entrega o conteúdo correspondente automaticamente.

---

## 7. Agente de Inteligência Artificial (`/agent`)

O WhatsCRM inclui um agente de IA alimentado pelo **Google Gemini**:

### Como configurar o Agente:
1. Acesse **Agente IA** (`/agent`).
2. Ative a chave **"Status do Agente"**.
3. No campo **Instruções do Sistema (Prompt)**, defina a personalidade da sua empresa:
   - Nome da empresa e tom de voz (amigável, formal).
   - Lista de produtos, serviços e políticas de entrega/pagamento.
   - Regras do que a IA pode e não pode responder.
4. Clique em **Guardar Configurações**.
5. A partir desse momento, novos clientes que mandarem mensagem no WhatsApp serão atendidos de forma autônoma pela IA.

---

## 8. Gestão de Grupos & Disparos Programados (`/groups` e `/schedule`)

### 1. Moderação de Grupos de WhatsApp (`/groups`):
- **Anti-Link:** Remove automaticamente mensagens com links indesejados.
- **Anti-Spam / Anti-Flood:** Bloqueia disparos repetitivos de membros.
- **Boas-Vindas Automática:** Envia mensagem personalizada para cada membro novo que entra no grupo.

### 2. Disparos Programados & Status (`/schedule`):
- **Mensagens Futuras:** Agende uma mensagem para ser enviada a um contato específico em uma data e hora exata.
- **Postagem Automática de Status:** Programe fotos, vídeos ou avisos para serem postados automaticamente nos **Status (Stories)** do seu WhatsApp comercial.

---

## 9. Histórico de Atividades & Auditoria (`/activity`)

Acompanhe todas as ações executadas na plataforma:
* Mensagens enviadas e recebidas.
* Disparos de automações e menus.
* Consultas agendadas e confirmadas.
* Log de erros e reconexões do WhatsApp para suporte técnico.

---

## 10. Planos & Configurações da Conta (`/settings` e `/activate`)

* **Troca de Senha & Perfil:** Atualize seu nome, e-mail e dados de acesso.
* **Limite de Mensagens:** Acompanhe o contador diário e mensal de mensagens consumidas.
* **Upgrade de Plano:** Acesse a tela de ativação para desbloquear recursos avançados (IA ilimitada, agendamento de consultas e múltiplos atendentes).

---

## 💡 Dicas de Boas Práticas & Suporte

1. **Evite Bloqueios no WhatsApp:** Nunca faça disparos em massa para números que nunca conversaram com você. Utilize o sistema com moderação e intervalos saudáveis.
2. **Mantenha o Celular Conectado:** Deixe o aparelho com bateria e conectado à internet para garantir envio contínuo.
3. **Suporte & Dúvidas:** Caso precise de assistência técnica ou novas personalizações, entre em contato com o suporte oficial do WhatsCRM.
