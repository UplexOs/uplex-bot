#!/bin/bash

# ==============================================================================
# UpLex VPS - Master Installer
# ==============================================================================
# Este script automatiza o deploy completo: roda o bootstrap e faz o setup do bot.

GREEN='\033[0;32m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

# Silencia avisos de kernel pendente e prompts do needrestart
# Isso evita que o usuário veja mensagens assustadoras durante a instalação
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

echo -e "${ORANGE}====================================================${NC}"
echo -e "${ORANGE}            Instalador Kit UpLex VPS                ${NC}"
echo -e "${ORANGE}====================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, execute este script como root (sudo).${NC}"
  exit 1
fi

# 1. Checa dependências iniciais essenciais para rodar o script
echo -e "\n${ORANGE}[+] Verificando dependências básicas...${NC}"

# Fix para broken packages antes de tentar instalar o node
apt-get update -yqq || true
apt-get --fix-broken install -yqq || true
apt-get install -yqq curl wget git || true

# O Node via apt pode ser antigo, vamos instalar o NVM e a versão LTS do Node
if ! command -v node &> /dev/null || [[ $(node -v) == v10* ]] || [[ $(node -v) == v12* ]]; then
    echo -e "${ORANGE}[+] Instalando Node.js LTS via NodeSource...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# Instala PM2 globalmente se não existir
if ! command -v pm2 &> /dev/null; then
    echo -e "${ORANGE}[+] Instalando PM2 globalmente...${NC}"
    npm install -g pm2
fi

# Garantir que estamos no diretório do instalador
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# 2. Executa o script de configuração do S.O.
echo -e "\n${GREEN}[+] Iniciando Parte 1: Configuração a nível de S.O. (Bootstrap)${NC}"
if [ -f "./scripts/setup.sh" ]; then
    chmod +x ./scripts/setup.sh
    ./scripts/setup.sh
else
    echo -e "${RED}Erro: Arquivo scripts/setup.sh não encontrado.${NC}"
    exit 1
fi

# 3. Coleta dados para o Agente TypeScript
echo -e "\n${GREEN}[+] Iniciando Parte 2: Configuração do Agente Discord (TypeScript)${NC}"
echo -e "${ORANGE}Vamos configurar o seu Bot do Discord.${NC}"
read -s -p "Insira o TOKEN do Bot do Discord (oculto): " DISCORD_BOT_TOKEN
echo ""
read -p "Insira o Client ID da sua aplicação do Discord: " DISCORD_CLIENT_ID
read -p "Insira o ID do Cargo (Role) que terá permissão de admin no bot: " DISCORD_ADMIN_ROLE_ID

echo -e "\n${ORANGE}[Opcional] CI/CD — Webhook do GitHub${NC}"
read -p "Insira a Secret do Webhook do Github (ou ENTER para pular): " GITHUB_WEBHOOK_SECRET

if [ -n "$GITHUB_WEBHOOK_SECRET" ]; then
    read -p "Caminho do script de deploy (ex: /var/www/app/deploy.sh): " DEPLOY_SCRIPT_PATH
else
    DEPLOY_SCRIPT_PATH=""
    echo -e "${ORANGE}  Pulando configuração de Deploy Automático.${NC}"
fi

# === Auto-detecção de banco de dados ===
echo -e "\n${ORANGE}[+] Detectando banco de dados instalado...${NC}"
DB_USER=""
DB_NAME=""
DB_PASS=""

if command -v pg_dump &> /dev/null; then
    echo -e "${GREEN}  ✔ PostgreSQL detectado.${NC}"
    read -p "  Usuário do Postgres (padrão: postgres): " DB_USER_INPUT
    DB_USER="${DB_USER_INPUT:-postgres}"
    read -p "  Nome do banco de dados (padrão: postgres): " DB_NAME_INPUT
    DB_NAME="${DB_NAME_INPUT:-postgres}"
elif command -v mysqldump &> /dev/null; then
    echo -e "${GREEN}  ✔ MySQL/MariaDB detectado.${NC}"
    read -p "  Usuário do MySQL (padrão: root): " DB_USER_INPUT
    DB_USER="${DB_USER_INPUT:-root}"
    read -p "  Nome do banco de dados: " DB_NAME
    read -s -p "  Senha do MySQL (oculta, ou ENTER se não tiver): " DB_PASS
    echo ""
else
    echo -e "${ORANGE}  ⚠ Nenhum banco de dados detectado (pg_dump ou mysqldump). O comando /backup não funcionará até instalar um.${NC}"
fi

# === Auto-detecção de processos para monitorar ===
echo -e "\n${ORANGE}[+] Detectando serviços rodando...${NC}"
DETECTED_PROCESSES=""

# Detecta processos PM2
if command -v pm2 &> /dev/null; then
    PM2_PROCS=$(pm2 jlist 2>/dev/null | grep -oP '"name":"\K[^"]+' | paste -sd ',' -)
    if [ -n "$PM2_PROCS" ]; then
        DETECTED_PROCESSES="$PM2_PROCS"
        echo -e "${GREEN}  ✔ PM2: $PM2_PROCS${NC}"
    fi
fi

# Detecta containers Docker
if command -v docker &> /dev/null; then
    DOCKER_PROCS=$(docker ps --format '{{.Names}}' 2>/dev/null | paste -sd ',' -)
    if [ -n "$DOCKER_PROCS" ]; then
        if [ -n "$DETECTED_PROCESSES" ]; then
            DETECTED_PROCESSES="$DETECTED_PROCESSES,$DOCKER_PROCS"
        else
            DETECTED_PROCESSES="$DOCKER_PROCS"
        fi
        echo -e "${GREEN}  ✔ Docker: $DOCKER_PROCS${NC}"
    fi
fi

# Detecta banco de dados como serviço
if systemctl is-active --quiet postgresql 2>/dev/null; then
    if [ -n "$DETECTED_PROCESSES" ]; then
        DETECTED_PROCESSES="$DETECTED_PROCESSES,database"
    else
        DETECTED_PROCESSES="database"
    fi
    echo -e "${GREEN}  ✔ Systemd: postgresql${NC}"
elif systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mariadb 2>/dev/null; then
    if [ -n "$DETECTED_PROCESSES" ]; then
        DETECTED_PROCESSES="$DETECTED_PROCESSES,database"
    else
        DETECTED_PROCESSES="database"
    fi
    echo -e "${GREEN}  ✔ Systemd: mysql/mariadb${NC}"
fi

if [ -z "$DETECTED_PROCESSES" ]; then
    echo -e "${ORANGE}  ⚠ Nenhum serviço detectado. O watchdog não irá monitorar nada até haver processos no PM2, Docker ou Systemd.${NC}"
fi

# Cria o .env
cat << ENV_EOF > .env
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
DISCORD_ADMIN_ROLE_ID=${DISCORD_ADMIN_ROLE_ID}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
DEPLOY_SCRIPT_PATH=${DEPLOY_SCRIPT_PATH}
DB_USER=${DB_USER}
DB_NAME=${DB_NAME}
DB_PASS=${DB_PASS}
CRITICAL_PROCESSES=${DETECTED_PROCESSES}
ENV_EOF

echo -e "\n${ORANGE}[+] Instalando dependências do Bot (NPM)...${NC}"
npm install --silent

echo -e "${ORANGE}[+] Transpilando código TypeScript...${NC}"
npm run build --silent

echo -e "${ORANGE}[+] Registrando Slash Commands do Discord...${NC}"
npm run deploy-commands --silent

echo -e "${ORANGE}[+] Iniciando o Agente de Infraestrutura via PM2...${NC}"
# Para evitar erros caso já exista
pm2 delete UplexInfraBot &>/dev/null || true
pm2 start dist/index.js --name "UplexInfraBot"

echo -e "${ORANGE}[+] Salvando inicialização do PM2...${NC}"
pm2 save
pm2 startup systemd -u root --hp /root &>/dev/null || true

echo -e "\n${ORANGE}====================================================${NC}"
echo -e "${GREEN}✅ Instalação concluída com sucesso!${NC}"
echo -e "Para checar o status do bot, digite: ${ORANGE}pm2 status${NC}"
echo -e "Para ver os logs do bot, digite: ${ORANGE}pm2 logs UplexInfraBot${NC}"
echo -e "${ORANGE}====================================================${NC}"
