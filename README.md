# 🤖 InfraKit Bot

O **InfraKit Bot** é um agente de infraestrutura desenvolvido para *SaaS founders*, *web devs* e engenheiros. Ele transforma o seu servidor Discord em um **NOC (Network Operations Center)** em tempo real.

Em vez de abrir terminais SSH o tempo todo para debugar ou verificar se tudo está rodando, este bot notifica anomalias de logs, gerencia deploys, tira backups, vigia acessos ao servidor, e permite o gerenciamento da VPS diretamente via botões interativos e Slash Commands.

---

## 🚀 Recursos Principais

### 1. Monitoramento Passivo (Background)
- **Watchdog de Serviços:** Monitora PM2, Docker e Systemd. Se um serviço crítico cair, notifica e oferece botões interativos de **"Reiniciar"** e **"Limpar Cache"**.
- **Scanner de Logs de Erro:** Vigia arquivos como `/var/log/syslog` e os logs de erro do Nginx buscando por "FATAL", "Error" e envia as linhas de stacktrace pro Discord.
- **Auditor de Segurança (Auth):** Vigia o `/var/log/auth.log`. Mostra quem logou via SSH e de onde. Bloqueia tentativas de força-bruta e integra com o Fail2ban (permite **Banir** ou **Desbanir** IPs por botões).

### 2. Comandos Slash (Ativos)
- `/status` — Dashboard instantâneo com Uptime, uso de CPU (Load Average), Memória RAM, espaço em Disco, e resumo de containers PM2 e Docker ativos.
- `/backup` — Inicia um dump do PostgreSQL. Se o arquivo comprimido (`.gz`) ficar com menos de 25MB, o bot faz o upload enviando o backup diretamente no chat do Discord. 

### 3. CI/CD Pipeline Transparente
- Servidor Express embutido (porta 4000) recebe webhooks do **GitHub**.
- Quando ocorre um push na branch `main/master`, valida o `GITHUB_WEBHOOK_SECRET` com HMAC-SHA256 e avisa que o deploy está iniciando.
- Roda seu script local (ex: `deploy.sh`) em backgroud e responde no Discord se o deploy deu **sucesso** ou **falha (com log do erro)**.

---

## ⚙️ Pré-requisitos
- **Servidor:** Ubuntu 20.04+, Debian 11+ ou qualquer distribuição Linux moderna.
- **Permissões:** O processo precisa de permissões razoáveis (recomenda-se um usuário com poderes sudo NOPASSWD para ações como restart de systemd ou pg_dump, mas *nunca rode o PM2 como root* diretamente se puder evitar).
- **Node.js** v18+ e NPM instalados.

---

## 🛠️ Passo-a-Passo da Instalação

### Passo 1: Configurar a aplicação do Bot no Discord
1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications).
2. Crie uma nova aplicação e acesse a aba **Bot**.
3. **MUITO IMPORTANTE:** Ative os *Privileged Gateway Intents* (em especial o `Message Content Intent` e `Server Members Intent`).
4. Clique em **Reset Token** e copie seu Token do Bot.
5. Na aba **OAuth2** -> **URL Generator**, selecione `bot` e `applications.commands`. Nas permissões de bot marque `Administrator`. Use a URL gerada para convidar o bot para o seu servidor.

### Passo 2: Clonar e instalar dependências na VPS
Acesse seu servidor SSH e rode:

```bash
cd /opt # ou o diretório de sua preferência
git clone <seu-repositorio-infra-kit> infra-kit
cd infra-kit/bot

npm install
```

### Passo 3: Configurar as Variáveis de Ambiente
Copie o exemplo de variáveis de ambiente:

```bash
cp .env.example .env
nano .env
```

Edite as seguintes chaves de acordo com o seu ambiente:
- `DISCORD_BOT_TOKEN`: O token que você copiou no Passo 1.
- `DISCORD_CLIENT_ID`: O Application ID encontrado no menu *General Information* do portal do Discord.
- `DISCORD_ALERTS_CHANNEL_ID`: O ID da sala onde o bot vai mandar os alertas (clique com botão direito no canal do Discord -> "Copiar ID do Canal").
- `GITHUB_WEBHOOK_SECRET`: A senha (Secret) que você irá preencher na página de configuração de Webhooks do GitHub.
- `DEPLOY_SCRIPT_PATH`: O caminho do script Bash que fará o seu git pull e npm install, ex: `/opt/meu-saas/deploy.sh`.
- `DB_USER` e `DB_NAME`: Usuário e nome da sua database do PostgreSQL para os backups manuais.

### Passo 4: Transpilar e Registrar os Comandos Slash
Antes de rodar pela primeira vez, os comandos de `/` precisam ser registrados no servidor da API do Discord.

```bash
npm run build
npm run deploy-commands
```
*(Se aparecer "✅ 2 comandos atualizados com sucesso.", está tudo certo).*

### Passo 5: Inicializar em Background (PM2)
Recomenda-se rodar o bot utilizando o PM2 para que ele reinicie automaticamente caso o servidor desligue:

```bash
sudo npm install -g pm2

# Inicia o bot com o nome 'InfraAgent'
pm2 start dist/index.js --name "InfraAgent"

# Salva a lista de processos para voltar a rodar no próximo boot
pm2 save
pm2 startup
```

Pronto! O bot deve estar online e enviar uma mensagem: **"✅ Agente de Infraestrutura online e monitorando o sistema"** no canal configurado.

---

## 🛡️ Ajuste Fino de Permissões (Roles) no Discord

Para impedir que usuários sem autorização cliquem nos botões interativos ("Reiniciar", "Banir", "Limpar Cache"), certifique-se que **você possua no servidor algum cargo (Role) contendo as palavras `Admin` ou `Infra`**.

O bot lê os seus cargos no momento que você clica no botão; se a string não for encontrada, a ação é bloqueada.

---

## 🔌 Configurando o GitHub (Para Deploy Contínuo)

1. Acesse seu repositório no GitHub.
2. Vá em **Settings > Webhooks > Add webhook**.
3. Em `Payload URL` coloque o IP/Domínio do seu bot: `http://ip-da-sua-vps:4000/webhook` (Nota: Recomendado colocar Nginx como proxy reverso para usar HTTPS em produção).
4. Em `Content type` selecione `application/json`.
5. Em `Secret` preencha a mesma senha aleatória que colocou na variável `GITHUB_WEBHOOK_SECRET` do seu `.env`.
6. Selecione *Just the push event* e salve.

---

## 🛠️ Personalização (Avançado)
No arquivo `src/monitors/processWatchdog.ts`, altere a constante `CRITICAL_PROCESSES` para os nomes exatos das suas aplicações em PM2, Docker ou systemd (Ex: `['meu-saas-api', 'redis', 'database']`).
No arquivo `src/monitors/logScanner.ts`, altere a `LOG_PATHS` de acordo com os caminhos dos seus logs cruciais (ex: `/var/log/nginx/error.log`).
