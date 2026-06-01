const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (24時間稼働用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.send('Bot is running perfectly with Exam & AI features!'); });
app.listen(PORT, () => { console.log(`Web server running on port ${PORT}`); });

// ==========================================
// 2. 初期設定とデータ管理
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 管理用データ
const lotteryData = new Map(); 
const voteData = new Map();       
const ttsChannels = new Map();
const activeExams = new Map();       // 受験中のユーザーデータ
const userExamSettings = new Map();  // 人事部が設定した試験タイプ

// 役職・ロール名定義
const ROLE_HR = "人事部【Human Resources】";
const ROLE_STAFF = "スタッフ【Staff】";
const ROLE_ADMIN = "管理者【Admin】";

// 配属試験の問題データ
const EXAM_QUESTIONS = {
    moderator: [
        { q: "【第1問】荒らしユーザー（連続的なスパムや下ネタの連投）を発見した場合、最初に行うべき適切な対応はどれですか？", os: ["警告なしで即座にBANする", "メッセージを削除し、公式に警告を付与する（タイムアウト等）", "無視して他の管理者が来るのを待つ", "メンションしてチャットで言い返す"], a: 1 },
        { q: "【第2問】一般ユーザー同士がチャットで激しい口論（喧嘩）を始めました。モデレーターとしての正しい対応は？", os: ["両者を即座にサーバーからキックする", "喧嘩の原因を詳しく追求し、どちらが正しいか白黒つける", "一旦チャットを落ち着かせ、必要であれば個別の警告やスレッド移行を促す", "どちらか一方の味方をして加勢する"], a: 2 },
        { q: "【第3問】他のスタッフの対応（BANや警告）に対して、一般ユーザーから「不当な処分だ」とクレームが入りました。どうすべきですか？", os: ["その場で処分の撤回を約束する", "クレームを言ったユーザーも一緒にBANする", "対応したスタッフをチャットで非難する", "詳細を確認するため、ログや経緯を控えて上層部（管理者）へ報告・相談する"], a: 3 }
    ],
    admin: [
        { q: "【第1問】サーバーの重要設定や権限（パーミッション）を変更する際、最も意識すべきセキュリティ原則はどれですか？", os: ["すべての役職に管理者権限を付与する", "必要最低限の権限のみを付与する（最小権限の原則）", "設定変更は誰にも言わずに事前告知なしで行う", "利便性のためにBotの権限を常に最上位にする"], a: 1 },
        { q: "【第2問】サーバー内で大規模なレイド（大量のBotやアカウントによる一斉荒らし）が発生しました。最優先で取るべき行動は？", os: ["サーバーを削除する", "荒らしアカウントを1つずつ手動でキックする", "ボットの招待リンクをすべて無効化し、サーバーの認証レベルを最大（最高）に引き上げる", "アナウンスチャンネルで一般ユーザーに謝罪文を連投する"], a: 2 },
        { q: "【第3問】運営チーム内で意見の対立が起き、雰囲気が悪くなってしまいました。最高管理者としてどう対応しますか？", os: ["意見が対立した片方のメンバーを全員追放する", "個人の感情を挟まず、双方の意見を論理的にヒアリングし、共通のルールや妥協点を見つける", "話し合いを拒否して独裁的に決める", "運営チャットを削除してリセットする"], a: 1 }
    ]
};

function addDateTimeOptions(builder) {
    return builder
        .addIntegerOption(o => o.setName('year').setDescription('年 (例: 2026)').setRequired(true))
        .addIntegerOption(o => o.setName('month').setDescription('月 (1〜12)').setRequired(true))
        .addIntegerOption(o => o.setName('day').setDescription('日 (1〜31)').setRequired(true))
        .addIntegerOption(o => o.setName('hour').setDescription('時 (0〜23)').setRequired(true))
        .addIntegerOption(o => o.setName('minute').setDescription('分 (0〜59)').setRequired(true));
}

// ==========================================
// 3. 全スラッシュコマンド登録データ
// ==========================================
const commandsData = [
    // 🤖 一般コマンド
    new SlashCommandBuilder().setName('ai').setDescription('高性能AIとおしゃべりします（日本語対応）').addStringOption(o => o.setName('question').setDescription('質問内容や話したいこと').setRequired(true)),
    new SlashCommandBuilder().setName('imagine').setDescription('AIでイラスト画像を自動生成します').addStringOption(o => o.setName('prompt').setDescription('生成したい画像の説明（英語推奨）').setRequired(true)),
    new SlashCommandBuilder().setName('join').setDescription('ボイスチャンネルに参加してチャットの読み上げを開始します'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出します'),
    new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
    new SlashCommandBuilder().setName('dice').setDescription('1〜100のサイコロを振ります'),

    // 🛡️ 人事部専用コマンド
    new SlashCommandBuilder().setName('exam').setDescription('指定したユーザーのDMに配属試験を送信します（人事部専用）').addUserOption(o => o.setName('user').setDescription('試験対象のメンバー').setRequired(true)).addStringOption(o => o.setName('type').setDescription('試験種別').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' })),
    new SlashCommandBuilder().setName('exam_result').setDescription('配属試験の結果を一括発表します（人事部専用）').addUserOption(o => o.setName('user1').setDescription('受験者').setRequired(true)).addStringOption(o => o.setName('score1').setDescription('点数').setRequired(true)).addStringOption(o => o.setName('role1').setDescription('配属先').setRequired(true)),

    // 🕒 スタッフ・管理者用タイマーコマンド
    addDateTimeOptions(new SlashCommandBuilder().setName('lottery').setDescription('日時指定の自動抽選会を開催します').addStringOption(o => o.setName('title').setDescription('抽選会のタイトル').setRequired(true)).addStringOption(o => o.setName('body').setDescription('詳しい説明や景品内容').setRequired(true))).addStringOption(o => o.setName('mentions').setDescription('メンション先 (例: @everyone)')),
    addDateTimeOptions(new SlashCommandBuilder().setName('vote').setDescription('日時指定・リアルタイム集計のアンケートを開始します').addStringOption(o => o.setName('title').setDescription('アンケートのタイトル').setRequired(true)).addStringOption(o => o.setName('body').setDescription('詳しい趣旨説明').setRequired(true)).addStringOption(o => o.setName('option1').setDescription('選択肢 1').setRequired(true)).addStringOption(o => o.setName('option2').setDescription('選択肢 2').setRequired(true))).addStringOption(o => o.setName('option3').setDescription('選択肢 3')).addStringOption(o => o.setName('option4').setDescription('選択肢 4')).addStringOption(o => o.setName('option5').setDescription('選択肢 5')).addStringOption(o => o.setName('mentions').setDescription('メンション先')),
].map(command => command.toJSON());

// ==========================================
// 4. ボット起動イベント
// ==========================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} としてログインしました！`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsData });
        console.log('🚀 全コマンド（配属試験・AI・読み上げ含む）の同期が完了しました！');
    } catch (error) { console.error('❌ コマンド登録エラー:', error); }
});

// タイマー監視 (10秒ごと)
setInterval(async () => {
    const now = new Date();
    for (const [msgId, data] of lotteryData.entries()) {
        if (now > data.deadline) {
            lotteryData.delete(msgId);
            try {
                const channel = await client.channels.fetch(data.channelId); const msg = await channel.messages.fetch(msgId);
                let resultText = "🚫 参加者がいませんでした。"; let winnerMention = "";
                if (data.participants.length > 0) {
                    const winnerId = data.participants[Math.floor(Math.random() * data.participants.length)];
                    resultText = `🎉 **当選者:** <@${winnerId}> さんおめでとうございます！`; winnerMention = `<@${winnerId}>`;
                }
                const endEmbed = new EmbedBuilder().setTitle(`🏁 【抽選終了】${data.title}`).setDescription(`${data.body}\n\n━━━━━━━━━━━━━━━━━━━━\n${resultText}`).setColor('#7F8C8D');
                await msg.edit({ embeds: [endEmbed], components: [] });
                await channel.send({ content: `🔔 **【抽選結果】** ${winnerMention}\n「${data.title}」の自動抽選が確定しました！ ${data.mentions}` });
            } catch (e) {}
        }
    }
    for (const [msgId, data] of voteData.entries()) {
        if (now > data.deadline) {
            voteData.delete(msgId);
            try {
                const channel = await client.channels.fetch(data.channelId); const msg = await channel.messages.fetch(msgId);
                const counts = new Array(data.options.length).fill(0); Object.values(data.votes).forEach(idx => { counts[idx]++; });
                const totalVotes = Object.keys(data.votes).length; let resultFields = "";
                data.options.forEach((opt, index) => {
                    const count = counts[index]; const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    resultFields += `**${index + 1}. ${opt}** — **${count}票** (${percent}%)\n`;
                });
                const endVoteEmbed = new EmbedBuilder().setTitle(`🏁 【投票終了】${data.title}`).setDescription(`${data.body}\n\n📊 **最終集計結果 (総投票数: ${totalVotes}票)**\n━━━━━━━━━━━━━━━━━━━━\n${resultFields}`).setColor('#7F8C8D');
                await msg.edit({ embeds: [endVoteEmbed], components: [] });
                await channel.send({ content: `🔔 **【投票終了】** 「${data.title}」の投票が締め切られました。${data.mentions}` });
            } catch (e) {}
        }
    }
}, 10000);

// ==========================================
// 5. 試験の次問送信・AI自動採点システム
// ==========================================
async function sendExamQuestion(user, examType, index) {
    const questions = EXAM_QUESTIONS[examType];
    if (index >= questions.length) {
        // 全問回答終了 -> AI総合自動採点へ
        const examSession = activeExams.get(user.id);
        activeExams.delete(user.id);

        let correctCount = 0;
        let reviewPayload = "";
        questions.forEach((q, i) => {
            const uAns = examSession.answers[i];
            const isCorrect = uAns === q.a;
            if (isCorrect) correctCount++;
            reviewPayload += `問${i+1}: ${q.q}\n正解: ${q.os[q.a]}\nユーザー回答: ${q.os[uAns] || "未回答"}\n結果: ${isCorrect ? "正解" : "不正解"}\n\n`;
        });

        const baseScore = Math.round((correctCount / questions.length) * 100);
        await user.send("📝 試験の全回答が完了しました。現在、AIによる総合人事評価を生成中です。10秒ほどお待ちください...");

        let aiSummary = "AI採点システムが混み合っているか、通信エラーが発生したため、通常のモデレーター役職への仮配属を推奨します。運営陣でログを確認の上、必要に応じて昇格させてください。";
        let finalScoreText = `${baseScore} / 100点`;

        try {
            const aiRes = await axios.post('https://chateverywhere.app/api/chat', {
                model: "gpt-4o-mini",
                messages: [{
                    role: "user",
                    content: `以下のDiscord運営配属試験の結果を見て、150文字以内で、人事評価・配属理由寸評を日本語で作成してください。\n\n【試験種別】: ${examType}\n【基礎スコア】: ${baseScore}点\n\n【詳細ログ】:\n${reviewPayload}`
                }]
            }, { timeout: 12000 });
            aiSummary = aiRes.data?.choices?.[0]?.message?.content || aiRes.data?.text || aiSummary;
        } catch (e) {
            finalScoreText = "判定エラー / 100点";
        }

        const resultEmbed = new EmbedBuilder()
            .setTitle(`🤖 AIによる総合人事判定・最終配属先候補`)
            .addFields(
                { name: "【AI採点結果】", value: finalScoreText },
                { name: "【推奨する配属先】", value: examType === 'admin' ? "👑 管理者 (要手動確認)" : "🛡️ モデレーター (要手動確認)" },
                { name: "【適正評価・配属理由寸評】", value: aiSummary }
            )
            .setColor('#3498DB')
            .setTimestamp();

        // 受験者本人と、設定したチャンネル（またはDM）に結果を通知
        await user.send({ embeds: [resultEmbed] });
        if (examSession.channelId) {
            try {
                const targetChannel = await client.channels.fetch(examSession.channelId);
                await targetChannel.send({ content: `📢 **【試験完了通知】** ${user} さんが \`${examType}\` 試験を完了しました。`, embeds: [resultEmbed] });
            } catch (err) {}
        }
        return;
    }

    // 問題の送信
    const currentQ = questions[index];
    const embed = new EmbedBuilder()
        .setTitle(`📝 配属選考試験 (${examType === 'admin' ? '👑 管理者篇' : '🛡️ モデレーター篇'})`)
        .setDescription(`**${currentQ.q}**`)
        .setColor('#E67E22')
        .setFooter({ text: `進捗: ${index + 1} / ${questions.length}` });

    const row = new ActionRowBuilder();
    currentQ.os.forEach((opt, i) => {
        row.addComponents(new ButtonBuilder().setCustomId(`exam_ans_${i}`).setLabel(opt.substring(0, 80)).setStyle(ButtonStyle.Primary));
    });

    await user.send({ embeds: [embed], components: [row] });
}

// ==========================================
// 6. チャット読み上げ(TTS)処理
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (ttsChannels.has(message.guild.id) && ttsChannels.get(message.guild.id) === message.channel.id) {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            let cleanText = message.content.replace(/<@!?\d+>/g, 'メンション').replace(/<#\d+>/g, 'チャンネル').replace(/https?:\/\/\S+/g, 'URL');
            if (cleanText.length > 40) cleanText = cleanText.substring(0, 40) + '以下略';
            if (cleanText.trim().length === 0) return;

            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
            const player = createAudioPlayer();
            const resource = createAudioResource(ttsUrl, { inputType: StreamType.Arbitrary });
            player.play(resource);
            connection.subscribe(player);
        }
    }
});

// ==========================================
// 7. 各種インタラクション処理 (ボタン ＆ スラッシュ)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    // 🔘 ボタン処理
    if (interaction.isButton()) {
        const { customId, message, user } = interaction;

        // 📝 試験回答ボタンの処理
        if (customId.startsWith('exam_ans_')) {
            const ansIdx = parseInt(customId.replace('exam_ans_', ''), 10);
            const session = activeExams.get(user.id);
            if (!session) return interaction.reply({ content: '❌ この試験セッションは既に終了しているか無効です。', ephemeral: true });

            session.answers.push(ansIdx);
            activeExams.set(user.id, session);

            // メッセージを更新してボタンを無効化
            await interaction.update({ components: [] });
            // 次の問題へ
            return sendExamQuestion(user, session.type, session.answers.length);
        }

        // 抽選エントリー
        if (customId === 'lottery_join') {
            const data = lotteryData.get(message.id); if (!data) return interaction.reply({ content: '❌ 終了しています。', ephemeral: true });
            if (data.participants.includes(user.id)) return interaction.reply({ content: '💡 エントリー済みです。', ephemeral: true });
            data.participants.push(user.id); lotteryData.set(message.id, data);
            const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFields({ name: '👥 現在のエントリー人数', value: `\`${data.participants.length}\` 名` });
            await message.edit({ embeds: [updatedEmbed] }); return interaction.reply({ content: '🎉 エントリーしました！', ephemeral: true });
        }

        // 投票
        if (customId.startsWith('vote_opt_')) {
            const optIdx = parseInt(customId.replace('vote_opt_', ''), 10);
            const data = voteData.get(message.id); if (!data) return interaction.reply({ content: '❌ 終了しています。', ephemeral: true });
            if (data.votes[user.id] !== undefined) return interaction.reply({ content: '⚠️ 投票済みです。', ephemeral: true });
            data.votes[user.id] = optIdx; voteData.set(message.id, data);
            const totalVotes = Object.keys(data.votes).length;
            const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFields({ name: '📊 現在の総投票数', value: `\`${totalVotes}\` 票` });
            await message.edit({ embeds: [updatedEmbed] }); return interaction.reply({ content: `✅ 投票しました！`, ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, member, guild, options } = interaction;
    
    const isHrOrAdmin = () => member.roles.cache.some(r => r.name === ROLE_HR || r.name === ROLE_ADMIN || r.name === ROLE_STAFF);
    const isStaffOrAdmin = () => member.roles.cache.some(r => r.name === ROLE_STAFF || r.name === ROLE_ADMIN);

    // 🤖 AIチャットコマンド (/ai)
    if (commandName === 'ai') {
        await interaction.deferReply();
        const question = options.getString('question');
        try {
            const res = await axios.post('https://chateverywhere.app/api/chat', {
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: question }]
            }, { timeout: 15000 });
            const answer = res.data?.choices?.[0]?.message?.content || res.data?.text;
            return interaction.editReply({ content: answer || "💡 AIから返答を取得できませんでした。" });
        } catch (e) {
            return interaction.editReply({ content: "❌ AIシステムのエラーです。時間を置いてお試しください。" });
        }
    }

    // 🎨 AI画像生成コマンド (/imagine)
    if (commandName === 'imagine') {
        await interaction.deferReply();
        const prompt = options.getString('prompt');
        try {
            const seed = Math.floor(Math.random() * 1000000);
            const imageUrl = `https://image.pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
            const imgEmbed = new EmbedBuilder().setTitle(`🎨 AIイラスト生成完了`).setDescription(`**プロンプト:** ${prompt}\n**作成者:** ${interaction.user}`).setImage(imageUrl).setColor('#FF69B4').setTimestamp();
            return interaction.editReply({ embeds: [imgEmbed] });
        } catch (e) { return interaction.editReply({ content: "❌ 画像の生成に失敗しました。" }); }
    }

    // 🗣️ 読み上げコマンド (/join)
    if (commandName === 'join') {
        const vc = member.voice.channel;
        if (!vc) return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        try {
            joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfMute: false, selfDeaf: true });
            ttsChannels.set(guild.id, interaction.channel.id);
            return interaction.reply({ content: `🔊 **「${vc.name}」** に接続しました！チャットを読み上げます。` });
        } catch (err) { return interaction.reply({ content: '❌ 音声接続に失敗しました。', ephemeral: true }); }
    }

    if (commandName === 'leave') {
        const connection = getVoiceConnection(guild.id);
        if (!connection) return interaction.reply({ content: '❌ ボットはVCに参加していません。', ephemeral: true });
        connection.destroy(); ttsChannels.delete(guild.id);
        return interaction.reply({ content: '👋 退出しました。' });
    }

    // 🛡️ 配属試験開始コマンド (/exam) 【復活】
    if (commandName === 'exam') {
        if (!isHrOrAdmin()) return interaction.reply({ content: '⚠️ このコマンドは人事部または管理者しか使用できません。', ephemeral: true });
        const targetUser = options.getUser('user');
        const examType = options.getString('type');

        if (activeExams.has(targetUser.id)) return interaction.reply({ content: '⚠️ そのユーザーは現在別の試験を受験中です。', ephemeral: true });

        activeExams.set(targetUser.id, { type: examType, answers: [], channelId: interaction.channel.id });
        
        try {
            await targetUser.send(`🔔 **仲良組合連合専属運営陣からのお知らせ**\nあなたのDM宛てに配属試験が送信されました。以下の選択肢ボタンを押して回答を開始してください。`);
            await sendExamQuestion(targetUser, examType, 0);
            return interaction.reply({ content: `✅ ${targetUser} さんのDMに \`${examType}\` 試験を送信しました。` });
        } catch (e) {
            activeExams.delete(targetUser.id);
            return interaction.reply({ content: `❌ ${targetUser} さんのDMへの送信に失敗しました（DM拒否設定の可能性があります）。`, ephemeral: true });
        }
    }

    // 📢 一括結果発表コマンド (/exam_result) 【復活】
    if (commandName === 'exam_result') {
        if (!isHrOrAdmin()) return interaction.reply({ content: '⚠️ 人事部または管理者専用です。', ephemeral: true });
        const u1 = options.getUser('user1');
        const s1 = options.getString('score1');
        const r1 = options.getString('role1');

        const announceEmbed = new EmbedBuilder()
            .setTitle('📢 【特報】組合運営陣・公式人事発令')
            .setDescription(`厳正なる選考およびAI総合判定の結果、以下の通り配属を決定いたしました。`)
            .addFields({ name: `👤 対象受験者: ${u1.username}`, value: `📊 **選考スコア**: \`${s1}\`\n💼 **最終配属先**: **${r1}**`, inline: false })
            .setColor('#2ECC71')
            .setFooter({ text: '仲良組合連合 専属人事部' })
            .setTimestamp();

        await interaction.channel.send({ content: `🔔 @everyone 【人事発令通知】`, embeds: [announceEmbed] });
        return interaction.reply({ content: '✅ 人事結果を公式発表しました。', ephemeral: true });
    }

    // 🕒 抽選会開催 (/lottery)
    if (commandName === 'lottery') {
        if (!isStaffOrAdmin()) return interaction.reply({ content: '⚠️ 権限がありません。', ephemeral: true });
        const title = options.getString('title'); const body = options.getString('body'); const mentions = options.getString('mentions') || "";
        const deadline = new Date(options.getInteger('year'), options.getInteger('month') - 1, options.getInteger('day'), options.getInteger('hour'), options.getInteger('minute'));
        const ts = Math.floor(deadline.getTime() / 1000);

        const lotteryEmbed = new EmbedBuilder().setTitle(`🎉 【抽選会開催】${title}`).setDescription(`${body}\n\n━━━━━━━━━━━━━━━━━━━━\n⏰ **終了期限**: <t:${ts}:F> (<t:${ts}:R>)`).addFields({ name: '👥 現在のエントリー人数', value: `\`0\` 名` }).setColor('#F1C40F');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('lottery_join').setLabel('🎉 エントリー').setStyle(ButtonStyle.Success));
        const replyMsg = await interaction.channel.send({ content: mentions, embeds: [lotteryEmbed], components: [row] });
        lotteryData.set(replyMsg.id, { title, body, deadline, participants: [], mentions, channelId: interaction.channel.id });
        return interaction.reply({ content: '✅ 抽選パネルを配置しました。', ephemeral: true });
    }

    // 📊 アンケート投票 (/vote)
    if (commandName === 'vote') {
        if (!isStaffOrAdmin()) return interaction.reply({ content: '⚠️ 権限がありません。', ephemeral: true });
        const title = options.getString('title'); const body = options.getString('body'); const mentions = options.getString('mentions') || "";
        const opts = []; for (let i = 1; i <= 5; i++) { const o = options.getString(`option${i}`); if (o) opts.push(o); }
        const deadline = new Date(options.getInteger('year'), options.getInteger('month') - 1, options.getInteger('day'), options.getInteger('hour'), options.getInteger('minute'));
        const ts = Math.floor(deadline.getTime() / 1000);

        let optsText = ""; const buttons = [];
        opts.forEach((o, i) => { optsText += `**${i + 1}️⃣**: ${o}\n`; buttons.push(new ButtonBuilder().setCustomId(`vote_opt_${i}`).setLabel(`${i + 1}️⃣`).setStyle(ButtonStyle.Primary)); });
        const voteEmbed = new EmbedBuilder().setTitle(`📊 【アンケート】${title}`).setDescription(`${body}\n\n📌 **選択肢**:\n${optsText}\n━━━━━━━━━━━━━━━━━━━━\n⏰ **投票期限**: <t:${ts}:F>`).addFields({ name: '📊 現在の総投票数', value: `\`0\` 票` }).setColor('#3498DB');
        const row = new ActionRowBuilder().addComponents(buttons);
        const replyMsg = await interaction.channel.send({ content: mentions, embeds: [voteEmbed], components: [row] });
        voteData.set(replyMsg.id, { title, body, deadline, options: opts, votes: {}, mentions, channelId: interaction.channel.id });
        return interaction.reply({ content: '✅ 投票アンケートを開始しました。', ephemeral: true });
    }

    if (commandName === 'omikuji') {
        const fortunes = ['大吉 🌟', '吉 ✨', '中吉 🎵', '小吉 🌿'];
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔮 今日の運勢').setDescription(`結果: **${fortunes[Math.floor(Math.random() * fortunes.length)]}**`).setColor('#FF69B4')] });
    }
    if (commandName === 'dice') return interaction.reply({ content: `🎲 サイコロ: **${Math.floor(Math.random() * 100) + 1}** / 100` });
});

client.login(process.env.DISCORD_TOKEN);
