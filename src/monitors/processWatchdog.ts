import shell from 'shelljs';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Lista de processos críticos a monitorar (nomes no PM2, Docker ou systemctl)
// Pode ser sobrescrito pelo .env
const envProcesses = process.env.CRITICAL_PROCESSES;
const CRITICAL_PROCESSES = envProcesses
    ? envProcesses.split(',').map(p => p.trim())
    : ['DayZServer', 'FXServer', 'database'];

const CHECK_INTERVAL = 60000; // 1 minuto

export function startProcessWatchdog(discordChannel: any) {
    console.log(`👀 Iniciando Watchdog para processos: ${CRITICAL_PROCESSES.join(', ')}`);

    setInterval(() => {
        CRITICAL_PROCESSES.forEach(processName => {
            // Verifica PM2
            const pm2Check = shell.exec(`pm2 jlist | grep -q '"name":"${processName}"' && pm2 jlist | grep '"name":"${processName}"' | grep -q '"status":"online"'`, { silent: true });

            // Verifica Docker (se o container está rodando)
            const dockerCheck = shell.exec(`docker ps --format '{{.Names}}' | grep -q "^${processName}$"`, { silent: true });

            // Verifica banco de dados especial
            let isRunning = false;
            let dbType = '';

            if (processName === 'database' || processName === 'postgres' || processName === 'mysql') {
                const pgCheck = shell.exec(`systemctl is-active --quiet postgresql`, { silent: true });
                const mysqlCheck = shell.exec(`systemctl is-active --quiet mysql`, { silent: true });
                const mariadbCheck = shell.exec(`systemctl is-active --quiet mariadb`, { silent: true });

                if (pgCheck.code === 0) { isRunning = true; dbType = 'postgresql'; }
                else if (mysqlCheck.code === 0) { isRunning = true; dbType = 'mysql'; }
                else if (mariadbCheck.code === 0) { isRunning = true; dbType = 'mariadb'; }
                else { isRunning = pm2Check.code === 0 || dockerCheck.code === 0; }
            } else {
                isRunning = pm2Check.code === 0 || dockerCheck.code === 0;
            }

            if (!isRunning) {
                // Alerta de processo fora do ar
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ Alerta Crítico: Processo Fora do Ar')
                    .setDescription(`O serviço **${processName}** parou de responder ou não está rodando.`)
                    .setColor('#ff0000')
                    .setTimestamp();

                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`restart_${processName}`)
                            .setLabel('Reiniciar Serviço')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('clearcache_system')
                            .setLabel('Limpar Cache')
                            .setStyle(ButtonStyle.Secondary)
                    );

                discordChannel.send({ embeds: [embed], components: [row] });

                // Tenta reiniciar automaticamente (opcional)
                /*
                console.log(`Tentando reiniciar ${processName}...`);
                if (processName === 'database') {
                    shell.exec(`sudo systemctl restart postgresql`, { silent: true });
                } else {
                    shell.exec(`pm2 restart ${processName} || docker restart ${processName} || sudo systemctl restart ${processName}`, { silent: true });
                }
                */
            }
        });
    }, CHECK_INTERVAL);
}
