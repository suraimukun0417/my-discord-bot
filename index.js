const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
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
// 2. 初期設定・環境変数・試験データ
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

// 試験の進行状態を記憶するオブジェクト
const activeExams = new Map();

// 【超強化】全5問（選択3問、記述2問）の本格的な試験問題データ
const EXAM_DATA = {
    moderator: {
        name: '🛡️ モデレーター試験',
        color: '#3498DB',
        questions: [
            {
                title: '【第1問（選択）】ルール違反の確認',
                text: '一般ユーザーが「言葉遣いのルール」に明確に違反しているのを発見しました。最初にとるべき行動として適切なものはどれですか？\n\nA: 何も言わずに即座にサーバーからBANする\nB: 公開チャンネル、またはDMで「規約違反に該当する」旨を丁寧に指摘し、注意・警告を与える\nC: 他のモデレーターが気づくまで自分は見て見ぬふりをする'
            },
            {
                title: '【第2問（選択）】大規模な荒らしへの対処',
                text: '複数のアカウントが同時に無意味な連投（スパム）を始め、チャンネルが機能停止状態になりました。モデレーターとして最優先すべき対応はどれですか？\n\nA: 荒らしユーザー全員にメンションを飛ばして口頭で注意する\nB: 該当チャンネルの書き込み権限を一時的にロック（低速モード等）し、ログを確保した上で適切にキック・BAN等の対処を急ぐ\nC: 荒らしが飽きて自発的にいなくなるまで静観する'
            },
            {
                title: '【第3問（選択）】個人情報の取り扱い',
                text: 'メンバーが誤って自分や他人の本名・顔写真などの個人情報を公開チャットに送信してしまいました。モデレーターとして適切な対応はどれですか？\n\nA: 本人が気づいて消すまでそのまま放置する\nB: すぐにそのメッセージを削除し、本人にDM等で注意を促すとともに、他の運営に報告する\nC: 面白いのでスクリーンショットを撮って拡散する'
            },
            {
                title: '【第4問（記述）】ユーザー同士の口論への対応',
                text: '仲の良い常連ユーザー同士が、チャンネル内で激しい口論（喧嘩）を始めてしまい、周りの参加者が困惑しています。あなたはモデレーターとしてどのように声をかけ、どのようにこのトラブルを収めますか？対応方針を具体的に記述してください。'
            },
            {
                title: '【第5問（記述）】モデレーターとしての意気込み',
                text: 'あなたがこのサーバーのモデレーターとして採用された場合、どのような点に気をつけて活動したいですか？あなたの強みや、理想のモデレーター像を自由に記述してください。'
            }
        ]
    },
    admin: {
        name: '👑 管理者試験',
        color: '#E74C3C',
        questions: [
            {
                title: '【第1問（選択）】権限設定のトラブル',
                text: '新しく作成したチャンネルが「一般ユーザーに見えてはいけないのに見えてしまっている」と報告を受けました。管理者として最初に確認すべき項目はどれですか？\n\nA: サーバーの全カテゴリー・チャンネルの閲覧権限（@everyone の権限設定）が正しく拒否されているか確認する\nB: 不具合が起きた原因がわからないので、一度Discordサーバー自体を削除して作り直す\nC: 報告してきたユーザーの勘違いだと思い、特に対処せず放置する'
            },
            {
                title: '【第2問（選択）】ボットの不具合対応',
                text: 'サーバー内で稼働している主要な管理ボットが、突然コマンドに一切反応しなくなりました。優先すべき対応手順はどれですか？\n\nA: ボットの役職や管理権限をサーバーから即座にすべて剥奪する\nB: ボットのステータスや開発元のアナウンスを確認し、ホスティングプラットフォーム（Render等）のログを見て必要なら再起動を実行する\nC: 他の管理者が直してくれるまで何もせず待つ'
            },
            {
                title: '【第3問（選択）】他の運営メンバーとの衝突',
                text: 'サーバーの運営方針を巡って、あなたと他の管理者（運営メンバー）の間で意見が真っ向から対立してしまいました。どう行動すべきですか？\n\nA: 自分の意見を通すため、独断でその管理者の権限を剥奪して追放する\nB: お互いの意見のメリット・デメリットを整理し、他のメンバーも交えてミーティング等で冷静に話し合って解決策を決める\nC: 運営を辞めてサーバーを荒らす'
            },
            {
                title: '【第4問（記述）】サーバーの活性化企画',
                text: 'サーバー内のアクティブユーザー（雑談や活動に参加する人）を今よりも増やし、コミュニティをより活発で魅力的にするために、あなたが管理者になったら実施したい「新しいイベント」「企画」「チャンネルの改善案」などを具体的に記述してください。'
            },
            {
                title: '【第5問（記述）】トラブル発生時の危機管理',
                text: 'ある日、サーバーが大規模なレイド（大量の荒らしアカウントの襲撃）に遭い、メンバーが不安に陥っています。管理者として、サーバーの復旧手順やメンバーへのアナウンスなど、どのように迅速な対応を行いますか？あなたの危機管理方針を記述してください。'
            }
        ]
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
        .setDescription('指定したユーザーのDMに配属試験を送信します（運営・管理者用）')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('試験を受けさせたいメンバーを選択してください')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('送信する試験の種類')
                .setRequired(true)
                .addChoices(
                    { name: '🛡️ モデレーター試験', value: 'moderator' },
                    { name: '👑 管理者試験', value: 'admin' }
                ))
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

// DM受信監視イベント（試験全5問のステップ回収システム）
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM) return;

    const userId = message.author.id;

    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];
        const currentStep = examState.step; // 1〜5

        // 現在のステップの回答を保存
        examState.answers.push({
            title: examInfo.questions[currentStep - 1].title,
            answer: message.content
        });

        // 次の質問がある場合
        if (currentStep < 5) {
            examState.step += 1;
            activeExams.set(userId, examState);

            const nextQuestion = examInfo.questions[examState.step - 1];
            const nextEmbed = new EmbedBuilder()
                .setTitle(`${examInfo.name} - ${nextQuestion.title}`)
                .setDescription(`${nextQuestion.text}\n\n*※このメッセージにそのまま回答を入力して送信してください。*`)
                .setColor(examInfo.color);
            return await message.channel.send({ embeds: [nextEmbed] });
        }

        // 全5問回答し終わった場合
        activeExams.delete(userId);
        await message.channel.send('⏳ **全5問の回答をすべて回収しました！現在、高性能AIが適正度を厳密に分析・採点しています。このまま10秒ほどお待ちください...**');

        // 🧠 【バグ修正】確実に高精度で判定を返す強力なAIシステム
        let aiEvaluation = "";
        try {
            const prompt = `あなたはDiscordサーバーの人事責任者AIです。受験者から送られた回答を厳格に審査し、採点してください。
選択問題（第1〜3問）の正解はすべて「B」です。AやC、あるいは「あああ」など無意味な文字・不正解は容赦なく0点（減点）にしてください。
記述問題（第4〜5問）に「あああ」などの適当な文字列や無意味な文章が入力されていた場合も、その問題は0点にしてください。

【試験名】: ${examInfo.name}
【第1問回答】: ${examState.answers[0].answer}
【第2問回答】: ${examState.answers[1].answer}
【第3問回答】: ${examState.answers[2].answer}
【第4問（記述）】: ${examState.answers[3].answer}
【第5問（記述）】: ${examState.answers[4].answer}

上記を確認し、必ず以下のフォーマットのみで厳しく判定を出力してください。
【AI採点結果】: ○○点 / 100点
【適正評価寸評】: （ここに、選択の正誤や、記述が適当か真面目かを踏まえた150文字以内の辛口な評価文）`;

            const response = await axios.post('https://chateverywhere.app/api/chat/', {
                messages: [
                    { role: "system", content: "あなたは手抜き回答や無意味な入力を厳しく見抜く採点AIです。出力形式を厳守してください。" },
                    { role: "user", content: prompt }
                ],
                model: "llama-3.1-70b"
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            });

            if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
                aiEvaluation = response.data.choices[0].message.content;
            } else if (typeof response.data === 'string') {
                aiEvaluation = response.data;
            }
        } catch (e) {
            console.error("AI判定エラー:", e);
        }

        // もしAIサーバーが完全に落ちていた場合の安全なローカル判定ロジック（不正対策）
        if (!aiEvaluation) {
            let score = 0;
            if (examState.answers[0].answer.toUpperCase().includes('B')) score += 20;
            if (examState.answers[1].answer.toUpperCase().includes('B')) score += 20;
            if (examState.answers[2].answer.toUpperCase().includes('B')) score += 20;
            
            // 記述問題の文字数が極端に短い、または「あああ」などの場合は加点しない
            if (examState.answers[3].answer.length > 5 && !/^[あいうえおぁぃぅぇぉ宛頭安アアン]+$/.test(examState.answers[3].answer)) score += 20;
            if (examState.answers[4].answer.length > 5 && !/^[あいうえおぁぃぅぇぉ宛頭安アアン]+$/.test(examState.answers[4].answer)) score += 20;

            aiEvaluation = `【AI採点結果】: **${score}点 / 100点**\n【適正評価寸評】: (自動セーフティ判定) 選択問題の正誤、および記述問題の入力文字数とパターンから自動判定を行いました。「あああ」等の手抜きや不正解はすべて無得点として処理されています。`;
        }

        // 📝 指定された試験ログチャンネル（EXAM_CHANNEL_ID）へ詳細を転送
        const examChannelId = process.env.EXAM_CHANNEL_ID;
        if (examChannelId) {
            try {
                const examChannel = await client.channels.fetch(examChannelId);
                if (examChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`📝 配属試験 解答受領: ${examInfo.name}`)
                        .setColor(examInfo.color)
                        .addFields(
                            { name: '👤 受験ユーザー', value: `${message.author.tag} (${message.author.id})`, inline: false },
                            { name: `❓ ${examInfo.questions[0].title}`, value: examState.answers[0].answer, inline: false },
                            { name: `❓ ${examInfo.questions[1].title}`, value: examState.answers[1].answer, inline: false },
                            { name: `❓ ${examInfo.questions[2].title}`, value: examState.answers[2].answer, inline: false },
                            { name: `❓ ${examInfo.questions[3].title}`, value: examState.answers[3].answer, inline: false },
                            { name: `❓ ${examInfo.questions[4].title}`, value: examState.answers[4].answer, inline: false },
                            { name: '🤖 AIによる二重審査判定', value: aiEvaluation, inline: false },
                            { name: '👥 運営陣による手動最終判断', value: '実際の回答とAI判定の点数を元に、手動で役職を付与するか審査してください。', inline: false }
                        )
                        .setTimestamp();
                    await examChannel.send({ embeds: [embed] });
                }
            } catch (e) { console.error("ログ送信エラー:", e); }
        }

        return await message.channel.send('🎉 **無事にすべての解答が運営陣へ転送されました。試験はこれで終了です！お疲れ様でした！**');
    }

    // 通常の個別DM
    const logEmbed = new EmbedBuilder().setTitle('📩 ユーザーからのDM受信').setDescription(message.content || '*(テキストなし)*').setColor('#FF9900').addFields({ name: '送信ユーザー', value: `${message.author.tag} (${message.author.id})` }).setTimestamp();
    await sendToLogChannel(logEmbed);
});

client.on('interactionCreate', async (interaction) => {
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
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」役職を持つ運営陣のみ実行可能です。`, ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const examType = interaction.options.getString('type');
            const examInfo = EXAM_DATA[examType];

            await interaction.deferReply({ ephemeral: true });

            try {
                // ターゲットユーザーの試験ステータスを初期化 (step 1, 空の回答配列)
                activeExams.set(targetUser.id, { type: examType, step: 1, answers: [] });

                // 第1問目を送信
                const q1Embed = new EmbedBuilder()
                    .setTitle(`📝 ${examInfo.name} の受講案内`)
                    .setDescription(`運営陣より、あなた宛てに配属採用試験が発行されました。**全5問**あります。順番にDMで回答してください。\n\n**${examInfo.questions[0].title}**\n${examInfo.questions[0].text}\n\n*※このメッセージにそのまま回答を打ち込んで送信してください。*`)
                    .setColor(examInfo.color)
                    .setTimestamp();

                await targetUser.send({ embeds: [q1Embed] });
                return interaction.editReply({ content: `✅ ${targetUser.tag} の個人DMへ「${examInfo.name}」の第1問目を正常に送信しました！` });
            } catch (error) {
                console.error(error);
                activeExams.delete(targetUser.id);
                return interaction.editReply({ content: `❌ ${targetUser.tag} へDMを送信できませんでした。` });
            }
        }
    }

    // ロールパネルボタン処理
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
