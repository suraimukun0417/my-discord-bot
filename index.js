const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection, StreamType } = require('@discordjs/voice');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (UptimeRobot / Render 用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.send('Bot is running flawlessly with opusscript!'); });
app.listen(PORT, () => { console.log(`Web server running on port ${PORT}`); });

// ==========================================
// 2. 初期設定・環境変数・グローバル管理データ
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: ['Channel']
});

// 🏷️ ロール名定義
const ROLE_HR = "人事部【Human Resources】";
const ROLE_BOT_MGR = "ボット管理";
const ROLE_STAFF = "スタッフ【Staff】";
const ROLE_ADMIN = "管理者【Admin】";

const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

let currentStatus = "online";
let statusMessageId = null;
let serverStatusChannelId = null;
let serverStatusMessageId = null;

// データ管理
const activeExams = new Map();
const userExamSettings = new Map();
const lotteryData = new Map(); 
const voteData = new Map();       
const shiritoriGames = new Map();

// 🗣️ 読み上げ用管理マップ（guildId -> textChannelId）
const ttsChannels = new Map(); 

// 日時指定用の共通オプション関数
function addDateTimeOptions(builder) {
    return builder
        .addIntegerOption(o => o.setName('year').setDescription('年 (例: 2026)').setRequired(true))
        .addIntegerOption(o => o.setName('month').setDescription('月 (1〜12)').setRequired(true))
        .addIntegerOption(o => o.setName('day').setDescription('日 (1〜31)').setRequired(true))
        .addIntegerOption(o => o.setName('hour').setDescription('時 (0〜23)').setRequired(true))
        .addIntegerOption(o => o.setName('minute').setDescription('分 (0〜59)').setRequired(true));
}

// ==========================================
// 3. 全スラッシュコマンドの定義
// ==========================================
const commandsData = [
    new SlashCommandBuilder().setName('status').setDescription('ボットのステータスを変更します（ボット管理用）').addStringOption(o => o.setName('type').setDescription('種類').setRequired(true).addChoices({ name: '起動', value: 'online' }, { name: 'メンテ', value: 'maintenance' }, { name: '停止', value: 'offline' })),
    new SlashCommandBuilder().setName('dm_say').setDescription('ユーザーにボットから埋め込みDMを送ります（Staff/Admin用）').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('本文').setRequired(true)).addUserOption(o => o.setName('user').setDescription('相手')),
    new SlashCommandBuilder().setName('exam').setDescription('指定したユーザーのDMに配属試験を送信します（人事部専用）').addUserOption(o => o.setName('user').setDescription('試験対象').setRequired(true)).addStringOption(o => o.setName('type').setDescription('試験種別').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' })),
    new SlashCommandBuilder().setName('exam_result').setDescription('配属試験の結果を一括発表します（人事部専用）').addUserOption(o => o.setName('user1').setDescription('受験者').setRequired(true)).addStringOption(o => o.setName('score1').setDescription('点数').setRequired(true)).addStringOption(o => o.setName('role1').setDescription('配属先').setRequired(true)),
    new SlashCommandBuilder().setName('embed').setDescription('カラー指定つきの埋め込みを投稿します（Staff/Admin用）').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('body').setDescription('本文').setRequired(true)).addStringOption(o => o.setName('color').setDescription('カラー').setRequired(true).addChoices({ name: '🔵 青', value: '#3498DB' }, { name: '🟢 緑', value: '#2ECC71' }, { name: '🔴 赤', value: '#E74C3C' })),
    new SlashCommandBuilder().setName('server_status').setDescription('自動更新されるサーバー状況ステータスパネルを設置します（Staff/Admin用）'),
    new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います！（誰でも可能）'),
    new SlashCommandBuilder().setName('dice').setDescription('ランダムにサイコロを振ります（誰でも可能）'),
    new SlashCommandBuilder().setName('ai').setDescription('AIと自由におしゃべりや質問ができます（誰でも可能）').addStringOption(o => o.setName('question').setDescription('質問内容').setRequired(true)),
    
    // 📢 読み上げコマンド（誰でも可能）
    new SlashCommandBuilder().setName('join').setDescription('現在のボイスチャンネルにボットを呼び出して読み上げを開始します'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルからボットを退出させます'),
    
    // 🎨 AI画像生成コマンド（誰でも可能）
    new SlashCommandBuilder().setName('imagine').setDescription('要望に応じたイラスト画像を生成します').addStringOption(o => o.setName('prompt').setDescription('どのような画像を生成したいか（英語のほうが綺麗に出ます）').setRequired(true)),

    // 🕒 抽選コマンド（Staff/Admin用）
    addDateTimeOptions(
        new SlashCommandBuilder()
            .setName('lottery')
            .setDescription('日時指定・複数メンション対応の自動抽選会を開催します')
            .addStringOption(o => o.setName('title').setDescription('抽選会のタイトル').setRequired(true))
            .addStringOption(o => o.setName('body').setDescription('詳しい説明・景品内容').setRequired(true))
    ).addStringOption(o => o.setName('mentions').setDescription('メンション先 (スペース区切りで複数可 例: @everyone @役職名)')),

    // 🕒 投票コマンド（Staff/Admin用）
    addDateTimeOptions(
        new SlashCommandBuilder()
            .setName('vote')
            .setDescription('日時指定・投票数リアルタイム表示のアンケートを開始します')
            .addStringOption(o => o.setName('title').setDescription('アンケートのタイトル').setRequired(true))
            .addStringOption(o => o.setName('body').setDescription('詳しい趣旨説明').setRequired(true))
            .addStringOption(o => o.setName('option1').setDescription('選択肢 1').setRequired(true))
            .addStringOption(o => o.setName('option2').setDescription('選択肢 2').setRequired(true))
    )
    .addStringOption(o => o.setName('option3').setDescription('選択肢 3（任意）'))
    .addStringOption(o => o.setName('option4').setDescription('選択肢 4（任意）'))
    .addStringOption(o => o.setName('option5').setDescription('選択肢 5（任意）'))
    .addStringOption(o => o.setName('mentions').setDescription('メンション先 (スペース区切りで複数可)')),
].map(command => command.toJSON());

// ==========================================
// 4. 補助関数・外部API連携 (AI & TTS)
// ==========================================
async function askAI(systemPrompt, userPrompt) {
    try {
        const response = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', {
            model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
        }, { timeout: 6000 });
        return response.data?.choices?.[0]?.message?.content || null;
    } catch (e) { return null; }
}

// 🔊 Google TTSのURL取得
function getTtsUrl(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&tl=ja&client=tw-ob&q=${encodeURIComponent(text)}`;
}

// 📊 サーバー状況パネル構築
async function buildServerStatusEmbed(guild) {
    const members = await guild.members.fetch({ withPresences: true });
    const totalMembers = guild.memberCount;
    const botCount = members.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;
    const onlineCount = members.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline').size;
    const offlineCount = humanCount - onlineCount;

    return new EmbedBuilder()
        .setTitle(`📊 リアルタイム・サーバー稼働状況`)
        .setDescription(`現在の統計情報を同期しています。(1分自動更新)`)
        .setColor('#2ECC71')
        .addFields(
            { name: '👥 メンバー総数', value: `\`\`\`js\n全体: ${totalMembers} 名 (人間: ${humanCount}人 / BOT: ${botCount}台)\n\`\`\``, inline: false },
            { name: '🟢 アクティビティ', value: `👤 **オンライン**: ${onlineCount} 名\n⚫ **オフライン**: ${offlineCount} 名`, inline: true }
        )
        .setTimestamp();
}

async function updateStatusMessage() {
    const channelId = process.env.STATUS_CHANNEL_ID; if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId); if (!channel) return;
        const content = STATUS_TEMPLATES[currentStatus];
        if (statusMessageId) {
            try { const msg = await channel.messages.fetch(statusMessageId); await msg.edit(content); } catch (e) { const newMsg = await channel.send(content); statusMessageId = newMsg.id; }
        } else {
            const messages = await channel.messages.fetch({ limit: 10 }); const botMsg = messages.find(m => m.author.id === client.user.id);
            if (botMsg) { await botMsg.edit(content); statusMessageId = botMsg.id; } else { const newMsg = await channel.send(content); statusMessageId = newMsg.id; }
        }
    } catch (e) {}
}

// ==========================================
// 5. Discordクライアント 起動イベント
// ==========================================
client.once('ready', async () => {
    console.log(`${client.user.tag} がログインしました。`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsData });
        console.log('✅ すべてのスラッシュコマンドが同期されました！');
    } catch (error) { console.error('❌ コマンド登録エラー:', error); }
    currentStatus = "online"; await updateStatusMessage();
});

// ⏰ 定期監視タスク (10秒ごと)
setInterval(async () => {
    const now = new Date();
    if (serverStatusChannelId && serverStatusMessageId && now.getSeconds() < 12) {
        try {
            const channel = await client.channels.fetch(serverStatusChannelId);
            if (channel) {
                const msg = await channel.messages.fetch(serverStatusMessageId);
                const newEmbed = await buildServerStatusEmbed(channel.guild);
                await msg.edit({ embeds: [newEmbed] });
            }
        } catch (err) {}
    }
    // 抽選締め切り監視
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
                await channel.send({ content: `🔔 **【抽選結果】** ${winnerMention}\n「${data.title}」の自動抽選が確定しました！ ${data.mentions || ""}` });
            } catch (err) {}
        }
    }
    // 投票締め切り監視
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
                await channel.send({ content: `🔔 **【投票終了】** 「${data.title}」の投票が締め切られました。${data.mentions || ""}` });
            } catch (err) {}
        }
    }
}, 10000);

// ==========================================
// 6. メッセージ作成イベント (しりとり＆チャット読み上げ)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 🔊 チャット読み上げ(TTS)の処理
    if (ttsChannels.has(message.guildId) && ttsChannels.get(message.guildId) === message.channel.id) {
        const connection = getVoiceConnection(message.guildId);
        if (connection) {
            let cleanText = message.content.replace(/<@!?\d+>/g, 'メンション').replace(/https?:\/\/\S+/g, 'URL');
            if (cleanText.length > 40) cleanText = cleanText.substring(0, 40) + '以下略';
            if (cleanText.trim().length > 0) {
                const player = createAudioPlayer();
                const resource = createAudioResource(getTtsUrl(cleanText), { inputType: StreamType.Arbitrary });
                player.play(resource);
                connection.subscribe(player);
            }
        }
    }
});

// ==========================================
// 7. インタラクション・コマンド処理
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const { customId, message, user } = interaction;
        if (customId === 'lottery_join') {
            const data = lotteryData.get(message.id); if (!data) return interaction.reply({ content: '❌ 終了しています。', ephemeral: true });
            if (data.participants.includes(user.id)) return interaction.reply({ content: '💡 既にエントリー済みです。', ephemeral: true });
            data.participants.push(user.id); lotteryData.set(message.id, data);
            const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFields({ name: '👥 現在のエントリー人数', value: `\`${data.participants.length}\` 名` });
            await message.edit({ embeds: [updatedEmbed] }); return interaction.reply({ content: '🎉 エントリーしました！', ephemeral: true });
        }
        if (customId.startsWith('vote_opt_')) {
            const optIdx = parseInt(customId.replace('vote_opt_', ''), 10);
            const data = voteData.get(message.id); if (!data) return interaction.reply({ content: '❌ 終了しています。', ephemeral: true });
            if (data.votes[user.id] !== undefined) return interaction.reply({ content: '⚠️ すでに投票済みです。', ephemeral: true });
            
            data.votes[user.id] = optIdx; voteData.set(message.id, data);
            const totalVotes = Object.keys(data.votes).length;
            
            const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFields({ name: '📊 現在の総投票数', value: `\`${totalVotes}\` 票` });
            await message.edit({ embeds: [updatedEmbed] });
            return interaction.reply({ content: `✅ 投票しました！`, ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName, member, guild, options } = interaction;

    const hasRole = (rName) => member.roles.cache.some(r => r.name === rName);
    const isStaffOrAdmin = () => hasRole(ROLE_STAFF) || hasRole(ROLE_ADMIN);

    // 1. 誰でも使える機能 (AI, 読み上げ, 画像生成)
    if (commandName === 'ai') {
        await interaction.deferReply();
        const reply = await askAI("AIアシスタント", options.getString('question'));
        return interaction.editReply({ content: reply || "AIが応答できませんでした。" });
    }

    if (commandName === 'join') {
        const vc = member.voice.channel;
        if (!vc) return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
        ttsChannels.set(guild.id, interaction.channel.id);
        return interaction.reply({ content: `🔊 ボイスチャンネル「${vc.name}」に接続しました！チャットを読み上げます。` });
    }

    if (commandName === 'leave') {
        const connection = getVoiceConnection(guild.id);
        if (!connection) return interaction.reply({ content: '❌ ボットは音声チャンネルに参加していません。', ephemeral: true });
        connection.destroy(); ttsChannels.delete(guild.id);
        return interaction.reply({ content: '👋 退出しました。' });
    }

    if (commandName === 'imagine') {
        await interaction.deferReply();
        const prompt = options.getString('prompt');
        try {
            const res = await axios.post('https://api.deepinfra.com/v1/openai/images/generations', {
                prompt: prompt,
                model: "black-forest-labs/FLUX-1-schnell",
                n: 1,
                size: "1024x1024"
            }, { timeout: 25000 });
            
            const imageUrl = res.data?.data?.[0]?.url;
            if (!imageUrl) throw new Error();

            const imgEmbed = new EmbedBuilder()
                .setTitle(`🎨 AI画像生成完了`)
                .setDescription(`**プロンプト:** ${prompt}\n**作成者:** ${interaction.user}`)
                .setImage(imageUrl)
                .setColor('#FF69B4')
                .setTimestamp();
            return interaction.editReply({ embeds: [imgEmbed] });
        } catch (e) {
            return interaction.editReply({ content: '❌ 画像生成に失敗しました。時間をおいて英語で試してみてください。' });
        }
    }

    // 2. スタッフ・管理者専用機能
    if (['lottery', 'vote', 'embed', 'dm_say', 'server_status'].includes(commandName)) {
        if (!isStaffOrAdmin()) return interaction.reply({ content: '⚠️ 権限がありません。', ephemeral: true });

        const parseDeadline = () => {
            const y = options.getInteger('year'); const m = options.getInteger('month') - 1; const d = options.getInteger('day');
            const h = options.getInteger('hour'); const min = options.getInteger('minute');
            return new Date(y, m, d, h, min);
        };

        if (commandName === 'lottery') {
            const title = options.getString('title'); const body = options.getString('body'); const mentions = options.getString('mentions') || "";
            const deadline = parseDeadline(); const ts = Math.floor(deadline.getTime() / 1000);

            const lotteryEmbed = new EmbedBuilder().setTitle(`🎉 【抽選開催】${title}`).setDescription(`${body}\n\n━━━━━━━━━━━━━━━━━━━━\n⏰ **終了期限**: <t:${ts}:F> (<t:${ts}:R>)`).addFields({ name: '👥 現在のエントリー人数', value: `\`0\` 名` }).setColor('#F1C40F');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('lottery_join').setLabel('🎉 参加する').setStyle(ButtonStyle.Success));
            const replyMsg = await interaction.channel.send({ content: mentions, embeds: [lotteryEmbed], components: [row] });
            lotteryData.set(replyMsg.id, { title, body, deadline, participants: [], mentions, channelId: interaction.channel.id });
            return interaction.reply({ content: '✅ 抽選を開始しました！', ephemeral: true });
        }

        if (commandName === 'vote') {
            const title = options.getString('title'); const body = options.getString('body'); const mentions = options.getString('mentions') || "";
            const opts = []; for (let i = 1; i <= 5; i++) { const o = options.getString(`option${i}`); if (o) opts.push(o); }
            const deadline = parseDeadline(); const ts = Math.floor(deadline.getTime() / 1000);

            let optsText = ""; const buttons = [];
            opts.forEach((o, i) => { optsText += `**${i + 1}️⃣**: ${o}\n`; buttons.push(new ButtonBuilder().setCustomId(`vote_opt_${i}`).setLabel(`${i + 1}️⃣`).setStyle(ButtonStyle.Primary)); });
            const voteEmbed = new EmbedBuilder().setTitle(`📊 【投票アンケート】${title}`).setDescription(`${body}\n\n📌 **選択肢一覧**:\n${optsText}\n━━━━━━━━━━━━━━━━━━━━\n⏰ **投票期限**: <t:${ts}:F>`).addFields({ name: '📊 現在の総投票数', value: `\`0\` 票` }).setColor('#3498DB');
            const row = new ActionRowBuilder().addComponents(buttons);
            const replyMsg = await interaction.channel.send({ content: mentions, embeds: [voteEmbed], components: [row] });
            voteData.set(replyMsg.id, { title, body, deadline, options: opts, votes: {}, mentions, channelId: interaction.channel.id });
            return interaction.reply({ content: '✅ 投票を開始しました！', ephemeral: true });
        }
    }

    // 遊び機能
    if (commandName === 'omikuji') {
        const fortunes = ['大吉 🌟', '吉 ✨', '中吉 🎵'];
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔮 今日の運勢').setDescription(`結果: **${fortunes[Math.floor(Math.random() * fortunes.length)]}**`).setColor('#FF69B4')] });
    }
    if (commandName === 'dice') return interaction.reply({ content: `🎲 出目: **${Math.floor(Math.random() * 100) + 1}** / 100` });
});

client.login(process.env.DISCORD_TOKEN);
