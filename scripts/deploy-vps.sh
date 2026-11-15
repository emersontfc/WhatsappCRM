#!/usr/bin/env bash
# ==============================================================================
# Kazix AgentX 2.0 — Script de Deploy & Atualização Automática no VPS
# Host: 149.56.44.236 | Domínio: agentx.kazix.site
# ==============================================================================

set -e

echo "=========================================================="
echo "🚀 INICIANDO DEPLOY DO KAZIX AGENTX NO VPS"
echo "Data: $(date)"
echo "=========================================================="

APP_DIR="${HOME}/WhatsappCRM"
if [ ! -d "$APP_DIR" ]; then
    echo "📁 Diretório $APP_DIR não encontrado. Clonando repositório..."
    git clone https://github.com/emersontfc/WhatsappCRM.git "$APP_DIR"
fi

cd "$APP_DIR"

# 1. Atualizar repositório Git
echo "📥 Puxando as últimas alterações da branch main do GitHub..."
git fetch origin main
git checkout main
git pull origin main

# 2. Corrigir permissões de volumes persistentes (caso arquivos tenham sido criados por root/docker)
echo "🔒 Ajustando permissões de diretórios persistentes..."
sudo mkdir -p uploads whatsapp_sessions_data logs
sudo chown -R "$USER:$USER" uploads whatsapp_sessions_data logs || true
sudo chmod -R 775 uploads whatsapp_sessions_data logs || true

# 3. Verificar arquivo de ambiente .env
if [ ! -f .env ]; then
    if [ -f .env.production.example ]; then
        echo "⚠️ Arquivo .env não encontrado. Copiando de .env.production.example..."
        cp .env.production.example .env
        echo "👉 Por favor configure as variáveis de ambiente em: $APP_DIR/.env"
    else
        echo "❌ ERRO: Arquivo .env não configurado."
        exit 1
    fi
fi

# 4. Detectar método de execução: Docker Compose ou PM2
if command -v docker &> /dev/null && [ -f docker-compose.yml ]; then
    echo "🐳 Executando deploy via Docker Compose..."
    
    # Parar container anterior se estiver rodando
    sudo docker compose down || true

    # Reconstruir imagens e iniciar em background
    echo "🏗️ Construindo imagem Docker e subindo containers..."
    sudo docker compose up -d --build

    # Aguardar subida do serviço
    echo "⏳ Aguardando inicialização do servidor..."
    sleep 8

    # Verificar saúde da aplicação
    if curl -s -f http://127.0.0.1:3000/api/health > /dev/null; then
        echo "✅ Healthcheck OK! Aplicação respondendo em http://127.0.0.1:3000"
    else
        echo "⚠️ Container iniciado. Verifique os logs com: sudo docker compose logs -f"
    fi

    # Status dos containers
    echo ""
    echo "📊 Status dos Containers:"
    sudo docker compose ps

else
    echo "🟢 Executando deploy nativo com Node.js e PM2..."
    
    # Instalar dependências
    echo "📦 Instalando dependências npm..."
    npm install --include=dev --ignore-scripts

    # Build do frontend React / Vite
    echo "🏗️ Compilando frontend para produção (vite build)..."
    npm run build

    # Iniciar ou reiniciar PM2
    if command -v pm2 &> /dev/null; then
        echo "🔄 Reiniciando processos PM2..."
        pm2 restart ecosystem.config.cjs || pm2 start ecosystem.config.cjs || pm2 restart all || pm2 start server.ts --name agentx-crm --interpreter ./node_modules/tsx/dist/cli.mjs
        pm2 save || true
        pm2 status
    else
        echo "⚠️ PM2 não encontrado. Instalando pm2 globalmente..."
        sudo npm install -g pm2
        pm2 start ecosystem.config.cjs || pm2 start server.ts --name agentx-crm --interpreter ./node_modules/tsx/dist/cli.mjs
        pm2 save || true
        pm2 status
    fi

    echo "⏳ Aguardando inicialização..."
    sleep 5
    curl -s http://127.0.0.1:3000/api/health || true
fi

echo ""
echo "=========================================================="
echo "🎉 DEPLOY CONCLUÍDO COM SUCESSO NO VPS!"
echo "Domínio: https://agentx.kazix.site (ou http://149.56.44.236)"
echo "Logs em tempo real: sudo docker compose logs -f (ou pm2 logs)"
echo "=========================================================="
