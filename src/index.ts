import { Client, GatewayIntentBits, Partials, ChannelType, TextChannel } from 'discord.js';
import * as dotenv from 'dotenv';
import { setupServer } from './server/express';
import { startProcessWatchdog } from './monitors/processWatchdog';
import { startLogScanner } from './monitors/logScanner';
import { startAuthMonitor } from './monitors/authScanner';
import { handleStatusCommand } from './commands/status';
import { handleBackupCommand } from './commands/backup';

dotenv.config();

// Nomes dos canais que o bot vai criar/buscar automaticamente
const CHANNEL_NAMES = {
    alerts: 'uplex-alerts',         // Processos caíram, erros de log
    security: 'uplex-security',     // Logins SSH, Fail2ban, IPs bloqueados
    deploys: 'uplex-deploys',       // CI/CD, webhooks do Github
    backups: 'uplex-backups',       // Backups de banco de dados
};

export interface UplexChannels {
    alerts: TextChannel;
    security: TextChannel;
    deploys: TextChannel;
    backups: TextChannel;
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel]
});

// Setup bot interactions
client.on('interactionCreate', async (interaction) => {
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;

    let hasPermission = false;

    if (interaction.guild && adminRoleId) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        hasPermission = member.roles.cache.has(adminRoleId);
    }

    // Fallback: dono do servidor sempre tem permissão
    if (!hasPermission && interaction.guild) {
        hasPermission = interaction.user.id === interaction.guild.ownerId;
    }

    if (!hasPermission) {
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: `❌ Você não tem permissão para executar esta ação. Necessário possuir o cargo autorizado.`,
                ephemeral: true
            });
        }
        return;
    }

    if (interaction.isCommand()) {
        const { commandName } = interaction;

        if (commandName === 'status') {
            await handleStatusCommand(interaction);
        } else if (commandName === 'backup') {
            await handleBackupCommand(interaction);
        }
        return;
    }

    if (!interaction.isButton()) return;

    const [action, target, extra] = interaction.customId.split('_');

    try {
        await interaction.deferReply({ ephemeral: false });

        if (action === 'restart') {
            const shell = require('shelljs');
            await interaction.editReply(`🔄 Reiniciando serviço: ${target}...`);

            if (target === 'database' || target === 'postgres' || target === 'mysql') {
                shell.exec('sudo systemctl restart postgresql || sudo systemctl restart mysql || sudo systemctl restart mariadb');
            } else {
                shell.exec(`pm2 restart ${target} || docker restart ${target} || sudo systemctl restart ${target}`);
            }

            await interaction.editReply(`✅ Serviço ${target} reiniciado com sucesso!`);
        } else if (action === 'clearcache') {
            const shell = require('shelljs');
            await interaction.editReply(`🧹 Limpando cache do sistema...`);
            shell.exec('sudo sync; echo 3 | sudo tee /proc/sys/vm/drop_caches');
            await interaction.editReply(`✅ Cache limpo com sucesso!`);
        } else if (action === 'banip') {
            const shell = require('shelljs');
            await interaction.editReply(`🔨 Banindo IP: ${target} via ufw/fail2ban...`);
            shell.exec(`sudo ufw deny from ${target} || sudo fail2ban-client set sshd banip ${target}`);
            await interaction.editReply(`✅ IP ${target} banido com sucesso!`);
        } else if (action === 'unbanip') {
            const shell = require('shelljs');
            await interaction.editReply(`♻️ Desbanindo IP: ${target} da jail ${extra}...`);
            shell.exec(`sudo fail2ban-client set ${extra} unbanip ${target}`);
            await interaction.editReply(`✅ IP ${target} removido do blocklist com sucesso!`);
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply(`❌ Erro ao executar ação: ${error}`);
    }
});

// Função para buscar ou criar um canal de texto
async function getOrCreateChannel(guild: any, name: string, topic: string): Promise<TextChannel> {
    let channel = guild.channels.cache.find(
        (ch: any) => ch.type === ChannelType.GuildText && ch.name === name
    ) as TextChannel | undefined;

    if (!channel) {
        channel = await guild.channels.create({
            name: name,
            type: ChannelType.GuildText,
            topic: topic,
        });
        console.log(`  ✅ Canal #${name} criado.`);
    } else {
        console.log(`  ✔️  Canal #${name} encontrado.`);
    }

    return channel;
}

client.once('ready', async () => {
    console.log(`🤖 Bot iniciado como ${client.user?.tag}`);

    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    if (!adminRoleId) {
        console.warn("⚠️ DISCORD_ADMIN_ROLE_ID não configurado. Apenas o dono do servidor poderá usar os comandos.");
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
        console.error("❌ O bot não está em nenhum servidor Discord.");
        return;
    }

    console.log('📂 Configurando canais...');

    try {
        const channels: UplexChannels = {
            alerts: await getOrCreateChannel(guild, CHANNEL_NAMES.alerts, '⚠️ Alertas de processos e erros de sistema'),
            security: await getOrCreateChannel(guild, CHANNEL_NAMES.security, '🛡️ Logins SSH, ataques bloqueados e firewall'),
            deploys: await getOrCreateChannel(guild, CHANNEL_NAMES.deploys, '🚀 Deploy automático via GitHub Webhook'),
            backups: await getOrCreateChannel(guild, CHANNEL_NAMES.backups, '💾 Backups de banco de dados'),
        };

        channels.alerts.send("✅ **UpLex InfraBot** online e monitorando o sistema.");

        // Iniciar monitores passando os canais corretos
        startProcessWatchdog(channels.alerts);    // Processos caindo → #uplex-alerts
        startLogScanner(channels.alerts);          // Erros de log → #uplex-alerts
        startAuthMonitor(channels.security);       // SSH e Fail2ban → #uplex-security
        setupServer(channels.deploys);             // CI/CD → #uplex-deploys
    } catch (err) {
        console.error('❌ Erro ao configurar canais:', err);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
