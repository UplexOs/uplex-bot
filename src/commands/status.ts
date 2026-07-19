import { EmbedBuilder } from 'discord.js';
import shell from 'shelljs';
import os from 'os';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function handleStatusCommand(interaction: any) {
    await interaction.deferReply();

    // System Uptime
    const uptimeStr = shell.exec('uptime -p', { silent: true }).stdout.trim();

    // Memória RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // Disco
    const dfResult = shell.exec("df -h / | tail -1 | awk '{print $3 \" / \" $2 \" (\" $5 \")\"}'", { silent: true }).stdout.trim();

    // CPU (load average)
    const loadAvg = os.loadavg().map(v => v.toFixed(2)).join(', ');

    // Docker Containers
    const dockerCount = shell.exec('docker ps -q | wc -l', { silent: true }).stdout.trim();

    // PM2 Processes
    const pm2Result = shell.exec('pm2 jlist', { silent: true }).stdout;
    let pm2Count = 0;
    try {
        const pm2List = JSON.parse(pm2Result);
        pm2Count = pm2List.filter((p: any) => p.pm2_env.status === 'online').length;
    } catch(e) {}

    const embed = new EmbedBuilder()
        .setTitle('📊 Status do Servidor')
        .setDescription(`Resumo da saúde da VPS e recursos.`)
        .addFields(
            { name: 'Uptime', value: `\`${uptimeStr || 'Desconhecido'}\``, inline: false },
            { name: 'RAM (Usada/Total)', value: `\`${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%)\``, inline: true },
            { name: 'Disco (Root)', value: `\`${dfResult || 'Desconhecido'}\``, inline: true },
            { name: 'CPU Load (1m, 5m, 15m)', value: `\`${loadAvg}\``, inline: true },
            { name: 'Containers Docker', value: `\`${dockerCount} rodando\``, inline: true },
            { name: 'Processos PM2', value: `\`${pm2Count} online\``, inline: true }
        )
        .setColor('#0099ff')
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
