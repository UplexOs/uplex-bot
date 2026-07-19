#!/bin/bash

# ==============================================================================
# UpLex VPS - Master Installer
# ==============================================================================
# Este script automatiza o deploy completo: roda o bootstrap e faz o setup do bot.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

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
read -p "Insira o TOKEN do Bot do Discord: " DISCORD_BOT_TOKEN
read -p "Insira o ID do Canal do Discord para os Alertas: " DISCORD_ALERTS_CHANNEL_ID
read -p "Insira o Client ID da sua aplicação do Discord: " DISCORD_CLIENT_ID
read -p "Insira a Secret do Webhook do Github (ou deixe em branco): " GITHUB_WEBHOOK_SECRET
read -p "Caminho do script de deploy do repositório (ex: /var/www/meujogo/deploy.sh): " DEPLOY_SCRIPT_PATH

# Cria o .env
cat << ENV_EOF > .env
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
DISCORD_ALERTS_CHANNEL_ID=${DISCORD_ALERTS_CHANNEL_ID}
DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
DEPLOY_SCRIPT_PATH=${DEPLOY_SCRIPT_PATH}
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

# Verifica se há kernel pendente e oferece reboot automático
if [ -f /var/run/reboot-required ]; then
    echo ""
    echo -e "${ORANGE}⚠️  O sistema detectou uma atualização de kernel pendente.${NC}"
    echo -e "${ORANGE}   Um reboot é recomendado para aplicá-la.${NC}"
    echo -e "${ORANGE}   O bot voltará automaticamente após o reboot (PM2 startup).${NC}"
    echo ""
    read -p "Deseja reiniciar o servidor agora? (s/n): " REBOOT_CHOICE
    if [[ "$REBOOT_CHOICE" =~ ^[sS]$ ]]; then
        echo -e "${GREEN}Reiniciando em 5 segundos...${NC}"
        sleep 5
        reboot
    else
        echo -e "${ORANGE}OK. Lembre-se de rodar 'sudo reboot' quando puder.${NC}"
    fi
fi
