import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import shell from 'shelljs';
import fs from 'fs';
import path from 'path';
import { format } from 'date-fns';
import { filesize } from 'filesize';

export async function handleBackupCommand(interaction: any) {
    await interaction.deferReply();

    const target = interaction.options?.getString('target') || 'database';

    await interaction.editReply(`🔄 Iniciando backup de **${target}**...`);

    const dateStr = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const backupDir = path.join(process.cwd(), 'backups');

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    let backupFile = '';
    let success = false;
    let errorMessage = '';

    const dbUser = process.env.DB_USER || 'postgres';
    const dbName = process.env.DB_NAME || 'database';

    if (target === 'database' || target === 'postgres') {
        backupFile = path.join(backupDir, `db_backup_${dateStr}.sql`);
        const result = shell.exec(`sudo -u ${dbUser} pg_dump ${dbName} > ${backupFile}`, { silent: true });

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
        const sizeStr = filesize(stats.size, {standard: "jedec"}) as string;

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