import fs from 'fs';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const AUTH_LOG_PATHS = [
    '/var/log/auth.log', // Ubuntu/Debian
    '/var/log/secure',   // CentOS/RHEL
];

const authPointers: { [key: string]: number } = {};

export function startAuthMonitor(discordChannel: any) {
    console.log('🛡️ Iniciando Monitor de Autenticação (SSH)...');

    const existingLogPath = AUTH_LOG_PATHS.find(p => fs.existsSync(p));

    if (!existingLogPath) {
        console.warn('⚠️ Arquivo auth.log ou secure não encontrado. O monitor de SSH não funcionará.');
        return;
    }

    const stats = fs.statSync(existingLogPath);
    authPointers[existingLogPath] = stats.size;

    fs.watchFile(existingLogPath, { interval: 2000 }, (curr, prev) => {
        if (curr.size < prev.size) {
            authPointers[existingLogPath] = 0;
        }

        const sizeDiff = curr.size - (authPointers[existingLogPath] ?? 0);

        if (sizeDiff > 0) {
            const buffer = Buffer.alloc(sizeDiff);
            const fd = fs.openSync(existingLogPath, 'r');
            fs.readSync(fd, buffer, 0, sizeDiff, authPointers[existingLogPath]);
            fs.closeSync(fd);

            const newContent = buffer.toString();
            const lines = newContent.split('\n').filter(line => line.trim() !== '');

            authPointers[existingLogPath] = curr.size;

            lines.forEach(line => {
                // Monitorando login com sucesso
                if (line.includes('sshd') && line.includes('Accepted')) {
                    const parts = line.split(/\s+/);
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
