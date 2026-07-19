import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import shell from 'shelljs';
import fs from 'fs';
import path from 'path';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export async function handleBackupCommand(interaction: any) {
    await interaction.deferReply();

    const target = interaction.options?.getString('target') || 'database';

    await interaction.editReply(`🔄 Iniciando backup de **${target}**...`);

    const dateStr = formatDate(new Date());
    const backupDir = path.join(process.cwd(), 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    let backupFile = '';
    let success = false;
    let errorMessage = '';
    let dbEngine = '';

    const dbUser = process.env.DB_USER || 'postgres';
    const dbName = process.env.DB_NAME || 'postgres';
    const dbPass = process.env.DB_PASS || '';
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '';
    const dbDockerContainer = process.env.DB_DOCKER_CONTAINER || '';

    if (target === 'database' || target === 'postgres') {
        backupFile = path.join(backupDir, `db_backup_${dateStr}.sql`);

        // Detecta se o banco roda dentro de um container Docker
        const isDocker = dbDockerContainer !== '';

        // Detecta o tipo de banco de dados
        const hasPgDump = isDocker
            ? shell.exec(`docker exec ${dbDockerContainer} which pg_dump`, { silent: true }).code === 0
            : shell.exec('command -v pg_dump', { silent: true }).code === 0;

        const hasMysqlDump = isDocker
            ? shell.exec(`docker exec ${dbDockerContainer} which mysqldump`, { silent: true }).code === 0
            : shell.exec('command -v mysqldump', { silent: true }).code === 0;

        let result;
        let portFlag = '';

        if (hasPgDump) {
            dbEngine = 'PostgreSQL';
            portFlag = dbPort ? `-p ${dbPort}` : '';

            if (isDocker) {
                result = shell.exec(
                    `docker exec ${dbDockerContainer} pg_dump -U ${dbUser} ${portFlag} ${dbName} > ${backupFile}`,
                    { silent: true }
                );
            } else {
                result = shell.exec(
                    `sudo -u ${dbUser} pg_dump -h ${dbHost} ${portFlag} ${dbName} > ${backupFile}`,
                    { silent: true }
                );
            }
        } else if (hasMysqlDump) {
            dbEngine = 'MySQL/MariaDB';
            portFlag = dbPort ? `-P ${dbPort}` : '';
            const passFlag = dbPass ? `-p${dbPass}` : '';

            if (isDocker) {
                result = shell.exec(
                    `docker exec ${dbDockerContainer} mysqldump -u ${dbUser} ${passFlag} -h ${dbHost} ${portFlag} ${dbName} > ${backupFile}`,
                    { silent: true }
                );
            } else {
                result = shell.exec(
                    `mysqldump -u ${dbUser} ${passFlag} -h ${dbHost} ${portFlag} ${dbName} > ${backupFile}`,
                    { silent: true }
                );
            }
        } else {
            result = { code: 1, stderr: "Nenhum banco de dados detectado (pg_dump ou mysqldump não encontrados)" };
        }

        if (result.code === 0) {
            const gzipResult = shell.exec(`gzip ${backupFile}`, { silent: true });
            if (gzipResult.code === 0) {
                backupFile = `${backupFile}.gz`;
                success = true;
            } else {
                errorMessage = "Falha ao compactar o backup.";
            }
        } else {
            errorMessage = result.stderr || "Erro desconhecido ao rodar o dump do banco";
        }
    } else {
        errorMessage = `Alvo '${target}' não é suportado para backup manual ainda.`;
    }

    if (success && fs.existsSync(backupFile)) {
        const stats = fs.statSync(backupFile);
        const sizeStr = formatBytes(stats.size);

        const runningIn = dbDockerContainer ? `Docker (${dbDockerContainer})` : 'Nativo (VPS)';

        const embed = new EmbedBuilder()
            .setTitle('✅ Backup Concluído')
            .setDescription(`O backup de **${target}** foi realizado com sucesso.`)
            .addFields(
                { name: 'Engine', value: `\`${dbEngine}\``, inline: true },
                { name: 'Ambiente', value: `\`${runningIn}\``, inline: true },
                { name: 'Banco', value: `\`${dbName}\``, inline: true },
                { name: 'Arquivo', value: `\`${path.basename(backupFile)}\``, inline: true },
                { name: 'Tamanho', value: `\`${sizeStr}\``, inline: true },
            )
            .setColor('#00ff00')
            .setTimestamp();

        if (stats.size < 25 * 1024 * 1024) {
            const attachment = new AttachmentBuilder(backupFile);
            await interaction.editReply({ content: '', embeds: [embed], files: [attachment] });
        } else {
            embed.addFields({
                name: 'Download',
                value: `⚠️ Arquivo muito grande para o Discord. Salvo em \`${backupFile}\`.`
            });
            await interaction.editReply({ content: '', embeds: [embed] });
        }
    } else {
        const embed = new EmbedBuilder()
            .setTitle('❌ Falha no Backup')
            .setDescription(`Erro ao gerar backup de **${target}**:\n\`\`\`\n${errorMessage.substring(0, 500)}\n\`\`\``)
            .setColor('#ff0000')
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });
    }
}
