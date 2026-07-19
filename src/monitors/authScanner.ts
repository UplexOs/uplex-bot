import fs from 'fs';
import os from 'os';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const AUTH_LOG_PATHS = [
    '/var/log/auth.log', // Ubuntu/Debian
    '/var/log/secure',   // CentOS/RHEL
];

const authPointers: { [key: string]: number } = {};

function formatDateBR(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}   às ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function startAuthMonitor(discordChannel: any) {
    console.log('🛡️ Iniciando Monitor de Autenticação (SSH)...');

    const existingLogPath = AUTH_LOG_PATHS.find(p => fs.existsSync(p));

    if (!existingLogPath) {
        console.warn('⚠️ Arquivo auth.log ou secure não encontrado. O monitor de SSH não funcionará.');
        return;
    }

    const hostname = os.hostname();
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
                // === Login SSH com sucesso ===
                if (line.includes('sshd') && line.includes('Accepted')) {
                    const parts = line.split(/\s+/);
                    const userIndex = parts.indexOf('for') + 1;
                    const user = parts[userIndex] || 'Desconhecido';

                    const ipIndex = parts.indexOf('from') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    const now = new Date();
                    const dateStr = formatDateBR(now);

                    const embed = new EmbedBuilder()
                        .setTitle('🔐 SSH Login Realizado')
                        .setDescription(
                            `**Usuário:** ${user}\n` +
                            `**Host:** ${hostname}\n` +
                            `**IP:** ${ip}\n` +
                            `**Data:** ${dateStr}`
                        )
                        .setColor('#00ff00')
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`banip_${ip}`)
                                .setLabel('🔨 Banir IP')
                                .setStyle(ButtonStyle.Danger)
                        );

                    discordChannel.send({ embeds: [embed], components: [row] });
                }

                // === Fail2ban — IP banido ===
                if (line.includes('fail2ban') && line.includes('Ban')) {
                    const parts = line.split(/\s+/);
                    const ipIndex = parts.indexOf('Ban') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    let jail = 'sshd';
                    const jailMatch = line.match(/\[(.*?)\]/);
                    if (jailMatch && jailMatch[1]) jail = jailMatch[1];

                    const now = new Date();
                    const dateStr = formatDateBR(now);

                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Fail2ban: IP Banido')
                        .setDescription(
                            `O firewall bloqueou um IP por múltiplas tentativas de ataque.\n\n` +
                            `**IP Bloqueado:** ${ip}\n` +
                            `**Serviço/Jail:** ${jail}\n` +
                            `**Host:** ${hostname}\n` +
                            `**Data:** ${dateStr}`
                        )
                        .setColor('#ff3300')
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`unbanip_${ip}_${jail}`)
                                .setLabel('♻️ Desbanir IP')
                                .setStyle(ButtonStyle.Secondary)
                        );

                    discordChannel.send({ embeds: [embed], components: [row] });
                }

                // === Fail2ban — IP desbanido ===
                if (line.includes('fail2ban') && line.includes('Unban')) {
                    const parts = line.split(/\s+/);
                    const ipIndex = parts.indexOf('Unban') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    let jail = 'sshd';
                    const jailMatch = line.match(/\[(.*?)\]/);
                    if (jailMatch && jailMatch[1]) jail = jailMatch[1];

                    const now = new Date();
                    const dateStr = formatDateBR(now);

                    const embed = new EmbedBuilder()
                        .setTitle('✅ Fail2ban: IP Desbanido')
                        .setDescription(
                            `Um IP foi removido da lista de bloqueio.\n\n` +
                            `**IP Liberado:** ${ip}\n` +
                            `**Serviço/Jail:** ${jail}\n` +
                            `**Host:** ${hostname}\n` +
                            `**Data:** ${dateStr}`
                        )
                        .setColor('#00cc66')
                        .setTimestamp();

                    discordChannel.send({ embeds: [embed] });
                }

                // === Tentativa de login falha (senha errada) ===
                if (line.includes('sshd') && line.includes('Failed password')) {
                    const parts = line.split(/\s+/);
                    const userIndex = parts.indexOf('for') + 1;
                    let user = parts[userIndex] || 'Desconhecido';
                    if (user === 'invalid') user = parts[userIndex + 2] || 'Desconhecido';

                    const ipIndex = parts.indexOf('from') + 1;
                    const ip = parts[ipIndex] || 'Desconhecido';

                    const now = new Date();
                    const dateStr = formatDateBR(now);

                    const embed = new EmbedBuilder()
                        .setTitle('⚠️ Tentativa de Login SSH Falha')
                        .setDescription(
                            `Uma tentativa de acesso SSH com senha incorreta foi detectada.\n\n` +
                            `**Usuário tentado:** ${user}\n` +
                            `**IP de Origem:** ${ip}\n` +
                            `**Host:** ${hostname}\n` +
                            `**Data:** ${dateStr}`
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`banip_${ip}`)
                                .setLabel('🔨 Banir IP')
                                .setStyle(ButtonStyle.Danger)
                        );

                    discordChannel.send({ embeds: [embed], components: [row] });
                }
            });
        }
    });

    console.log(`[AuthMonitor] Monitorando acessos em: ${existingLogPath}`);
}
