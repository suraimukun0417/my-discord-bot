const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');
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
// 2. 初期設定・環境変数・試験管理用データ
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: ['Channel']
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

// 試験の進行状態を一時的に記憶するオブジェクト (ユーザーIDをキーにする)
const activeExams = new Map();

// 試験問題のデータ定義
const EXAM_DATA = {
    moderator: {
        name: '🛡️ モデレーター試験',
        color: '#3498DB',
        q1: '【問題1（選択問題）】\nサーバー内で荒らしを発見した場合の対応として最も適切なものを記号で答えてください。\nA: 即座に独断でBANする\nB: 警告を一度行い、収まらない場合はミュートやBANを検討する\nC: 関わると危険なので無視して放置する',
        q2: '【問題2（記述問題）】\nユーザー間で激しい喧嘩や口論が起きてしまった時、あなたならモデレーターとしてどのように仲裁に入りますか？対応方針を具体的に教えてください。'
    },
    admin: {
        name: '👑 管理者試験',
        color: '#E74C3C',
        q1: '【問題1（選択問題）】\nサーバー内のメインボットに不具合が起き、勝手に動かなくなった際の優先手順として適切なものを記号で答えてください。\nA: すぐにボットの役職や権限をサーバーからすべて剥奪する\nB: 開発ログやステータスを確認し、必要に応じて再起動を試みる\nC: 直らないと面倒なのでボットごとサーバーから削除する',
        q2: '【問題2（記述問題）】\nサーバーを今よりもっと活発で魅力的にするために、あなたが管理者になったら実施したい新しいイベントや企画、改善案などを自由に記述してください。'
    }
};

// ==========================================
// 3. スラッシュコマンドの登録定義
// ==========================================
const commands = [
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
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('最新の高性能AIと自由におしゃべりや質問ができます（超安定・完全会話版）')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('質問や話しかけたい内容を入力してください')
                .setRequired(true)),
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
                )),
    new SlashCommandBuilder()
        .setName('exam')
        .setDescription('モデレーター・管理者への配属試験を開始します（問題はDMに届きます）')
].map(command => command.toJSON());

// ==========================================
// 4. 関数定義
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
            try { const msg = await channel.messages.fetch(statusMessageId); await msg.edit(content); } catch (e) { const newMsg = await channel.send(content); statusMessageId = newMsg.id; }
        } else {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMsg = messages.find(m => m.author.id === client.user.id);
            if (botMsg) { await botMsg.edit(content); statusMessageId = botMsg.id; } else { const newMsg = await channel.send(content); statusMessageId = newMsg.id; }
        }
    } catch (error) { console.error("ステータスの更新に失敗しました:", error); }
}

async function sendToLogChannel(embed) {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;
    try { const logChannel = await client.channels.fetch(logChannelId); if (logChannel) await logChannel.send({ embeds: [embed] }); } catch (error) {}
}

// ==========================================
// 5. イベントハンドラー
// ==========================================

client.once('ready', async () => {
    console.log(`${client.user.tag} がオンラインになりました！`);
    client.user.setActivity('スラッシュコマンド対応', { type: ActivityType.Custom });
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('スラッシュコマンドの登録に成功しました！');
    } catch (error) { console.error(error); }
    currentStatus = "online";
    await updateStatusMessage();
});

// DMメッセージ受信イベント（試験回答の回収 ＆ 通常DMログ）
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM) return;

    const userId = message.author.id;

    // ユーザーが現在、試験の回答途中であるかチェック
    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];

        if (examState.step === 1) {
            // 問題1の回答を記憶
            examState.ans1 = message.content;
            examState.step = 2;
            activeExams.set(userId, examState);

            // 問題2をDMに送信
            const q2Embed = new EmbedBuilder()
                .setTitle(`${examInfo.name} - 第2問`)
                .setDescription(`${examInfo.q2}\n\n*※このメッセージにそのまま記述して送信（返信）してください。*`)
                .setColor(examInfo.color);
            return await message.channel.send({ embeds: [q2Embed] });

        } else if (examState.step === 2) {
            // 問題2の回答を記憶
            examState.ans2 = message.content;
            
            // 試験状態をクリアして、採点処理へ
            activeExams.delete(userId);

            await message.channel.send('⏳ **お疲れ様でした！回答を受領しました。現在AIが適正度を一次判定中です。しばらくお待ちください...**');

            // 🧠 AIによる回答の自動審査
            let aiEvaluation = "AI評価の生成に失敗しました。";
            try {
                const prompt = `あなたはDiscordサーバーの最高人事責任者AIです。ユーザーから送られてきた「${examInfo.name}」の回答を厳しく審査し、運営陣向けに評価を出してください。\n\n【問題1: 選択形式】\nユーザーの回答: ${examState.ans1}\n\n【問題2: 記述形式】\nユーザーの回答: ${examState.ans2}\n\n上記を確認し、100点満点中何点か(採点)、およびモデレーターや管理者としての適正があるかどうかの寸評を、150文字以内の日本語で出力してください。`;
                const response = await axios.post('https://chateverywhere.app/api/chat/', {
                    messages: [{ role: "user", content: prompt }],
                    model: "llama-3.1-70b"
                }, { timeout: 12000 });
                
                if (response.data?.choices?.[0]?.message?.content) {
                    aiEvaluation = response.data.choices[0].message.content;
                }
            } catch (error) {
                aiEvaluation = "⚠️ AIサーバー混雑のため自動採点がスキップされました。運営陣による手動での最終判断をお願いします。";
            }

            // 📝 指定された試験ログチャンネルへ結果を送信
            const examChannelId = process.env.EXAM_CHANNEL_ID;
            if (examChannelId) {
                try {
                    const examChannel = await client.channels.fetch(examChannelId);
                    if (examChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle(`📝 試験答案受領: ${examInfo.name}`)
                            .setColor(examInfo.color)
                            .addFields(
                                { name: '👤 受験者', value: `${message.author.tag} (${message.author.id})`, inline: false },
                                { name: '📥 問題1への回答', value: examState.ans1, inline: false },
                                { name: '📥 問題2への回答', value: examState.ans2, inline: false },
                                { name: '🤖 AI一次審査 (適正判定)', value: aiEvaluation, inline: false },
                                { name: '👥 人間(運営)による手動最終判定', value: '上のAI評価を参考にして、役職を付与するかどうか手動で最終決定してください。', inline: false }
                            )
                            .setTimestamp();
                        await examChannel.send({ embeds: [embed] });
                    }
                } catch (e) {
                    console.error("試験チャンネルへの送信に失敗しました:", e);
                }
            }

            return await message.channel.send('🎉 **すべての回答が正常に運営陣へと送信されました！最終判断が出るまで今しばらくお待ちください。ありがとうございました！**');
        }
    }

    // 試験中ではない通常のDM受信は、通常通り管理ログチャンネルへ転送
    const logEmbed = new EmbedBuilder()
        .setTitle('📩 ユーザーからのDM受信')
        .setDescription(message.content || '*(テキストなし)*')
        .setColor('#FF9900')
        .addFields({ name: '送信ユーザー', value: `${message.author.tag} (${message.author.id})` })
        .setTimestamp();
    await sendToLogChannel(logEmbed);
});

client.on('interactionCreate', async (interaction) => {
    
    // スラッシュコマンドの処理
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'status') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」役職が必要です。`, ephemeral: true });
            currentStatus = interaction.options.getString('type');
            await updateStatusMessage();
            return interaction.reply({ content: `ステータスを更新しました。`, ephemeral: true });
        }

        if (commandName === 'rolepanel') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) return interaction.reply({ content: `⚠️ 権限がありません。`, ephemeral: true });
            const text = interaction.options.getString('text');
            const role = interaction.options.getRole('role');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role_${role.id}`).setLabel(`${role.name} を付ける/外す`).setStyle(ButtonStyle.Primary));
            await interaction.channel.send({ content: text, components: [row] });
            return interaction.reply({ content: 'ロールパネルを作成しました。', ephemeral: true });
        }

        if (commandName === 'dm_say') {
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) return interaction.reply({ content: `⚠️ 権限がありません。`, ephemeral: true });
            const title = interaction.options.getString('title');
            const description = interaction.options.getString('description');
            const targetUser = interaction.options.getUser('user');
            const targetUserId = interaction.options.getString('user_id');
            let user = targetUser;
            if (!user && targetUserId) { try { user = await client.users.fetch(targetUserId.trim()); } catch (e) { return interaction.reply({ content: '❌ ユーザーIDが見つかりません。', ephemeral: true }); } }
            if (!user) return interaction.reply({ content: '❌ 送信相手を指定してください。', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            try {
                const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#5865F2').setTimestamp();
                await user.send({ embeds: [embed] });
                const logEmbed = new EmbedBuilder().setTitle('📤 ボットからのDM送信ログ').setColor('#5865F2').addFields({ name: '宛先', value: `${user.tag}` }, { name: '本文', value: description }).setTimestamp();
                await sendToLogChannel(logEmbed);
                return interaction.editReply({ content: `✅ DMを送信しました。` });
            } catch (error) { return interaction.editReply({ content: `❌ 送信失敗。` }); }
        }

        if (commandName === 'ai') {
            await interaction.deferReply();
            const question = interaction.options.getString('question');
            try {
                const response = await axios.post('https://chateverywhere.app/api/chat/', {
                    messages: [{ role: "system", content: "親切なアシスタント。日本語で回答。" }, { role: "user", content: question }],
                    model: "llama-3.1-70b"
                }, { timeout: 12000 });
                let aiResponse = response.data?.choices?.[0]?.message?.content || "回答を取得できませんでした。";
                const replyText = `**質問:** ${question}\n\n**AI:** ${aiResponse}`;
                return interaction.editReply(replyText.slice(0, 2000));
            } catch (error) { return interaction.editReply("AIが応答できませんでした。"); }
        }

        if (commandName === 'janken') {
            const userHand = interaction.options.getString('hand');
            const hands = ['goo', 'choki', 'paa'];
            const botHand = hands[Math.floor(Math.random() * hands.length)];
            const handLabels = { goo: '✊ グー', choki: '✌️ チョキ', paa: '🖐️ パー' };
            let result = userHand === botHand ? "🤝 あいこ！" : ((userHand==='goo'&&botHand==='choki')||(userHand==='choki'&&botHand==='paa')||(userHand==='paa'&&botHand==='goo')) ? "🎉 あなたの勝ち！" : "👾 ボットの勝ち！";
            return interaction.reply({ content: `あなた: ${handLabels[userHand]}\nボット: ${handLabels[botHand]}\n\n${result}` });
        }

        // --- /exam コマンド ---
        if (commandName === 'exam') {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_exam_type')
                    .setPlaceholder('希望する配属先を選択してください')
                    .addOptions([
                        { label: '🛡️ モデレーター試験', description: '荒らし対応やルール維持を行う役職', value: 'moderator' },
                        { label: '👑 管理者試験', description: 'サーバー設定や運営全般を統括する役職', value: 'admin' }
                    ])
            );
            return interaction.reply({ content: '📝 **配属試験を開始します。** 希望する役職を以下から選択してください。選択するとボットからDMで問題が送られます：', components: [row], ephemeral: true });
        }
    }

    // セレクトメニュー（試験種類の選択）
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_exam_type') {
            const examType = interaction.values[0];
            const userId = interaction.user.id;
            const examInfo = EXAM_DATA[examType];

            try {
                // ユーザーの進行状況をリセットして初期化 (ステップ1: 問題1)
                activeExams.set(userId, { type: examType, step: 1, ans1: '', ans2: '' });

                // 第1問目を埋め込みにしてユーザーの「DM」へ直接送信
                const q1Embed = new EmbedBuilder()
                    .setTitle(`📝 ${examInfo.name} が開始されました！`)
                    .setDescription(`これより配属試験を行います。ボットからの質問に順番にお答えください。\n\n${examInfo.q1}\n\n*※このメッセージにそのまま記号（A, B, Cなど）を入力して送信（返信）してください。*`)
                    .setColor(examInfo.color)
                    .setTimestamp();

                await interaction.user.send({ embeds: [q1Embed] });

                // サーバー画面側には案内を表示
                return await interaction.reply({ content: `✅ あなたのDMに「${examInfo.name}」の第1問目を送信しました！確認して回答を入力してください。`, ephemeral: true });
            } catch (error) {
                console.error("DM送信エラー:", error);
                activeExams.delete(userId);
                return await interaction.reply({ content: `❌ あなたにDMを送信できませんでした。Discordの設定で「サーバーからのダイレクトメッセージを許可する」がオンになっているか確認してください。`, ephemeral: true });
            }
        }
    }

    // ロールパネルボタンの処理
    if (interaction.isButton() && interaction.customId.startsWith('role_')) {
        const roleId = interaction.customId.replace('role_', '');
        const member = interaction.member;
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return interaction.reply({ content: 'ロールが見つかりません。', ephemeral: true });
        try {
            if (member.roles.cache.has(roleId)) { await member.roles.remove(roleId); return interaction.reply({ content: `ロール「${role.name}」を外しました。`, ephemeral: true }); }
            else { await member.roles.add(roleId); return interaction.reply({ content: `ロール「${role.name}」を付与しました！`, ephemeral: true }); }
        } catch (error) { return interaction.reply({ content: '変更失敗。', ephemeral: true }); }
    }
});

client.login(process.env.DISCORD_TOKEN);
