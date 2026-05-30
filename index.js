const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

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

// AIの初期化
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
    // ステータス変更コマンド
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
    // ロールパネル作成コマンド
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
    // AI質問コマンド
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AI（Gemini）に質問をします')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('質問内容を入力してください')
                .setRequired(true))
].map(command => command.toJSON());

// ==========================================
// 4. 関数定義（ステータス更新）
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

// 起動時：コマンド登録と初期ステータス設定
client.once('ready', async () => {
    console.log(`${client.user.tag} がオンラインになりました！`);
    client.user.setActivity('スラッシュコマンド対応', { type: ActivityType.Custom });

    // スラッシュコマンドをDiscordに登録
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

// スラッシュコマンド & ボタン入力の処理
client.on('interactionCreate', async (interaction) => {
    // 1. スラッシュコマンドの処理
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
            return interaction.reply({ content: `ステータスを更新しました。`, ephemeral: true });
        }

        // --- /rolepanel コマンド ---
        if (commandName === 'rolepanel') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」ロールを持つ人のみ実行できます。`, ephemeral: true });
            }

            const text = interaction.options.getString('text');
            const role = interaction.options.getRole('role');

            // ロール付与・剥奪用のボタンを作成
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`role_${role.id}`)
                    .setLabel(`${role.name} を付ける/外す`)
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.channel.send({ content: text, components: [row] });
            return interaction.reply({ content: 'ロールパネルを作成しました。', ephemeral: true });
        }

        // --- /ai コマンド ---
        if (commandName === 'ai') {
            // アプリケーションが応答なしになるのを防ぐため、まず「考えています」状態にする
            await interaction.deferReply(); 

            const question = interaction.options.getString('question');

            try {
                // Gemini APIを呼び出して回答を生成
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: question,
                });

                // 回答を送信（長すぎる場合は2000文字で切る）
                const replyText = `**質問:** ${question}\n\n**AIの回答:**\n${response.text}`;
                return interaction.editReply(replyText.slice(0, 2000));
            } catch (error) {
                console.error('AIエラー:', error);
                return interaction.editReply('AIからの応答取得に失敗しました。時間をおいて再度お試しください。');
            }
        }
    }

    // 2. ロールパネルボタンの処理
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
                    // 既に持っていれば外す
                    await member.roles.remove(roleId);
                    return interaction.reply({ content: `ロール「${role.name}」を外しました。`, ephemeral: true });
                } else {
                    // 持っていなければ付与する
                    await member.roles.add(roleId);
                    return interaction.reply({ content: `ロール「${role.name}」を付与しました！`, ephemeral: true });
                }
            } catch (error) {
                console.error('ロール変更エラー:', error);
                return interaction.reply({ content: 'ロールの変更に失敗しました。ボットの権限（役職の順序）を確認してください。', ephemeral: true });
            }
        }
    }
});

// ボットのログイン
client.login(process.env.DISCORD_TOKEN);

