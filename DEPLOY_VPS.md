# 🚀 Guia Oficial de Migração e Deploy em VPS — AgentX / WhatsCRM SaaS

Este guia prático ensina o passo a passo completo para migrar e colocar a sua plataforma **AgentX / WhatsCRM SaaS** em produção num servidor **VPS Linux** (Ubuntu 22.04 ou 24.04 LTS), garantindo alta disponibilidade, conexões persistentes do WhatsApp, SSL gratuito e desempenho otimizado.

---

## 🖥️ 1. Requisitos Recomendados da VPS

Para rodar o backend Node.js, Baileys (sessões WhatsApp), conversor de áudio FFmpeg e o agendador contínuo com folga:

| Recurso | Mínimo | Recomendado (10-50 clientes conectados) |
| :--- | :--- | :--- |
| **vCPU** | 1 Core | 2 Cores ou mais |
| **Memória RAM** | 2 GB | 4 GB |
| **Armazenamento** | 20 GB SSD | 40 GB+ NVMe SSD |
| **Sistema Operacional** | Ubuntu 22.04 / 24.04 LTS | Ubuntu 24.04 LTS |
| **Provedores Sugeridos** | Hetzner, Contabo, DigitalOcean, Linode, AWS EC2, OVH |

---

## 🛠️ 2. Preparação Inicial do Servidor

Acesse sua VPS via terminal SSH pelo seu computador:
```bash
ssh root@SEU_IP_DO_VPS
```

Clone o repositório na pasta `/var/www/agentx` ou na sua home:
```bash
mkdir -p /var/www/agentx
cd /var/www/agentx
git clone https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git .
```

Execute o script de automação de ambiente incluído no projeto:
```bash
chmod +x scripts/setup-vps.sh
./scripts/setup-vps.sh
```
*O script instalará automaticamente as dependências de sistema, FFmpeg, UFW Firewall e o Docker ou Node 22/PM2 conforme sua escolha.*

---

## ⚙️ 3. Configuração das Variáveis de Ambiente (`.env`)

Copie o modelo de produção para o arquivo `.env`:
```bash
cp .env.production.example .env
nano .env
```

Preencha as variáveis essenciais:
```ini
PORT=3000
NODE_ENV=production

# Supabase
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_sua_chave_publica
SUPABASE_SERVICE_ROLE_KEY=sb_secret_sua_chave_privada

# Inteligência Artificial
GEMINI_API_KEY=sua_chave_gemini_aqui
ENCRYPTION_KEY=coloque_aqui_uma_chave_com_exatos_32_caracteres!

# URLs do Sistema
VITE_API_URL=https://seudominio.com
```

Pressione `Ctrl + O` e `Enter` para salvar, e `Ctrl + X` para sair do editor.

---

## 🐳 4. Método 1: Deploy com Docker & Docker Compose *(Recomendado)*

O Docker isola a aplicação com todas as bibliotecas de áudio FFmpeg e dependências compiladas sem conflitos de sistema.

### Instalar num projeto Supabase vazio

Com a ligação PostgreSQL do novo projeto definida em `PGDATABASE`, execute `psql -X -f migrations/install_agentx_fresh.sql` a partir do repositório. Para usar o SQL Editor, gere o SQL com `node scripts/render-agentx-fresh-sql.mjs > AgentX-instalacao-limpa.sql`. Esse ficheiro instala o esquema numa única transação. As duas opções verificam se o projeto já tem tabelas, contas ou buckets do utilizador antes de instalar.

Para ligar uma instalação Docker em execução à base preparada, use `bash scripts/release-agentx-vps.sh <commit> <url-supabase> <chave-publicavel>`. O script pede a chave `sb_secret_` no terminal, verifica o novo projeto num contentor temporário e guarda a configuração anterior com permissões `600`. Se o contentor publicado falhar, a reversão repõe a imagem e a configuração anteriores.

Crie a conta inicial no painel. Depois de verificar que o endereço pertence ao administrador pretendido, atribua `admin` ou `superadmin` ao perfil correspondente por uma operação administrativa na base. O cadastro cria contas comuns e a aplicação respeita o papel guardado no perfil.

### 1. Iniciar o container em segundo plano:
```bash
sudo docker compose up -d --build
```

### Ativar Pedidos digitais no AgentX existente

Em staging, execute `psql -X -f migrations/apply_agentx_v2.sql` com a ligação PostgreSQL Supabase configurada em `PGDATABASE`. Faça backup antes de repetir o processo em produção. A atualização cria as tabelas v2 e mantém os pedidos, produtos, verificações e configurações existentes nas respetivas tabelas. O menu **Vendas & Pedidos** dá acesso a **Pedidos digitais**.

O servidor processa as entregas aprovadas automaticamente com as credenciais Supabase do backend. Para operar com um processo separado, define `DISABLE_DIGITAL_DELIVERY_WORKER=true` no servidor e inicia o perfil `commerce-v2`:

```bash
sudo docker compose --profile commerce-v2 up -d --build
sudo docker compose --profile commerce-v2 logs --tail=50 digital-worker
```

Em instalações PM2 com processamento separado, execute `npm run worker:digital` como processo supervisionado no mesmo ambiente Supabase. Valide primeiro o fluxo com contas de teste de comprador e financeiro. [Guia de Pedidos digitais](docs/AGENTX_V2_MILESTONE_1.md)

### 2. Verificar status e logs em tempo real:
```bash
sudo docker compose ps
sudo docker compose logs -f
```

### 3. Atualizar o sistema após novos commits:
```bash
git pull
sudo docker compose up -d --build
```

---

## 🟢 5. Método 2: Deploy Nativo com Node.js 22 & PM2

Se preferir rodar sem containers diretamente no Ubuntu:

### 1. Instalar dependências e compilar o frontend:
```bash
npm install
npm run build
```

### 2. Iniciar e salvar o processo com PM2:
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```
*(Copie e rode o comando sugerido pelo `pm2 startup` para que a aplicação ligue automaticamente se a VPS reiniciar).*

### 3. Gerenciamento diário:
- Ver logs: `pm2 logs agentx-crm`
- Reiniciar: `pm2 restart agentx-crm`
- Status: `pm2 status`

---

## 🌐 6. Configuração de Domínio e Nginx Reverso com SSL Grátis

Para permitir que o frontend e as rotas de WhatsApp funcionem sob `https://seudominio.com`:

### 1. Aponte seu domínio no seu registrador DNS:
- Crie um registro tipo **A**:
  - **Nome:** `@` (ou subdomínio como `app`)
  - **Valor:** `IP_DA_SUA_VPS`

### 2. Instalar Nginx e Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 3. Configurar o Nginx:
Copie o template fornecido para o Nginx:
```bash
sudo cp nginx/agentx.conf /etc/nginx/sites-available/agentx
```

Edite o arquivo e substitua `seudominio.com` pelo seu domínio real:
```bash
sudo nano /etc/nginx/sites-available/agentx
```

Ative o site e teste a sintaxe:
```bash
sudo ln -sf /etc/nginx/sites-available/agentx /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Gerar o Certificado SSL HTTPS Grátis:
```bash
sudo certbot --nginx -d seudominio.com -d www.seudominio.com
```
*O Certbot configurará a renovação automática para você.*

---

## 🛡️ 7. Dicas de Resiliência para Manter o WhatsApp 24/7 Conectado

1. **Volume Persistente `whatsapp_sessions_data`:**
   - As credenciais de autenticação ficam salvas tanto no disco local quanto na tabela `whatsapp_sessions` do Supabase.
   - Nunca apague a pasta `whatsapp_sessions_data` para evitar ter que escanear o QR Code novamente.
2. **Desligamento Suave (Graceful Shutdown):**
   - O sistema já vem equipado com ouvintes `SIGTERM` e `SIGINT` que fecham as conexões de WebSocket antes de reiniciar, evitando o erro de sessão conflituosa (*440 Connection Replaced*).
3. **Evite Bloqueios de Spam:**
   - Ao criar automações ou mensagens programadas no `/schedule`, utilize intervalos de 5 a 15 segundos entre envios.

---

## 📋 8. Comandos Úteis de Manutenção

O comando `scripts/release-agentx-vps.sh` valida a configuração pública e o esquema de CRM, vendas, Agenda, Marcações e Grupos num contentor temporário antes da troca. No `.env`, use a chave publishable ou anon em `VITE_SUPABASE_ANON_KEY` e reserve a chave secret ou service_role para `SUPABASE_SERVICE_ROLE_KEY`.

Antes de atualizar uma instalação existente, confirme quais das migrações estão aplicadas no projeto Supabase usado pela VPS. Execute apenas as que faltam, pela ordem abaixo. A migração 24 define a revisão das marcações antigas sem reescrever a tabela. A criação dos índices ainda lê as tabelas existentes. Aplique cada migração separadamente, num período de pouco tráfego.

1. `supabase/migrations/23_agenda_dispatch.sql`
2. `supabase/migrations/24_appointment_booking_delivery.sql`
3. `supabase/migrations/25_group_payment_proofs.sql`
4. `supabase/migrations/26_seller_delivery_recovery.sql`

Esta consulta curta verifica se as migrações chegaram ao fim. Também pode ser usada quando o SQL Editor perde a ligação durante a execução.

```sql
SELECT
  to_regprocedure('public.agentx_schedule_dispatch_ready()') IS NOT NULL AS m23,
  to_regprocedure('public.agentx_appointment_contract_ready()') IS NOT NULL AS m24,
  to_regprocedure('public.agentx_group_proof_contract_ready()') IS NOT NULL AS m25,
  to_regprocedure('public.agentx_seller_delivery_recovery_ready()') IS NOT NULL AS m26;
```

Depois de aplicar as migrações, publique o commit da versão com `scripts/release-agentx-vps.sh`. Confirme em **Estado da operação** os três módulos, a ligação WhatsApp e o processamento de agendamentos. O processamento no servidor exige `DISABLE_SCHEDULER=false`.

### Atualizar os fluxos de WhatsApp, Grupos e Campanhas

Numa base que já recebeu a migração 26, aplique `psql -X -f migrations/apply_agentx_whatsapp_workflows.sql` usando a ligação de migração. Para o SQL Editor do Supabase, gere o ficheiro com `node scripts/render-agentx-fresh-sql.mjs --whatsapp-upgrade > AgentX-migracoes-27-a-36.sql` e execute o conteúdo inteiro. Esta variante aplica as dez migrações numa única transação. Depois, publique o commit e confirme `/api/ready`.

Se a base já tiver a migração 31, pode executar apenas `supabase/migrations/32_human_handoff_alerts.sql`. Confirme que `SELECT public.agentx_human_handoff_ready();` devolve `true` antes de publicar. Com o WhatsApp ligado, teste a partir de um número de cliente e confirme que o aviso chega ao número principal em **Configurações** quando o cliente pede atendimento humano.

### Ativar a gestão de marcações e a moderação por conteúdo

Numa instalação com a migração 32, aplique `supabase/migrations/33_appointment_self_service.sql` e `supabase/migrations/34_group_content_moderation.sql` pela ordem indicada. Confirme `SELECT public.agentx_appointment_self_service_ready(), public.agentx_group_moderation_ready();` antes de publicar. Ambas as verificações devem devolver `true`.

### Reservas de stock e propostas

Se a base já recebeu a migração 34, aplique `supabase/migrations/35_seller_stock_reservations.sql` e `supabase/migrations/36_seller_conversation_quotes.sql` por esta ordem. Antes de publicar, confirme que `SELECT public.agentx_seller_reservations_ready(), public.agentx_seller_quotes_ready();` devolve `true` em ambas as colunas.

Depois de publicar a versão que comunica o prazo ao cliente, o cliente pode confirmar a proposta durante 10 minutos e o pedido confirmado reserva stock durante 30 minutos. Se o comprovativo entrar em revisão antes do prazo, o stock fica reservado até à decisão da equipa. O stock volta a ficar disponível assim que uma reserva sem comprovativo vencer, mesmo entre execuções do agendador.

Se for preciso voltar a uma imagem anterior à implementação das reservas, pause temporariamente os agentes de vendas. Reative-os quando a versão que verifica os prazos das reservas estiver em execução.

### Equipa, comprovativos privados e avisos

Com o esquema de empresas AgentX v2 e as migrações até à 36 instalados, aplique `migrations/apply_agentx_team_operations.sql` com `psql -X -f`. Para o SQL Editor do Supabase, gere um script único com `node scripts/render-agentx-fresh-sql.mjs --team-upgrade > AgentX-migracoes-37-a-39.sql` e execute-o antes da publicação. A verificação da versão confirma as três migrações.

Em **Equipa e tarefas**, o titular associa a loja à empresa e atribui **Vendedor** ou **Responsável financeiro** a cada conta com email confirmado. A equipa usa a mesma fila de pedidos. Para rever um comprovativo, o responsável financeiro confirma primeiro a entrada no prestador. O registo identifica a conta que tomou a decisão.

No WhatsApp privado, envie um JPEG, PNG ou PDF com o código AGX indicado pelo pedido para testar a associação. Em **Equipa e tarefas**, verifique a revisão pendente e a abertura do ficheiro com uma conta financeira. Para avisos confirmados como não enviados, a fila indica quando é possível voltar a tentar. Se o WhatsApp não confirmar o envio, confira a conversa antes de reenviar.

Em **Primeiro teste**, escolha o percurso da loja, das marcações ou dos grupos. Execute o primeiro teste nos ecrãs indicados. O progresso da lista é guardado no navegador com a conta atual.

As novas reservas públicas oferecem **Gerir marcação**. Para enviar o link também por WhatsApp, configure `PUBLIC_APP_URL` com a origem HTTPS pública do painel. O servidor também aceita `VITE_API_URL` quando contém uma origem pública válida. Se usar `APPOINTMENT_MANAGEMENT_SECRET`, guarde um valor forte e estável para o servidor poder voltar a incluir links já emitidos nos lembretes após rodar as credenciais da base.

Em **Grupos**, escolha o grupo em que a conta ligada é administradora. As ações de moderação ficam separadas por regra e por tipo de conteúdo. As ocorrências encaminhadas aparecem na fila de revisão. Ative **Vendas no grupo** para permitir `/loja` ou `/loja <produto>` e use **Agendar promoção** para criar uma campanha do catálogo para aquele grupo.

Teste num grupo de piloto com a conta ligada como administradora. Confirme o horário de escrita, uma publicação do catálogo, a origem do lead depois de o cliente escrever em privado e um envio citado pela Agenda. O script de publicação valida as migrações e mantém uma imagem para reversão. As migrações acrescentam estruturas e deixam os registos disponíveis para uma nova publicação após uma reversão da imagem.

| Ação | Comando Docker | Comando PM2 |
| :--- | :--- | :--- |
| **Ver logs ao vivo** | `docker compose logs -f agentx` | `pm2 logs agentx-crm` |
| **Reiniciar sistema** | `docker compose restart agentx` | `pm2 restart agentx-crm` |
| **Ver uso de memória/CPU** | `docker stats agentx-crm` | `pm2 monit` |
| **Verificar se o processo responde** | `curl -f http://localhost:3000/api/health` | `curl -f http://localhost:3000/api/health` |
| **Verificar a versão e o acesso ao Supabase** | `curl -f http://localhost:3000/api/ready` | `curl -f http://localhost:3000/api/ready` |

---

`/api/ready` verifica a compilação, a configuração pública e as tabelas essenciais do CRM. No painel autenticado, **Estado da operação** mostra também a ligação WhatsApp, as migrações necessárias e o estado do processamento de entregas. A validação de cada módulo em produção usa as contas e números de teste da empresa.

