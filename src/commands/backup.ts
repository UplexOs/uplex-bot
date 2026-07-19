import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
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

    const dbUser = process.env.DB_USER || 'postgres';
    const dbName = process.env.DB_NAME || 'postgres'; // Mudado o fallback de database para postgres

    if (target === 'database' || target === 'postgres') {
        backupFile = path.join(backupDir, `db_backup_${dateStr}.sql`);

        // Verifica se é MySQL ou PostgreSQL detectando o comando instalado
        const hasPgDump = shell.exec('command -v pg_dump', { silent: true }).code === 0;
        const hasMysqlDump = shell.exec('command -v mysqldump', { silent: true }).code === 0;

        let result;
        if (hasPgDump) {
            result = shell.exec(`sudo -u ${dbUser} pg_dump ${dbName} > ${backupFile}`, { silent: true });
        } else if (hasMysqlDump) {
            const mysqlUser = process.env.DB_USER || 'root';
            const mysqlPass = process.env.DB_PASS ? `-p${process.env.DB_PASS}` : '';
            result = shell.exec(`mysqldump -u ${mysqlUser} ${mysqlPass} ${dbName} > ${backupFile}`, { silent: true });
        } else {
            result = { code: 1, stderr: "Nenhum banco de dados detectado (pg_dump ou mysqldump não instalados)" };
        }

        if (result.code === 0) {
            // Compress
            const gzipResult = shell.exec(`gzip ${backupFile}`, { silent: true });
            if (gzipResult.code === 0) {
                backupFile = `${backupFile}.gz`;
                success = true;
            } else {
                errorMessage = "Falha ao compactar o backup.";
            }
        } else {
            errorMessage = result.stderr || "Erro desconhecido ao rodar pg_dump";
        }
    } else {
        errorMessage = `Alvo '${target}' não é suportado para backup manual ainda.`;
    }

    if (success && fs.existsSync(backupFile)) {
        const stats = fs.statSync(backupFile);
        const sizeStr = formatBytes(stats.size);

        const embed = new EmbedBuilder()
            .setTitle('✅ Backup Concluído')
            .setDescription(`O backup de **${target}** foi realizado com sucesso.`)
            .addFields(
                { name: 'Arquivo', value: `\`${path.basename(backupFile)}\``, inline: true },
                { name: 'Tamanho', value: `\`${sizeStr}\``, inline: true }
            )
            .setColor('#00ff00')
            .setTimestamp();

        // Se for menor que 25MB (limite do Discord para usuários sem Nitro)
        if (stats.size < 25 * 1024 * 1024) {
            const attachment = new AttachmentBuilder(backupFile);
            await interaction.editReply({ content: '', embeds: [embed], files: [attachment] });
        } else {
            embed.addFields({
                name: 'Download',
                value: `⚠️ Arquivo muito grande para enviar pelo Discord. Salvo localmente em \`${backupFile}\`.`
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