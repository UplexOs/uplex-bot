import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Mostra o uso de CPU, RAM, Disco e uptime da VPS.'),
    new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Painel de Controle interativo com botões para reiniciar serviços e limpar a VPS.'),
    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Faz o backup de um banco de dados e tenta enviá-lo pelo Discord.')
        .addStringOption(option =>
            option.setName('target')
                .setDescription('O banco de dados a realizar backup (ex: database)')
                .setRequired(true)
                .addChoices(
                    { name: 'PostgreSQL', value: 'database' }
                )
        )
].map(command => command.toJSON());

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
    console.error('❌ DISCORD_BOT_TOKEN ou DISCORD_CLIENT_ID não configurados no .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`⏳ Começando a atualizar ${commands.length} comandos de barra (/) globais.`);

        const data = await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log(`✅ ${(data as any).length} comandos atualizados com sucesso.`);
    } catch (error) {
        console.error('❌ Erro ao atualizar comandos:', error);
    }
})();
