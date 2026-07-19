import fs from 'fs';
import chokidar from 'chokidar';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const AUTH_LOG_PATHS = [
    '/var/log/auth.log', // Ubuntu/Debian
    '/var/log/secure',   // CentOS/RHEL
];

// Dicionário para guardar o estado dos arquivos para ler apenas as novas linhas
const authPointers: { [key: string]: number } = {};

export function startAuthMonitor(discordChannel: any) {
    console.log('🛡️ Iniciando Monitor de Autenticação (SSH)...');

    // Identificar qual arquivo de log de auth existe no sistema
    const existingLogPath = AUTH_LOG_PATHS.find(path => fs.existsSync(path));

    if (!existingLogPath) {
        console.warn('⚠️ Arquivo auth.log ou secure não encontrado. O monitor de SSH não funcionará.');
        return;
    }

    const watcher = chokidar.watch(existingLogPath, {
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
    });

    const stats = fs.statSync(existingLogPath);
    authPointers[existingLogPath] = stats.size;

    watcher.on('change', (filePath) => {
        if (authPointers[filePath] === undefined) {
            const currentStats = fs.statSync(filePath);
            authPointers[filePath] = currentStats.size;
            return;
        }

        const currentStats = fs.statSync(filePath);

        if (currentStats.size < authPointers[filePath]) {
            authPointers[filePath] = 0; // Log foi rotacionado
        }

        const sizeDiff = currentStats.size - authPointers[filePath];

        if (sizeDiff > 0) {
            const buffer = Buffer.alloc(sizeDiff);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, sizeDiff, authPointers[filePath]);
            fs.closeSync(fd);

            const newContent = buffer.toString();
            const lines = newContent.split('\n').filter(line => line.trim() !== '');

            authPointers[filePath] = currentStats.size;

            lines.forEach(line => {
                // Monitorando login com sucesso
                if (line.includes('sshd') && line.includes('Accepted')) {
                    const parts = line.split(/\s+/);
                    // Extract data intelligently from auth.log
                    const userIndex = parts.indexOf('for') + 1;
                    const user = parts[userIndex] || 'Desconhecido';

                    const ipIndex = parts.indexOf('from') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    const embed = new EmbedBuilder()
                        .setTitle('🟢 Acesso SSH Realizado')
                        .setDescription(`Um novo login SSH foi detectado no servidor.`)
                        .addFields(
                            { name: 'Usuário', value: `\`${user}\``, inline: true },
                            { name: 'IP de Origem', value: `\`${ip}\``, inline: true }
                        )
                        .setColor('#00ff00')
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`banip_${ip}`)
                                .setLabel('Banir IP (Firewall)')
                                .setStyle(ButtonStyle.Danger)
                        );

                    discordChannel.send({ embeds: [embed], components: [row] });
                }

                // Monitorando Fail2ban (bloqueios automáticos)
                if (line.includes('fail2ban') && line.includes('Ban')) {
                    const parts = line.split(/\s+/);
                    const ipIndex = parts.indexOf('Ban') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    let jail = 'sshd';
                    const jailMatch = line.match(/\[(.*?)\]/);
                    if (jailMatch && jailMatch[1]) jail = jailMatch[1];

                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Fail2ban: Ataque Bloqueado')
                        .setDescription(`O firewall bloqueou o IP **${ip}** devido a múltiplas tentativas de ataque/falhas de login.`)
                        .addFields(
                            { name: 'Serviço/Jail', value: `\`${jail}\``, inline: true },
                            { name: 'IP Bloqueado', value: `\`${ip}\``, inline: true }
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`unbanip_${ip}_${jail}`)
                                .setLabel('Desbanir IP')
                                .setStyle(ButtonStyle.Secondary)
                        );

                    discordChannel.send({ embeds: [embed], components: [row] });
                }
            });
        }
    });

    console.log(`[AuthMonitor] Monitorando acessos em: ${existingLogPath}`);
}
