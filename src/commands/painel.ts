import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import shell from 'shelljs';
import os from 'os';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function handlePainelCommand(interaction: any) {
    await interaction.deferReply();

    // === Coleta de dados do sistema ===
    const hostname = os.hostname();
    const uptimeStr = shell.exec('uptime -p', { silent: true }).stdout.trim() || 'Desconhecido';

    // RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // Disco
    const dfResult = shell.exec("df -h / | tail -1 | awk '{print $3 \" / \" $2 \" (\" $5 \")\"}'", { silent: true }).stdout.trim();

    // CPU
    const loadAvg = os.loadavg().map(v => v.toFixed(2)).join(', ');
    const cpuCount = os.cpus().length;

    // Docker
    const dockerCount = shell.exec('docker ps -q 2>/dev/null | wc -l', { silent: true }).stdout.trim();
    const dockerNames = shell.exec("docker ps --format '{{.Names}}' 2>/dev/null", { silent: true }).stdout.trim();
    const dockerList = dockerNames ? dockerNames.split('\n').map(n => `\`${n}\``).join(', ') : 'Nenhum';

    // PM2
    const pm2Result = shell.exec('pm2 jlist 2>/dev/null', { silent: true }).stdout;
    let pm2Online = 0;
    let pm2Names: string[] = [];
    try {
        const pm2List = JSON.parse(pm2Result);
        pm2Online = pm2List.filter((p: any) => p.pm2_env.status === 'online').length;
        pm2Names = pm2List.filter((p: any) => p.pm2_env.status === 'online').map((p: any) => `\`${p.name}\``);
    } catch (e) {}

    // === Embed principal ===
    const embed = new EmbedBuilder()
        .setTitle(`🖥️ Painel de Controle — ${hostname}`)
        .setDescription('Visão geral do servidor e ações rápidas de gerenciamento.')
        .addFields(
            { name: '⏱️ Uptime', value: `\`${uptimeStr}\``, inline: true },
            { name: '🧠 CPU', value: `\`${cpuCount} cores — Load: ${loadAvg}\``, inline: true },
            { name: '​', value: '​', inline: true },
            { name: '💾 RAM', value: `\`${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%)\``, inline: true },
            { name: '📁 Disco', value: `\`${dfResult || 'Desconhecido'}\``, inline: true },
            { name: '​', value: '​', inline: true },
            { name: `🐳 Docker (${dockerCount} rodando)`, value: dockerList, inline: false },
            { name: `📦 PM2 (${pm2Online} online)`, value: pm2Names.length > 0 ? pm2Names.join(', ') : 'Nenhum', inline: false },
        )
        .setColor('#ff8c00')
        .setFooter({ text: 'UpLex InfraBot — Painel de Controle' })
        .setTimestamp();

    // === Botões de Ação (2 linhas) ===
    const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('panel_restart_pm2')
                .setLabel('🔄 Reiniciar PM2')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('panel_restart_docker')
                .setLabel('🐳 Reiniciar Dockers')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('clearcache_system')
                .setLabel('🧹 Limpar Cache')
                .setStyle(ButtonStyle.Secondary),
        );

    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('panel_update_system')
                .setLabel('🛠️ Atualizar Sistema')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_reboot_vps')
                .setLabel('⚠️ Reiniciar VPS')
                .setStyle(ButtonStyle.Danger),
        );

    await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}
