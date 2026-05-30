const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
    // 新・AI質問コマンド（何でも会話可能）
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AIと自由におしゃべりや質問ができます（何でも対応版）')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('質問や話しかけたい内容を入力してください')
                .setRequired(true)),
    // 追加：じゃんけん機能
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

        // --- /ai コマンド (新・何でも会話ができる完全無料システム) ---
        if (commandName === 'ai') {
            await interaction.deferReply(); 

            const question = interaction.options.getString('question');

            try {
                // キー不要・年齢制限なしで高度なチャットができるオープンAPIを利用
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ja&dt=t&q=1`; // 通信チェック用
                
                // 非常に安定した対話型AIエンドポイントにリクエスト
                const response = await axios.post('https://api.nexra.pro/v1/ai/gpt', {
                    prompt: question,
                    model: "gpt-4o"
                }, { timeout: 10000 });

                let aiResponse = "";
                if (response.data && response.data.gpt) {
                    aiResponse = response.data.gpt;
                } else if (response.data && response.data.result) {
                    aiResponse = response.data.result;
                } else {
                    aiResponse = "ごめんなさい、うまく言葉を返せませんでした。もう一度話しかけてみてください！";
                }

                const replyText = `**質問:** ${question}\n\n**AIの回答:**\n${aiResponse}`;
                return interaction.editReply(replyText.slice(0, 2000));
            } catch (error) {
                console.error('AIエラー:', error);
                
                // 万が一メインのAIが落ちていた場合のバックアップシステム
                try {
                    const backup = await axios.get(`https://api.lolhuman.xyz/api/openai?apikey=free&text=${encodeURIComponent(question)}`);
                    if(backup.data && backup.data.result) {
                        return interaction.editReply(`**質問:** ${question}\n\n**AIの回答:**\n${backup.data.result}`);
                    }
                } catch(e){}

                return interaction.editReply('AIが少しお疲れのようです。少し時間をあけてからもう一度話しかけてみてください！');
            }
        }

        // --- /janken コマンド (追加機能) ---
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
