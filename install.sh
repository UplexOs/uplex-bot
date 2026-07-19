#!/bin/bash

# ==============================================================================
# Ultimate Infrastructure Kit - Master Installer
# ==============================================================================
# Este script automatiza o deploy completo: roda o bootstrap e faz o setup do bot.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}  Instalador Ultimate Infrastructure Kit (Plug & Play) ${NC}"
echo -e "${BLUE}====================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, execute este script como root (sudo).${NC}"
  exit 1
fi

# 1. Checa dependências iniciais essenciais para rodar o script
echo -e "\n${YELLOW}[+] Verificando dependências básicas...${NC}"
apt-get update -yqq
apt-get install -yqq curl wget git nodejs npm

# O Node via apt pode ser antigo, vamos instalar o NVM e a versão LTS do Node
if ! command -v node &> /dev/null || [[ $(node -v) == v10* ]] || [[ $(node -v) == v12* ]]; then
    echo -e "${YELLOW}[+] Instalando Node.js LTS via NodeSource...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# Instala PM2 globalmente se não existir
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}[+] Instalando PM2 globalmente...${NC}"
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
echo -e "${YELLOW}Vamos configurar o seu Bot do Discord.${NC}"
read -p "Insira o TOKEN do Bot do Discord: " DISCORD_BOT_TOKEN
read -p "Insira o ID do Canal do Discord para os Alertas: " DISCORD_ALERTS_CHANNEL_ID
read -p "Insira a Secret do Webhook do Github (ou deixe em branco): " GITHUB_WEBHOOK_SECRET
read -p "Caminho do script de deploy do repositório (ex: /var/www/meujogo/deploy.sh): " DEPLOY_SCRIPT_PATH

# Prepara a pasta do bot
cd bot

# Cria o .env
cat << ENV_EOF > .env
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
DISCORD_ALERTS_CHANNEL_ID=${DISCORD_ALERTS_CHANNEL_ID}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
DEPLOY_SCRIPT_PATH=${DEPLOY_SCRIPT_PATH}
ENV_EOF

echo -e "\n${YELLOW}[+] Instalando dependências do Bot (NPM)...${NC}"
npm install --silent

echo -e "${YELLOW}[+] Transpilando código TypeScript...${NC}"
npm run build --silent

echo -e "${YELLOW}[+] Iniciando o Agente de Infraestrutura via PM2...${NC}"
# Para evitar erros caso já exista
pm2 delete InfraAgent &>/dev/null || true
pm2 start dist/index.js --name "InfraAgent"

echo -e "${YELLOW}[+] Salvando inicialização do PM2...${NC}"
pm2 save
pm2 startup systemd -u root --hp /root &>/dev/null || true

echo -e "\n${BLUE}====================================================${NC}"
echo -e "${GREEN}✅ Instalação concluída com sucesso!${NC}"
echo -e "Para checar o status do bot, digite: ${YELLOW}pm2 status${NC}"
echo -e "Para ver os logs do bot, digite: ${YELLOW}pm2 logs InfraAgent${NC}"
echo -e "${BLUE}====================================================${NC}"
