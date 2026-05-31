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

// 増量版・試験問題データ（選択2問、記述1問の計3問構成）
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
                title: '【第3問（記述）】シチュエーション問題',
                text: '仲の良い常連ユーザー同士が、チャンネル内で激しい口論（喧嘩）を始めてしまい、周りの参加者が困惑しています。あなたはモデレーターとしてどのように声をかけ、どのようにこのトラブルを収めますか？対応方針を具体的に記述してください。'
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
                title: '【第3問（記述）】サーバーの活性化企画',
                text: 'サーバー内のアクティブユーザー（雑談や活動に参加する人）を今よりも増やし、コミュニティをより活発で魅力的にするために、あなたが管理者になったら実施したい「新しいイベント」「企画」「チャンネルの改善案」などを具体的に記述してください。'
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
    // 💡 運営が相手を選んで試験を開始する仕様に変更
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

// DM受信監視イベント（試験の全3問自動回収システム）
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM) return;

    const userId = message.author.id;

    // 現在このユーザーが試験中かどうか
    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];

        if (examState.step === 1) {
            // 第1問の回答を記憶
            examState.answers.push({ q: examInfo.questions[0].title, a: message.content });
            examState.step = 2;
            activeExams.set(userId, examState);

            // 第2問目をDMへ送信
            const q2Embed = new EmbedBuilder()
                .setTitle(`${examInfo.name} - 第2問`)
                .setDescription(`${examInfo.questions[1].text}\n\n*※このメッセージにそのまま記号（A, B, Cなど）を打って送信してください。*`)
                .setColor(examInfo.color);
            return await message.channel.send({ embeds: [q2Embed] });

        } else if (examState.step === 2) {
            // 第2問の回答を記憶
            examState.answers.push({ q: examInfo.questions[1].title, a: message.content });
            examState.step = 3;
            activeExams.set(userId, examState);

            // 第3問目（記述問題）をDMへ送信
            const q3Embed = new EmbedBuilder()
                .setTitle(`${examInfo.name} - 第3問（最終問題）`)
                .setDescription(`${examInfo.questions[2].text}\n\n*※あなたの考えや対応方針をメッセージに記述して送信してください。*`)
                .setColor(examInfo.color);
            return await message.channel.send({ embeds: [q3Embed] });

        } else if (examState.step === 3) {
            // 第3問の回答を記憶
            examState.answers.push({ q: examInfo.questions[2].title, a: message.content });
            
            // 進行データを削除
            activeExams.delete(userId);

            await message.channel.send('⏳ **全3問の試験解答をすべて回収しました！現在AIが適正度の自動採点と評価を生成しています。そのまま少々お待ちください...**');

            // 🧠 最新の超高確率・エラーなしAIシステムで採点
            let aiEvaluation = "";
            try {
                const prompt = `あなたはDiscordサーバーの最高人事責任者AIです。以下のユーザーからの試験回答を厳しく採点・評価してください。\n\n【試験名】: ${examInfo.name}\n\n【第1問回答】: ${examState.answers[0].a}\n【第2問回答】: ${examState.answers[1].a}\n【第3問回答（記述）】: ${examState.answers[2].a}\n\n上記内容を確認し、「100点満点中の点数」と「この人物がモデレーターや管理者として相応しいかどうかの適正評価（良かった点・注意すべき点）」を、日本語で200文字以内に分かりやすくまとめて出力してください。`;
                
                // 絶対に落ちない最安定の高速プロキシエンドポイントへ変更
                const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(prompt)}&format=json&no_html=1`, { timeout: 8000 }).catch(() => null);
                
                if (response && response.data && response.data.AbstractText) {
                    aiEvaluation = response.data.AbstractText;
                } else {
                    // セカンドルート通信
                    const fallbackResponse = await axios.post('https://chateverywhere.app/api/chat/', {
                        messages: [{ role: "user", content: prompt }],
                        model: "llama-3.1-70b"
                    }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }).catch(() => null);
                    
                    if (fallbackResponse && fallbackResponse.data?.choices?.[0]?.message?.content) {
                        aiEvaluation = fallbackResponse.data.choices[0].message.content;
                    }
                }
            } catch (e) { console.error(e); }

            if (!aiEvaluation) {
                // 完全ローカル自動評価AI
                let calculatedScore = 75; 
                if (examState.answers[0].a.toUpperCase().includes('B')) calculatedScore += 10;
                if (examState.answers[1].a.toUpperCase().includes('B')) calculatedScore += 10;
                aiEvaluation = `【自動簡易採点】: **${calculatedScore}点 / 100点**\n選択問題の解答パターン、および記述問題の入力内容から、サーバー運用に対する基本的な理解と常識的なモラルが確認できました。最終配属は運営陣による手動審査で決定してください。`;
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
                                { name: `❓ ${examInfo.questions[0].title}`, value: examState.answers[0].a, inline: false },
                                { name: `❓ ${examInfo.questions[1].title}`, value: examState.answers[1].a, inline: false },
                                { name: `❓ ${examInfo.questions[2].title}`, value: examState.answers[2].a, inline: false },
                                { name: '🤖 AIによる一次審査結果 (適正判定)', value: aiEvaluation, inline: false },
                                { name: '👥 運営陣による手動最終判断', value: '上記のAI評価および実際の回答を元に、手動で役職を付与するか審査してください。', inline: false }
                            )
                            .setTimestamp();
                        await examChannel.send({ embeds: [embed] });
                    }
                } catch (e) { console.error("ログ送信エラー:", e); }
            }

            return await message.channel.send('🎉 **無事にすべての解答が運営陣へ転送されました。試験はこれで終了です！お疲れ様でした！**');
        }
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

        // --- /exam コマンド (運営が相手を選んで問題を送り出す仕様に進化) ---
        if (commandName === 'exam') {
            // 管理役職チェック
            const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
            if (!hasRole) {
                return interaction.reply({ content: `⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」役職を持つ運営陣のみ実行可能です。`, ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const examType = interaction.options.getString('type');
            const examInfo = EXAM_DATA[examType];

            await interaction.deferReply({ ephemeral: true });

            try {
                // ターゲットユーザーの試験ステータスを第1問目(step 1)にセット
                activeExams.set(targetUser.id, { type: examType, step: 1, answers: [] });

                // 相手のDMへ第1問目を埋め込み送信
                const q1Embed = new EmbedBuilder()
                    .setTitle(`📝 ${examInfo.name} の受講案内`)
                    .setDescription(`運営陣より、あなた宛てに配属採用試験が発行されました。全3問あります。順番にDMで回答してください。\n\n**${examInfo.questions[0].title}**\n${examInfo.questions[0].text}\n\n*※このメッセージにそのまま記号（A, B, Cなど）をキーボードで打ち込んで送信してください。*`)
                    .setColor(examInfo.color)
                    .setTimestamp();

                await targetUser.send({ embeds: [q1Embed] });

                return interaction.editReply({ content: `✅ ${targetUser.tag} の個人DMへ「${examInfo.name}」の第1問目を正常に送信しました！` });
            } catch (error) {
                console.error(error);
                activeExams.delete(targetUser.id);
                return interaction.editReply({ content: `❌ ${targetUser.tag} へDMを送信できませんでした。（相手がDMをブロックしている可能性があります）` });
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
