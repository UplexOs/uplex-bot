import { Client, GatewayIntentBits, Partials, ChannelType, TextChannel } from 'discord.js';
import * as dotenv from 'dotenv';
import { setupServer } from './server/express';
import { startProcessWatchdog } from './monitors/processWatchdog';
import { startLogScanner } from './monitors/logScanner';
import { startAuthMonitor } from './monitors/authScanner';
import { handleStatusCommand } from './commands/status';
import { handleBackupCommand } from './commands/backup';

dotenv.config();

const ALERTS_CHANNEL_NAME = 'uplex-alerts';

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
    // Checagem de permissão via ID do cargo (role) configurado no .env
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

            if (target === 'database') {
                shell.exec('sudo systemctl restart postgresql');
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

client.once('ready', async () => {
    console.log(`🤖 Bot iniciado como ${client.user?.tag}`);

    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    if (!adminRoleId) {
        console.warn("⚠️ DISCORD_ADMIN_ROLE_ID não configurado. Apenas o dono do servidor poderá usar os comandos.");
    }

    // Encontrar ou criar o canal de alertas automaticamente
    const guild = client.guilds.cache.first();
    if (!guild) {
        console.error("❌ O bot não está em nenhum servidor Discord.");
        return;
    }

    let alertChannel: TextChannel | undefined;

    // Procura um canal com o nome 'uplex-alerts'
    alertChannel = guild.channels.cache.find(
        ch => ch.type === ChannelType.GuildText && ch.name === ALERTS_CHANNEL_NAME
    ) as TextChannel | undefined;

    // Se não existir, cria automaticamente
    if (!alertChannel) {
        try {
            alertChannel = await guild.channels.create({
                name: ALERTS_CHANNEL_NAME,
                type: ChannelType.GuildText,
                topic: '🤖 Canal de alertas do UpLex InfraBot — monitoramento, segurança e deploys.',
            });
            console.log(`✅ Canal #${ALERTS_CHANNEL_NAME} criado automaticamente.`);
        } catch (err) {
            console.error(`❌ Não foi possível criar o canal #${ALERTS_CHANNEL_NAME}:`, err);
            return;
        }
    }

    alertChannel.send("✅ Agente de Infraestrutura online e monitorando o sistema.");

    // Iniciar monitores passando o canal para alertas
    startProcessWatchdog(alertChannel);
    startLogScanner(alertChannel);
    startAuthMonitor(alertChannel);
    setupServer(alertChannel);
});

client.login(process.env.DISCORD_BOT_TOKEN);
