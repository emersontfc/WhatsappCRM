# GUIA DE DEPLOY E OPERAÇÃO EM PRODUÇÃO — KAZIX AGENTX

**Domínio:** `agentx.kazix.site`  
**Servidor Alvo:** VPS Ubuntu (2 vCPU / ~3.7 GiB RAM)  
**Stack de Produção:** Docker Compose + Nginx Reverse Proxy + Let's Encrypt SSL

---

## 1. REQUISITOS DE SISTEMA NO VPS

* Sistema Operativo: Ubuntu 22.04 LTS ou superior
* Memória RAM: Mínimo 2 GiB (Recomendado 4 GiB)
* Espaço em Disco: Mínimo 10 GiB livres
* Portas de Firewall abertas:
  - `80/tcp` (HTTP - redirecionamento e Let's Encrypt)
  - `443/tcp` (HTTPS - tráfego seguro de produção)
  - `22/tcp` (SSH)
  - **Atenção:** A porta `3000` NÃO deve ser exposta externamente no firewall público da VPS. O Nginx atua como proxy reverso local (`127.0.0.1:3000`).

---

## 2. VARIÁVEIS DE AMBIENTE (`.env`)

Crie o arquivo `/home/ubuntu/WhatsappCRM/.env` com as seguintes variáveis obrigatórias:

```env
PORT=3000
NODE_ENV=production

# Supabase
SUPABASE_URL=https://xhnxhfhmplstqiavswgo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role_aqui
VITE_SUPABASE_URL=https://xhnxhfhmplstqiavswgo.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui

# Inteligência Artificial
GEMINI_API_KEY=sua_chave_gemini_aqui

# Configurações do SaaS
VITE_API_URL=https://agentx.kazix.site
DISABLE_SCHEDULER=false
```

---

## 3. PROCEDIMENTO DE DEPLOY (DOCKER)

```bash
# 1. Clonar ou atualizar o repositório
cd /home/ubuntu/WhatsappCRM
git pull origin main

# 2. Construir e iniciar os contentores em background
sudo docker compose up -d --build

# 3. Verificar estado dos contentores
sudo docker compose ps

# 4. Acompanhar os logs em tempo real
sudo docker compose logs -f agentx
```

---

## 4. PROCEDIMENTO DE ROLLBACK

Caso ocorra alguma falha crítica em produção:

```bash
cd /home/ubuntu/WhatsappCRM
git log --oneline -n 5
git checkout <commit-anterior-estavel>
sudo docker compose up -d --build
```

