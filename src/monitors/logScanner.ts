import chokidar from 'chokidar';
import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import path from 'path';

// Diretórios/Arquivos de log para monitorar
// ATUALIZE ESTES CAMINHOS DE ACORDO COM SEU AMBIENTE
const LOG_PATHS = [
    '/var/log/syslog', // Linux syslog (ou messages em algumas distros)
    '/var/log/nginx/error.log',
    // '/home/user/.pm2/logs/*.log',
];

const ERROR_KEYWORDS = ['FATAL', 'Exception', 'Error', 'panic'];

// Manter o tamanho do arquivo lido para ler apenas linhas novas
const filePointers: { [key: string]: number } = {};

export function startLogScanner(discordChannel: any) {
    console.log('📄 Iniciando Scanner de Logs...');

    const watcher = chokidar.watch(LOG_PATHS, {
        persistent: true,
        ignoreInitial: true, // Ignorar arquivos na inicialização
        usePolling: false,
    });

    // Inicializa os ponteiros para os arquivos existentes
    LOG_PATHS.forEach(logPath => {
        // Se for glob (tem *), não inicializa aqui
        if (!logPath.includes('*') && fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            filePointers[logPath] = stats.size;
        }
    });

    watcher.on('change', (filePath) => {
        // Pula se o arquivo não tiver ponteiro (foi criado agora ou é glob)
        if (filePointers[filePath] === undefined) {
            const stats = fs.statSync(filePath);
            filePointers[filePath] = stats.size;
            return;
        }

        const stats = fs.statSync(filePath);

        // Se o arquivo foi rotacionado (ficou menor)
        if (stats.size < filePointers[filePath]) {
            filePointers[filePath] = 0;
        }

        const sizeDiff = stats.size - filePointers[filePath];

        // Se cresceu mais de 0 bytes
        if (sizeDiff > 0) {
            const buffer = Buffer.alloc(sizeDiff);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, sizeDiff, filePointers[filePath]);
            fs.closeSync(fd);

            const newContent = buffer.toString();
            const lines = newContent.split('\n').filter(line => line.trim() !== '');

            // Atualiza o ponteiro
            filePointers[filePath] = stats.size;

            // Procura por erros nas novas linhas
            const errorLines = lines.filter(line =>
                ERROR_KEYWORDS.some(keyword => line.toLowerCase().includes(keyword.toLowerCase()))
            );

            if (errorLines.length > 0) {
                // Pega as últimas 5 linhas de erro para não spammar
                const linesToReport = errorLines.slice(-5).join('\n');
                const fileName = path.basename(filePath);

                const embed = new EmbedBuilder()
                    .setTitle(`📝 Erro detectado no log: ${fileName}`)
                    .setDescription(`\`\`\`log\n${linesToReport.substring(0, 1900)}\n\`\`\``) // Limite do Discord
                    .setColor('#ffa500') // Laranja para avisos
                    .setTimestamp();

                discordChannel.send({ embeds: [embed] });
            }
        }
    });

    watcher.on('add', (filePath) => {
        const stats = fs.statSync(filePath);
        filePointers[filePath] = stats.size;
        console.log(`[LogScanner] Começou a monitorar novo arquivo: ${filePath}`);
    });

    watcher.on('error', (error) => {
        console.error(`[LogScanner] Erro no watcher: ${error}`);
    });
}
