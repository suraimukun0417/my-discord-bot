const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (24時間稼働用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.send('Bot is running perfectly!'); });
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

const lotteryData = new Map(); 
const voteData = new Map();       
const ttsChannels = new Map();

const ROLE_STAFF = "スタッフ【Staff】";
const ROLE_ADMIN = "管理者【Admin】";

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
    new SlashCommandBuilder().setName('ai').setDescription('高性能AIとおしゃべりします（日本語対応）').addStringOption(o => o.setName('question').setDescription('質問内容や話したいこと').setRequired(true)),
    new SlashCommandBuilder().setName('imagine').setDescription('AIでイラスト画像を自動生成します').addStringOption(o => o.setName('prompt').setDescription('生成したい画像の説明（英語推奨。例: cute anime cat）').setRequired(true)),
    new SlashCommandBuilder().setName('join').setDescription('ボイスチャンネルに参加してチャットの読み上げを開始します'),
    new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出します'),
    new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
    new SlashCommandBuilder().setName('dice').setDescription('1〜100のサイコロを振ります'),

    addDateTimeOptions(
        new SlashCommandBuilder()
            .setName('lottery')
            .setDescription('日時指定の自動抽選会を開催します')
            .addStringOption(o => o.setName('title').setDescription('抽選会のタイトル').setRequired(true))
            .addStringOption(o => o.setName('body').setDescription('詳しい説明や景品内容').setRequired(true))
    ).addStringOption(o => o.setName('mentions').setDescription('メンション先 (例: @everyone)')),

    addDateTimeOptions(
        new SlashCommandBuilder()
            .setName('vote')
            .setDescription('日時指定・リアルタイム集計のアンケートを開始します')
            .addStringOption(o => o.setName('title').setDescription('アンケートのタイトル').setRequired(true))
            .addStringOption(o => o.setName('body').setDescription('詳しい趣旨説明').setRequired(true))
            .addStringOption(o => o.setName('option1').setDescription('選択肢 1').setRequired(true))
            .addStringOption(o => o.setName('option2').setDescription('選択肢 2').setRequired(true))
    )
    .addStringOption(o => o.setName('option3').setDescription('選択肢 3'))
    .addStringOption(o => o.setName('option4').setDescription('選択肢 4'))
    .addStringOption(o => o.setName('option5').setDescription('選択肢 5'))
    .addStringOption(o => o.setName('mentions').setDescription('メンション先')),
].map(command => command.toJSON());

// ==========================================
// 4. ボット起動イベント
// ==========================================
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} としてログインしました！`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsData });
        console.log('🚀 全コマンドの登録・同期が完了しました！');
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
// 5. チャット読み上げ(TTS)処理
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
// 6. 各種インタラクション処理
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const { customId, message, user } = interaction;
        if (customId === 'lottery_join') {
            const data = lotteryData.get(message.id); if (!data) return interaction.reply({ content: '❌ 終了しています。', ephemeral: true });
            if (data.participants.includes(user.id)) return interaction.reply({ content: '💡 エントリー済みです。', ephemeral: true });
            data.participants.push(user.id); lotteryData.set(message.id, data);
            const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFields({ name: '👥 現在のエントリー人数', value: `\`${data.participants.length}\` 名` });
            await message.edit({ embeds: [updatedEmbed] }); return interaction.reply({ content: '🎉 エントリーしました！', ephemeral: true });
        }
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
    const isStaffOrAdmin = () => member.roles.cache.some(r => r.name === ROLE_STAFF || r.name === ROLE_ADMIN);

    // ✨ 新・超安定版AIチャット機能 (/ai)
    if (commandName === 'ai') {
        await interaction.deferReply();
        const question = options.getString('question');
        try {
            // トークン不要・2026年現在最も安定しているテスト用DuckDuckGo AI APIをモデリング
            const res = await axios.post('https://chateverywhere.app/api/chat', {
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: question }]
            }, { timeout: 15000 });
            
            const answer = res.data?.choices?.[0]?.message?.content || res.data?.text;
            return interaction.editReply({ content: answer || "💡 AIから返答を取得できませんでした。" });
        } catch (e) {
            // 万が一のバックアップエンドポイント
            try {
                const backup = await axios.get(`https://api.simsimi.net/v2/?text=${encodeURIComponent(question)}&lc=ja`);
                return interaction.editReply({ content: backup.data?.success || "❌ 現在AIサーバーとの通信が切断されています。" });
            } catch (err) {
                return interaction.editReply({ content: "❌ AIシステムのエラーです。時間を置いてお試しください。" });
            }
        }
    }

    // ✨ 新・超安定版AI画像生成 (/imagine)
    if (commandName === 'imagine') {
        await interaction.deferReply();
        const prompt = options.getString('prompt');
        try {
            // 規制のない安定したPollinationsの自動生成ネットワークへ変更
            const seed = Math.floor(Math.random() * 1000000);
            const imageUrl = `https://image.pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;

            const imgEmbed = new EmbedBuilder()
                .setTitle(`🎨 AIイラスト生成完了`)
                .setDescription(`**プロンプト:** ${prompt}\n**作成者:** ${interaction.user}`)
                .setImage(imageUrl)
                .setColor('#FF69B4')
                .setTimestamp();
            
            return interaction.editReply({ embeds: [imgEmbed] });
        } catch (e) {
            return interaction.editReply({ content: "❌ 画像の生成に失敗しました。" });
        }
    }

    // 🔊 読み上げ開始 (/join)
    if (commandName === 'join') {
        const vc = member.voice.channel;
        if (!vc) return interaction.reply({ content: '❌ 先にボイスチャンネルに参加してください。', ephemeral: true });
        try {
            joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfMute: false, selfDeaf: true });
            ttsChannels.set(guild.id, interaction.channel.id);
            return interaction.reply({ content: `🔊 **「${vc.name}」** に接続しました！チャットを読み上げます。` });
        } catch (err) { return interaction.reply({ content: '❌ 音声接続に失敗しました。', ephemeral: true }); }
    }

    // 👋 読み上げ終了 (/leave)
    if (commandName === 'leave') {
        const connection = getVoiceConnection(guild.id);
        if (!connection) return interaction.reply({ content: '❌ ボットはVCに参加していません。', ephemeral: true });
        connection.destroy(); ttsChannels.delete(guild.id);
        return interaction.reply({ content: '👋 退出しました。' });
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
