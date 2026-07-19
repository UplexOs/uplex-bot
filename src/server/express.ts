import express from 'express';
import shell from 'shelljs';
import crypto from 'crypto';
import { EmbedBuilder } from 'discord.js';

export function setupServer(discordChannel: any) {
    const app = express();
    app.use(express.json());

    const PORT = 4000;
    const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

    app.post('/webhook', (req, res) => {
        // Verificar assinatura (opcional, mas recomendado)
        if (GITHUB_SECRET) {
            const signature = req.headers['x-hub-signature-256'] as string;
            const hmac = crypto.createHmac('sha256', GITHUB_SECRET);
            const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

            if (!signature || signature !== digest) {
                return res.status(401).send('Assinatura inválida');
            }
        }

        const event = req.headers['x-github-event'];

        if (event === 'push') {
            const branch = req.body.ref;

            // Só executa se o push for na branch main/master
            if (branch === 'refs/heads/main' || branch === 'refs/heads/master') {
                const repoName = req.body.repository.name;
                const commitMsg = req.body.head_commit.message;
                const author = req.body.head_commit.author.name;

                res.status(200).send('Webhook recebido, iniciando deploy...');

                const embed = new EmbedBuilder()
                    .setTitle('🚀 Deploy Automático Iniciado')
                    .setDescription(`Repositório: **${repoName}**\nBranch: **${branch.split('/').pop()}**`)
                    .addFields(
                        { name: 'Commit', value: commitMsg || 'Sem mensagem' },
                        { name: 'Autor', value: author || 'Desconhecido' }
                    )
                    .setColor('#0099ff')
                    .setTimestamp();

                discordChannel.send({ embeds: [embed] });

                // Executar o script de deploy em background
                setTimeout(() => {
                    // Substitua o caminho abaixo pelo caminho real do seu script de deploy
                    // ou coloque os comandos diretos aqui. O ideal é ter um deploy.sh
                    const deployScriptPath = process.env.DEPLOY_SCRIPT_PATH || '/opt/deploy.sh';

                    const result = shell.exec(`bash ${deployScriptPath}`);

                    if (result.code === 0) {
                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Deploy Realizado com Sucesso')
                            .setColor('#00ff00')
                            .setTimestamp();
                        discordChannel.send({ embeds: [successEmbed] });
                    } else {
                        const errorEmbed = new EmbedBuilder()
                            .setTitle('❌ Falha no Deploy')
                            .setDescription(`\`\`\`\n${result.stderr.substring(0, 1000)}\n\`\`\``)
                            .setColor('#ff0000')
                            .setTimestamp();
                        discordChannel.send({ embeds: [errorEmbed] });
                    }
                }, 1000);
            } else {
                res.status(200).send('Ignorando branch não-main');
            }
        } else {
            res.status(200).send('Ignorando evento não-push');
        }
    });

    app.listen(PORT, () => {
        console.log(`🚀 Servidor CI/CD escutando na porta ${PORT}`);
    });
}
