#!/bin/bash

# ==============================================================================
# UpLex VPS - Bootstrap Script
# ==============================================================================
# Este script configura uma VPS do zero com segurança, otimizações e proxy.
# Requer execução como root.

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

echo -e "${ORANGE}=== UpLex VPS - Configuração do Sistema ===${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, execute este script como root (sudo).${NC}"
  exit 1
fi

# ==============================================================================
# 0. Coleta de Variáveis
# ==============================================================================
echo -e "${ORANGE}Por favor, insira as informações abaixo:${NC}"
read -p "Domínio para o Nginx/Certbot (ex: api.meusaas.com ou deixe em branco): " DOMAIN_NAME
read -p "Email para registro no Let's Encrypt (ou deixe em branco): " LETSENCRYPT_EMAIL

# ==============================================================================
# 0.1 Resolve pacotes quebrados e conflitos comuns em VPSs
# ==============================================================================
echo -e "\n${ORANGE}[+] Resolvendo dependências quebradas...${NC}"
apt-get update -yqq || true
apt-get --fix-broken install -yqq || true
dpkg --configure -a || true

# Remove pacotes que conflitam entre si em VPSs pré-configuradas
# containerd.io (Docker oficial) conflita com containerd (Ubuntu)
# iptables-persistent conflita com ufw
echo -e "${ORANGE}[+] Removendo pacotes conflitantes (se existirem)...${NC}"
apt-get remove -yqq iptables-persistent netfilter-persistent containerd 2>/dev/null || true

echo -e "\n${ORANGE}[+] Atualizando o sistema...${NC}"
apt-get update -yqq && apt-get upgrade -yqq || true

# Instala pacotes em grupos separados para evitar conflitos em cadeia
echo -e "${ORANGE}[+] Instalando pacotes essenciais...${NC}"
apt-get install -yqq curl wget git jq || true

echo -e "${ORANGE}[+] Instalando firewall e segurança...${NC}"
apt-get install -yqq ufw fail2ban || true

echo -e "${ORANGE}[+] Instalando Nginx e Certbot...${NC}"
apt-get install -yqq nginx certbot python3-certbot-nginx || true

echo -e "${ORANGE}[+] Instalando Docker...${NC}"
apt-get install -yqq docker.io docker-compose || true

# ==============================================================================
# 1. Segurança Base (UFW, Iptables e Fail2ban)
# ==============================================================================
echo -e "\n${GREEN}[+] Configurando UFW (Firewall)...${NC}"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw allow 4000/tcp # Porta do CI/CD Webhook
ufw --force enable

echo -e "\n${GREEN}[+] Configurando Fail2ban e Alertas no Discord...${NC}"

# Criar action simulando block, o fail2ban via SSH já será pego pelo authScanner.ts no Bot
# Configurar jail.local
cat << EOF > /etc/fail2ban/jail.local
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF

systemctl restart fail2ban

# ==============================================================================
# 2. Otimização de Kernel (Network e File Descriptors)
# ==============================================================================
echo -e "\n${GREEN}[+] Otimizando Kernel (TCP BBR e Limits)...${NC}"
cat << 'EOF' >> /etc/sysctl.conf

# Otimizações de Rede e File Descriptors
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
fs.file-max = 2097152
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.somaxconn = 65535
EOF
sysctl -p

cat << 'EOF' >> /etc/security/limits.conf
* soft nofile 1048576
* hard nofile 1048576
root soft nofile 1048576
root hard nofile 1048576
EOF

# ==============================================================================
# 3. Automação e Faxina (Cronjobs)
# ==============================================================================
echo -e "\n${GREEN}[+] Criando scripts de limpeza e backup...${NC}"

# Script de Garbage Collector
cat << 'EOF' > /usr/local/bin/gc-cleaner.sh
#!/bin/bash
echo "Iniciando Garbage Collection..."
docker system prune -af --volumes
journalctl --vacuum-time=3d
apt-get autoremove -y
apt-get clean
echo "Limpeza concluída."
EOF
chmod +x /usr/local/bin/gc-cleaner.sh

# Adicionar no Cron (Roda as 4 da manhã)
(crontab -l 2>/dev/null; echo "0 4 * * * /usr/local/bin/gc-cleaner.sh > /var/log/gc-cleaner.log 2>&1") | crontab -

# ==============================================================================
# 4. Proxy Reverso (Nginx e Certbot)
# ==============================================================================
if [ -n "$DOMAIN_NAME" ] && [ -n "$LETSENCRYPT_EMAIL" ]; then
    echo -e "\n${GREEN}[+] Configurando Nginx e SSL para ${DOMAIN_NAME}...${NC}"

    cat << EOF > /etc/nginx/sites-available/bot
server {
    listen 80;
    server_name ${DOMAIN_NAME};

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_addrs;
    }
}
EOF

    ln -sf /etc/nginx/sites-available/bot /etc/nginx/sites-enabled/
    nginx -t
    systemctl restart nginx

    # Gerar certificado SSL (Isso requer que o domínio já esteja apontando para o IP da VPS)
    echo -e "${YELLOW}Nota: O Certbot tentará gerar o SSL. Se o DNS não estiver propagado, ele falhará, mas o setup continuará.${NC}"
    certbot --nginx -d ${DOMAIN_NAME} --non-interactive --agree-tos -m ${LETSENCRYPT_EMAIL} || true
fi

echo -e "\n${GREEN}=== Bootstrap concluído com sucesso! ===${NC}"
echo -e "A máquina foi otimizada, protegida e preparada."
echo -e "Próximo passo: Configurar e rodar o Agente TypeScript (Bot Discord)."
