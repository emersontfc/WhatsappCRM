# AgentX 2.0

O **AgentX** é o CRM da Kazix para vender, atender clientes e organizar marcações pelo WhatsApp. Reúne conversas, catálogo, equipa e tarefas num painel para lojas, clínicas, salões e comunidades.

[Abrir o AgentX](https://agentx.kazix.site) · [Ler a documentação](https://agentx.kazix.site/docs) · [Preparar o primeiro teste](https://agentx.kazix.site/docs#first-test)

## O que podes fazer

- **Atender clientes.** Liga o teu número, responde com texto, áudio ou ficheiros, organiza contactos e leads e assume o atendimento quando for preciso. [Conversas e atendimento](https://agentx.kazix.site/docs#messages-inbox)
- **Vender a partir do catálogo.** O agente consulta preços e disponibilidade, apresenta propostas e reserva as unidades antes de enviar os dados de pagamento. Depois da aprovação, o AgentX pode entregar o ficheiro digital pelo WhatsApp. [Catálogo, pedidos e entregas](https://agentx.kazix.site/docs#seller-catalog)
- **Trabalhar em equipa e rever pagamentos.** O titular atribui acessos a vendedores e responsáveis financeiros. A fila comum reúne comprovativos, avisos e entregas por concluir. Fotos e PDFs recebidos em privado pelo WhatsApp podem ser associados ao pedido. A aprovação é feita no painel depois de confirmar o recebimento no M-Pesa, e-Mola ou banco. [Equipa e tarefas](https://agentx.kazix.site/docs#seller-team) · [Comprovativos](https://agentx.kazix.site/docs#seller-payments)
- **Gerir grupos e agendar envios.** Configura boas-vindas e regras de moderação, publica promoções em grupos autorizados e agenda mensagens ou Status. Os agendamentos ficam guardados no servidor. [Gestão de grupos](https://agentx.kazix.site/docs#groups-schedule) · [Mensagens e Status](https://agentx.kazix.site/docs#schedule-messages)
- **Organizar marcações.** Configura serviços, profissionais e horários. Partilha o link público e acompanha os lembretes. O cliente pode remarcar ou cancelar pelo seu link privado. [Marcações e lembretes](https://agentx.kazix.site/docs#appointments-system)

## Começar pelo painel

1. Cria uma conta ou inicia sessão. Em **Início**, liga o WhatsApp e envia uma mensagem de teste a partir de outro número.
2. Abre **Primeiro teste** e escolhe **Loja**, **Clínica ou salão** ou **Gestão de grupos**.
3. Segue os passos até veres o primeiro pedido, a primeira marcação ou a primeira ocorrência de moderação no painel.

## Desenvolvimento

O painel usa React, TypeScript e Vite. A API e os processos de envio correm em Node.js e Express. O Supabase fornece PostgreSQL, autenticação e armazenamento privado. A ligação ao WhatsApp usa Baileys.

Usa Node.js 22, npm e um projeto Supabase de desenvolvimento. Instala FFmpeg para preparar e enviar notas de voz. A branch `fix/agentx-foundation-recovery` contém a versão descrita neste README.

```bash
git clone --branch fix/agentx-foundation-recovery https://github.com/emersontfc/WhatsappCRM.git
cd WhatsappCRM
npm ci --ignore-scripts
cp .env.example .env
```

Prepara a base de desenvolvimento seguindo o guia de instalação. Preenche `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com o endereço e a chave pública do projeto. Guarda `SUPABASE_SERVICE_ROLE_KEY` exclusivamente no ambiente do servidor. [Instalar num projeto Supabase vazio](https://github.com/emersontfc/WhatsappCRM/blob/fix/agentx-foundation-recovery/DEPLOY_VPS.md#instalar-num-projeto-supabase-vazio)

Corre `npm run dev` e abre `http://localhost:3000`. Configura o fornecedor em **Agente IA** quando quiseres testar o atendimento com IA.

### Verificar alterações

```bash
npm run lint
npm test
npm run build
```

O teste de integração do esquema usa PostgreSQL num contentor Docker.

```bash
bash tests/integration/run-agentx-fresh-schema.sh
```

### Publicação

O guia da VPS descreve a instalação em Docker, a ordem das migrações e a verificação da nova versão antes da troca do contentor. [Guia da VPS](https://github.com/emersontfc/WhatsappCRM/blob/fix/agentx-foundation-recovery/DEPLOY_VPS.md)
