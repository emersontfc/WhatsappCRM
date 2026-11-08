#!/usr/bin/env bash
# ================================================================
# AgentX / WhatsCRM SaaS - Script de Inicialização Rápida no VPS
# Compatível com Ubuntu 22.04 / 24.04 LTS e Debian 12
# ================================================================

set -e

echo "=========================================================="
echo "🚀 Iniciando configuração do ambiente VPS para AgentX SaaS"
echo "=========================================================="

# 1. Atualizar repositórios do sistema
echo "📦 Atualizando pacotes do sistema..."
sudo apt update && sudo apt upgrade -y

# 2. Instalar utilitários essenciais
echo "🛠️ Instalando ferramentas básicas (curl, git, ufw, ffmpeg, build-essential)..."
sudo apt install -y curl git ufw ffmpeg htop ca-certificates gnupg lsb-release build-essential

# 3. Configurar Firewall básico
echo "🔒 Configurando Firewall UFW (SSH, HTTP, HTTPS)..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

# 4. Perguntar pelo método de execução (Docker ou PM2)
echo ""
echo "Escolha o método de deploy preferido:"
echo "1) Docker & Docker Compose (Recomendado - 100% isolado)"
echo "2) Node.js 22 + PM2 (Nativo no sistema)"
read -p "Digite 1 ou 2 [Padrão: 1]: " DEPLOY_MODE
DEPLOY_MODE=${DEPLOY_MODE:-1}

if [ "$DEPLOY_MODE" = "1" ]; then
    echo "🐳 Instalando Docker & Docker Compose..."
    if ! command -v docker &> /dev/null; then
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg

        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
          sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt update
        sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        sudo usermod -aG docker $USER || true
    fi
    echo "✅ Docker instalado com sucesso!"
else
    echo "🟢 Instalando Node.js 22 LTS e PM2..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
    sudo npm install -g pm2
    echo "✅ Node $(node -v) e PM2 $(pm2 -v) instalados!"
fi

# 5. Criar diretórios de persistência
echo "📁 Criando diretórios persistentes..."
mkdir -p uploads whatsapp_sessions_data logs
chmod -R 755 uploads whatsapp_sessions_data logs

echo ""
echo "=========================================================="
echo "🎉 Ambiente base do VPS configurado com sucesso!"
echo "=========================================================="
echo ""
echo "Próximos passos:"
echo "1. Crie o seu arquivo .env com base em .env.production.example:"
echo "   cp .env.production.example .env && nano .env"
echo ""
if [ "$DEPLOY_MODE" = "1" ]; then
    echo "2. Suba o container com Docker Compose:"
    echo "   sudo docker compose up -d --build"
    echo "3. Acompanhe os logs com:"
    echo "   sudo docker compose logs -f"
else
    echo "2. Instale as dependências e compile o frontend:"
    echo "   npm install && npm run build"
    echo "3. Inicie a aplicação com PM2:"
    echo "   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup"
fi
echo ""
echo "Consulte DEPLOY_VPS.md para o guia completo com Nginx e SSL (Certbot)."

