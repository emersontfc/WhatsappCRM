#!/usr/bin/env bash
# ================================================================
# AgentX / WhatsCRM SaaS - Script de Backup Automático de Sessões e Mídias
# Adicione ao crontab com: 0 3 * * * /var/www/agentx/scripts/backup.sh
# ================================================================

set -e

BACKUP_DIR="/var/backups/agentx"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] 📦 Iniciando backup do AgentX..."

ARCHIVE_NAME="$BACKUP_DIR/agentx_backup_${TIMESTAMP}.tar.gz"

# Compactar sessões do WhatsApp e mídias enviadas
tar -czf "$ARCHIVE_NAME" \
    -C "$PROJECT_DIR" \
    whatsapp_sessions_data \
    uploads \
    --exclude="*.log" 2>/dev/null || true

echo "[$(date)] ✅ Backup gerado com sucesso: $ARCHIVE_NAME"
echo "Tamanho do backup: $(du -sh "$ARCHIVE_NAME" | cut -f1)"

# Manter apenas os últimos 7 dias de backups para economizar espaço em disco
find "$BACKUP_DIR" -name "agentx_backup_*.tar.gz" -type f -mtime +7 -delete
echo "[$(date)] 🧹 Backups com mais de 7 dias removidos."

