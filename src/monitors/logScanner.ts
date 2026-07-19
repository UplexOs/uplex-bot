import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import path from 'path';

// Diretórios/Arquivos de log para monitorar
const LOG_PATHS = [
    '/var/log/syslog', // Linux syslog (ou messages em algumas distros)
    '/var/log/nginx/error.log',
];

const ERROR_KEYWORDS = ['FATAL', 'Exception', 'Error', 'panic'];

// Manter o tamanho do arquivo lido para ler apenas linhas novas
const filePointers: { [key: string]: number } = {};

export function startLogScanner(discordChannel: any) {
    console.log('📄 Iniciando Scanner de Logs...');

    // Inicializa os ponteiros para os arquivos existentes
    LOG_PATHS.forEach(logPath => {
        if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            filePointers[logPath] = stats.size;

            fs.watchFile(logPath, { interval: 2000 }, (curr, prev) => {
                if (curr.size < prev.size) {
                    filePointers[logPath] = 0;
                }

                const sizeDiff = curr.size - (filePointers[logPath] ?? 0);

                if (sizeDiff > 0) {
                    const buffer = Buffer.alloc(sizeDiff);
                    const fd = fs.openSync(logPath, 'r');
                    fs.readSync(fd, buffer, 0, sizeDiff, filePointers[logPath]);
                    fs.closeSync(fd);

                    const newContent = buffer.toString();
                    const lines = newContent.split('\n').filter(line => line.trim() !== '');

                    filePointers[logPath] = curr.size;

                    // Procura por erros nas novas linhas
                    const errorLines = lines.filter(line =>
                        ERROR_KEYWORDS.some(keyword => line.toLowerCase().includes(keyword.toLowerCase()))
                    );

                    if (errorLines.length > 0) {
                        // Pega as últimas 5 linhas de erro para não spammar
                        const linesToReport = errorLines.slice(-5).join('\n');
                        const fileName = path.basename(logPath);

                        const embed = new EmbedBuilder()
                            .setTitle(`📝 Erro detectado no log: ${fileName}`)
                            .setDescription(`\`\`\`log\n${linesToReport.substring(0, 1900)}\n\`\`\``) // Limite do Discord
                            .setColor('#ffa500') // Laranja para avisos
                            .setTimestamp();

                        discordChannel.send({ embeds: [embed] });
                    }
                }
            });
            console.log(`[LogScanner] Começou a monitorar arquivo: ${logPath}`);
        }
    });
}
