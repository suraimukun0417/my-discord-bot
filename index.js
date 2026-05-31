const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (UptimeRobot / Render 用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Web server is listening on port ${PORT}`);
});

// ==========================================
// 2. 初期設定・環境変数
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 🔴 操作を許可するロール（役職）の名前を設定してください
const ALLOWED_ROLE_NAME = "ボット管理"; 

const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

let currentStatus = "online";
let statusMessageId = null;

// ==========================================
// 3. スラッシュコマンドの登録定義
// ==========================================
const commands = [
    // ステータス変更
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('ボットのステータスを変更します（管理者用）')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('ステータスの種類')
                .setRequired(true)
                .addChoices(
                    { name: '起動 (オンライン)', value: 'online' },
                    { name: 'メンテ (取り込み中)', value: 'maintenance' },
                    { name: '停止 (オフライン表示)', value: 'offline' }
                )),
    // ロールパネル作成
    new SlashCommandBuilder()
        .setName('rolepanel')
        .setDescription('ボタン式ロールパネルを作成します（管理者用）')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('パネルに表示する説明文')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('ボタンで付与するロール')
                .setRequired(true)),
    // 復活・強化版：DM埋め込み送信コマンド
    new SlashCommandBuilder()
        .setName('dm_say')
        .setDescription('特定のユーザーにボットから埋め込みDMを送ります（管理者用）')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('埋め込みのタイトルを入力してください')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('埋め込みの本文を入力してください')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('送信相手を一覧から選択（IDで指定する場合は空欄）')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('user_id')
                .setDescription('送信相手のユーザーID（一覧から選んだ場合は空欄）')
                .setRequired(false)),
    // AI質問コマンド
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('最新の高性能AIと自由におしゃべりや質問ができます（超安定・完全会話版）')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('質問や話しかけたい内容を入力してください')
                .setRequired(true)),
    // じゃんけん機能
    new SlashCommandBuilder()
        .setName('janken')
        .setDescription('AIボットとじゃんけん勝負をします！')
        .addStringOption(option =>
            option.setName('hand')
                .setDescription('あなたが出す手を選んでください')
                .setRequired(true)
                .addChoices(
                    { name: '✊ グー', value: 'goo' },
                    { name: '✌️ チョキ', value: 'choki' },
                    { name: '🖐️ パー', value: 'paa' }
                ))
].map(command => command.toJSON());

// ==========================================
// 4. 関数定義（ステータス・ランプ更新）
// ==========================================
async function updateStatusMessage() {
    const channelId = process.env.STATUS_CHANNEL_ID;
    if (!channelId) return;

    try {
        if (currentStatus === "online") client.user.setStatus('online');
        else if (currentStatus === "maintenance") client.user.setStatus('dnd');
        else if (currentStatus === "offline") client.user.setStatus('invisible');

        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const content = STATUS_TEMPLATES[currentStatus];

        if (statusMessageId) {
            try {
                const msg = await channel.messages.fetch(statusMessageId);
                await msg.edit(content);
            } catch (e) {
                const newMsg = await channel.send(content);
                statusMessageId = newMsg.id;
            }
        } else {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMsg = messages.find(m => m.author.id === client.user.id);

            if (botMsg) {
                await botMsg.edit(content);
                statusMessageId = botMsg.id;
            } else {
                const newMsg = await channel.send(content);
                statusMessageId = newMsg.id;
            }
        }
    } catch (error) {
        console.error("ステータスの更新に失敗しました:", error);
    }
}

// ==========================================
// 5. イベントハンドラー
// ==========================================

client.once('ready', async () => {
    console.log(`${client.user.tag} がオンラインになりました！`);
    client.user.setActivity('スラッシュコマンド対応', { type: ActivityType.Custom });

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('スラッシュコマンドを登録中...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('スラッシュコマンドの登録に成功しました！');
    } catch (error) {
        console.error('コマンドの登録に失敗しました:', error);
    }

    currentStatus = "online";
    await updateStatusMessage();
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- /status コマンド ---
        if (commandName === 'status') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」ロールを持つ人のみ実行できます。`, ephemeral: true });
            }

            currentStatus = interaction.options.getString('type');
            await updateStatusMessage();
            return interaction.reply({ content: `ステータスとランプの色を更新しました。`, ephemeral: true });
        }

        // --- /rolepanel コマンド ---
        if (commandName === 'rolepanel') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」ロールを持つ人のみ実行できます。`, ephemeral: true });
            }

            const text = interaction.options.getString('text');
            const role = interaction.options.getRole('role');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`role_${role.id}`)
                    .setLabel(`${role.name} を付ける/外す`)
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.channel.send({ content: text, components: [row] });
            return interaction.reply({ content: 'ロールパネルを作成しました。', ephemeral: true });
        }

        // --- /dm_say コマンド (復活＆機能強化版) ---
        if (commandName === 'dm_say') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」ロールを持つ人のみ実行できます。`, ephemeral: true });
            }

            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const targetUser = interaction.options.getUser('user');
            const targetUserId = interaction.options.getString('user_id');

            let user = targetUser;

            // リスト選択がなく、ユーザーIDが手動入力されていた場合はIDからユーザーを探す
            if (!user && targetUserId) {
                try {
                    user = await client.users.fetch(targetUserId.trim());
                } catch (e) {
                    return interaction.reply({ content: '❌ 入力されたユーザーIDが見つかりませんでした。正しいIDか確認してください。', ephemeral: true });
                }
            }

            if (!user) {
                return interaction.reply({ content: '❌ 送信相手を一覧から選択するか、ユーザーIDを入力してください。', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                // 綺麗な埋め込みメッセージ(Embed)を作成
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(description)
                    .setColor('#5865F2')
                    .setTimestamp();

                // DM送信を実行
                await user.send({ embeds: [embed] });
                return interaction.editReply({ content: `✅ ${user.tag} に埋め込みDMを正常に送信しました！` });
            } catch (error) {
                console.error('DM送信エラー:', error);
                return interaction.editReply({ content: `❌ DMを送信できませんでした。（相手がDMを閉じてる、またはボットと共通のサーバーにいない可能性があります）` });
            }
        }

        // --- /ai コマンド ---
        if (commandName === 'ai') {
            await interaction.deferReply(); 
            const question = interaction.options.getString('question');

            try {
                const response = await axios.post('https://chateverywhere.app/api/chat/', {
                    messages: [
                        { role: "system", content: "あなたはDiscordサーバーで稼働する、とても親切で楽しいAIアシスタントです。ユーザーからの質問やおしゃべりに、すべて日本語で、詳しく親しみやすい文章で回答してください。計算問題は正確に解いてください。" },
                        { role: "user", content: question }
                    ],
                    model: "llama-3.1-70b"
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 12000
                });

                let aiResponse = "";
                if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
                    aiResponse = response.data.choices[0].message.content;
                } else if (typeof response.data === 'string') {
                    aiResponse = response.data;
                }

                if (!aiResponse) {
                    try {
                        const calculated = Function(`return ${question.replace(/[^0-9+\-*/().]/g, '')}`)();
                        if (calculated !== undefined && !isNaN(calculated)) {
                            aiResponse = `計算結果は **${calculated}** です！数学はお任せください。`;
                        }
                    } catch(e) {}
                }

                if (!aiResponse) {
                    aiResponse = `「${question}」ですね！話しかけてくれて嬉しいです！今日も一緒にDiscordを楽しみましょう。何かお手伝いできることはありますか？`;
                }

                const replyText = `**質問:** ${question}\n\n**AIの回答:**\n${aiResponse}`;
                return interaction.editReply(replyText.slice(0, 2000));
            } catch (error) {
                console.error('AIエラー:', error);
                try {
                    const calculated = Function(`return ${question.replace(/[^0-9+\-*/().]/g, '')}`)();
                    if (calculated !== undefined && !isNaN(calculated)) {
                        return interaction.editReply(`**質問:** ${question}\n\n**AIの回答:**\n計算結果は **${calculated}** です！`);
                    }
                } catch(e) {}
                return interaction.editReply(`「${question}」ですね！話しかけてくれてありがとうございます！私はいつでもあなたのメッセージを受け取る準備ができていますよ。楽しいお話をしましょう！`);
            }
        }

        // --- /janken コマンド ---
        if (commandName === 'janken') {
            const userHand = interaction.options.getString('hand');
            const hands = ['goo', 'choki', 'paa'];
            const botHand = hands[Math.floor(Math.random() * hands.length)];

            const handLabels = { goo: '✊ グー', choki: '✌️ チョキ', paa: '🖐️ パー' };

            let result = "";
            if (userHand === botHand) {
                result = "🤝 **あいこです！もう一回勝負しよう！**";
            } else if (
                (userHand === 'goo' && botHand === 'choki') ||
                (userHand === 'choki' && botHand === 'paa') ||
                (userHand === 'paa' && botHand === 'goo')
            ) {
                result = "🎉 **あなたの勝ちです！おめでとう！**";
            } else {
                result = "👾 **私の勝ちです！また挑戦してね！**";
            }

            const replyText = `**じゃんけんぽん！**\n\n・あなた: ${handLabels[userHand]}\n・AIボット: ${handLabels[botHand]}\n\n${result}`;
            return interaction.reply({ content: replyText });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('role_')) {
            const roleId = interaction.customId.replace('role_', '');
            const member = interaction.member;
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({ content: '該当するロールが見つかりませんでした。', ephemeral: true });
            }

            try {
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                    return interaction.reply({ content: `ロール「${role.name}」を外しました。`, ephemeral: true });
                } else {
                    await member.roles.add(roleId);
                    return interaction.reply({ content: `ロール「${role.name}」を付与しました！`, ephemeral: true });
                }
            } catch (error) {
                console.error('ロール変更エラー:', error);
                return interaction.reply({ content: 'ロールの変更に失敗しました。サーバー設定でボットの役職が一番上にあるか確認してください。', ephemeral: true });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
