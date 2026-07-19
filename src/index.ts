import { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import { setupServer } from './server/express';
import { startProcessWatchdog } from './monitors/processWatchdog';
import { startLogScanner } from './monitors/logScanner';
import { startAuthMonitor } from './monitors/authScanner';
import { handleStatusCommand } from './commands/status';
import { handleBackupCommand } from './commands/backup';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.Channel]
});

// Setup bot interactions
client.on('interactionCreate', async (interaction) => {
    // Apenas admins ou equipe de infra podem interagir
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const hasPermission = member?.roles.cache.some(role =>
        role.name.includes('Admin') || role.name.includes('Infra')
    );

    if (!hasPermission) {
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: '❌ Você não tem permissão para executar esta ação. Necessário cargo contendo "Admin" ou "Infra".',
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

client.once('ready', () => {
    console.log(`🤖 Bot iniciado como ${client.user?.tag}`);

    const alertChannelId = process.env.DISCORD_ALERTS_CHANNEL_ID;
    if (!alertChannelId) {
        console.error("DISCORD_ALERTS_CHANNEL_ID não configurado no .env");
        return;
    }

    const channel = client.channels.cache.get(alertChannelId);
    if (channel && channel.isTextBased()) {
        channel.send("✅ Agente de Infraestrutura online e monitorando o sistema.");

        // Iniciar monitores passando o canal para alertas
        startProcessWatchdog(channel);
        startLogScanner(channel);
        startAuthMonitor(channel); // Adicionado monitor de SSH/Auth
        setupServer(channel);
    } else {
        console.error("Canal de alertas não encontrado ou não é canal de texto.");
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
