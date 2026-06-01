const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (UptimeRobot / Render 用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('Bot is running with Lottery and Vote systems!'); });
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
        GatewayIntentBits.GuildPresences
    ],
    partials: ['Channel']
});

const HR_ROLE_NAME = "人事部【Human Resources】"; 
const ALLOWED_ROLE_NAME = "ボット管理"; // 管理者用

const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

let currentStatus = "online";
let statusMessageId = null;

// サーバー状況パネル用
let serverStatusChannelId = null;
let serverStatusMessageId = null;

// 各種データ管理マップ
const activeExams = new Map();
const userExamSettings = new Map();

// 🆕 抽選・投票システム用のデータ管理マップ
const lotteryData = new Map(); // メッセージID -> { title, body, deadline, participants: [], mention, channelId }
const voteData = new Map();       // メッセージID -> { title, body, deadline, options: [], votes: {userId: optionIndex}, mention, channelId }

// しりとり管理データ
const shiritoriGames = new Map();

const EXAM_DATA = {
    moderator: {
        name: '🛡️ モデレーター試験',
        color: '#3498DB',
        questions: [
            { type: 'choice', title: '【第1問（選択）】ルール違反の確認', text: '一般ユーザーが「言葉遣いのルール」に明確に違反しているのを発見しました。最初にとるべき行動として適切なものはどれですか？\n\nA: 何も言わずに即座にサーバーからBANする\nB: 公開チャンネル、またはDMで注意・警告を与える\nC: 見て見ぬふりをする' },
            { type: 'choice', title: '【第2問（選択）】大規模な荒らしへの対処', text: '複数のアカウントが同時に無意味な連投（スパム）を始めました。最優先すべき対応はどれですか？\n\nA: 荒らしユーザー全員に口頭で注意する\nB: 該当チャンネルの書き込み権限を一時的にロックし、適切にキック・BAN等の対処を行う\nC: 静観する' },
            { type: 'choice', title: '【第3問（選択）】個人情報の取り扱い', text: 'メンバーが誤って他人の本名や写真を送信してしまいました。適切な対応はどれですか？\n\nA: 放置する\nB: すぐにそのメッセージを削除し、本人に注意を促すとともに他の運営に報告する\nC: スクリーンショットを撮って拡散する' },
            { type: 'choice', title: '【第4問（選択）】権限の悪用について', text: '他のモデレーターが権限を悪用し、一般ユーザーを不当にキックしているのを目撃しました。どうすべきですか？\n\nA: 自分も一緒になってキックに加わる\nB: 独断で動かず、ログなどの証拠を確保してすぐに上の管理者に報告・相談する\nC: 喧嘩になるのが嫌なので無視する' },
            { type: 'essay', title: '【第5問（記述）】ユーザー同士の口論への対応', text: '常連ユーザー同士がチャンネル内で激しい口論（喧嘩）を始めてしまいました。対応方針を具体的に記述してください。' },
            { type: 'essay', title: '【第6問（記述）】新規ユーザーへの配慮', text: 'サーバーに入りたての新規ユーザーが、ルールをよく知らずに雑談禁止のチャンネルで話し始めてしまいました。案内文章を考えて記述してください。' },
            { type: 'essay', title: '【第7問（記述）】理想のモデレーター像', text: 'あなたがこのサーバーのモデレーターとして採用された場合、どのような点に気をつけて活動したいですか？' }
        ],
        guide: `📊 **【モデレーター試験 正解＆解説】**\n**■ 選択問題正解:** 全て **「B」**\n**■ 記述例:** 中立を保ち個別スレッド誘導、新規には歓迎しつつ優しく#雑談へ案内。`
    },
    admin: {
        name: '👑 管理者試験',
        color: '#E74C3C',
        questions: [
            { type: 'choice', title: '【第1問（選択）】権限設定のトラブル', text: '新しく作成したチャンネルが一般ユーザーに見えてしまっていると報告を受けました。最初に確認すべき項目はどれですか？\n\nA: チャンネルの閲覧権限（@everyone の設定）が正しく拒否されているか確認する\nB: 原因がわからないのでサーバー自体を削除して作り直す\nC: 放置する' },
            { type: 'choice', title: '【第2問（選択）】ボットの不具合対応', text: 'サーバー内で稼働している主要ボットが突然コマンドに反応しなくなりました。優先すべき対応手順はどれですか？\n\nA: ボットの役職や管理権限をすべて剥奪する\nB: ボットのステータスや開発元の情報を確認し、ログを見て再起動を試みる\nC: 他の管理者が直してくれるまで待つ' },
            { type: 'choice', title: '【第3問（選択）】他の運営メンバーとの衝突', text: '運営方針を巡って、あなたと他の管理者の間で意見が真っ向から対立してしまいました。どう行動すべきですか？\n\nA: 独断でその管理者の権限を剥奪して追放する\nB: お互いの意見の利害を整理し、他のメンバーも交えて冷静に話し合う\nC: 運営を辞めてサーバーを荒らす' },
            { type: 'choice', title: '【第4問（選択）】セキュリティ対策', text: 'サーバーのセキュリティレベル（認証レベル）を変更する際、最も考慮すべきバランスはどれですか？\n\nA: 荒らしを完全に防ぐために一番厳しい設定のまま固定する\nB: 荒らし対策の安全性と、新規ユーザーの参加しやすさのバランスを考慮する\nC: 最低設定にする' },
            { type: 'essay', title: '【第5問（記述）】サーバーの活性化企画', text: 'アクティブユーザーを増やすために、あなたが管理者になったら実施したい企画を記述してください。' },
            { type: 'essay', title: '【第6問（記述）】トラブル発生時の危機管理', text: 'サーバーが大規模な荒らしアカウントの襲撃（レイド）に遭った際の迅速な対応方針を記述してください。' },
            { type: 'essay', title: '【第7問（記述）】長期的なサーバー運営のビジョン', text: '半年〜1年後にこのサーバーをどのようなコミュニティに成長させたいですか？' }
        ],
        guide: `📊 **【管理者試験 正解＆解説】**\n**■ 選択問題正解:** 全て **「B」**\n**■ 記述例:** 継続イベントの企画立案、レイド時のBot認証強化とアナウンス手順、属人化を防ぐ運営体制マニュアルの整備。`
    }
};

// ==========================================
// 3. スラッシュコマンドの登録定義
// ==========================================
const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('ボットのステータスを変更します')
        .addStringOption(option => option.setName('type').setDescription('種類').setRequired(true).addChoices({ name: '起動', value: 'online' }, { name: 'メンテ', value: 'maintenance' }, { name: '停止', value: 'offline' })),
    new SlashCommandBuilder()
        .setName('rolepanel')
        .setDescription('ボタン式ロールパネルを作成します')
        .addStringOption(option => option.setName('text').setDescription('説明文').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('ロール').setRequired(true)),
    new SlashCommandBuilder()
        .setName('dm_say')
        .setDescription('特定のユーザーにボットから埋め込みDMを送ります')
        .addStringOption(option => option.setName('title').setDescription('タイトル').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('本文').setRequired(true))
        .addUserOption(option => option.setName('user').setDescription('相手').setRequired(false)),
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AIと自由におしゃべりや質問ができます')
        .addStringOption(option => option.setName('question').setDescription('質問内容').setRequired(true)),
    new SlashCommandBuilder()
        .setName('janken')
        .setDescription('AIボットとじゃんけん勝負をします！')
        .addStringOption(option => option.setName('hand').setDescription('手').setRequired(true).addChoices({ name: '✊ グー', value: 'goo' }, { name: '✌️ チョキ', value: 'choki' }, { name: '🖐️ パー', value: 'paa' })),
    new SlashCommandBuilder()
        .setName('exam')
        .setDescription('指定したユーザーのDMに配属試験を送信します（人事部専用）')
        .addUserOption(option => option.setName('user').setDescription('試験を受けさせたいメンバー').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('試験の種類').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' })),
    new SlashCommandBuilder()
        .setName('exam_result')
        .setDescription('配属試験の結果を一括発表します（人事部専用）')
        .addUserOption(option => option.setName('user1').setDescription('1人目の受験者').setRequired(true))
        .addStringOption(option => option.setName('score1').setDescription('1人目の点数').setRequired(true))
        .addStringOption(option => option.setName('role1').setDescription('1人目の配属先').setRequired(true)),
    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('綺麗なカラー指定つきの埋め込みメッセージを作成・投稿します')
        .addStringOption(option => option.setName('title').setDescription('タイトルを入力').setRequired(true))
        .addStringOption(option => option.setName('body').setDescription('本文を入力').setRequired(true))
        .addStringOption(option => option.setName('color').setDescription('カラーを選択').setRequired(true).addChoices({ name: '🔵 青', value: '#3498DB' }, { name: '🟢 緑', value: '#2ECC71' }, { name: '🔴 赤', value: '#E74C3C' }, { name: '🟡 黄', value: '#F1C40F' }, { name: '🍇 紫', value: '#9B59B6' })),
    new SlashCommandBuilder()
        .setName('server_status')
        .setDescription('常に自動更新される高機能なサーバー状況ステータスパネルを設置します'),
    new SlashCommandBuilder()
        .setName('omikuji')
        .setDescription('今日の運勢を占います！'),
    new SlashCommandBuilder()
        .setName('dice')
        .setDescription('ランダムにサイコロ(1〜100)を振ります'),

    // 🆕 新機能：期限付き自動抽選システムコマンド
    new SlashCommandBuilder()
        .setName('lottery')
        .setDescription('タイトル・本文・メンション・期限を指定して自動抽選会を開催します')
        .addStringOption(option => option.setName('title').setDescription('抽選会のタイトル（例: プレゼント企画）').setRequired(true))
        .addStringOption(option => option.setName('body').setDescription('抽選会の詳しい説明・景品内容など').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('募集する制限時間（分単位で指定。例: 5回で5分後終了）').setRequired(true))
        .addMentionableOption(option => option.setName('mention').setDescription('通知用のメンション（例: @everyone / 役職など）').setRequired(false)),

    // 🆕 新機能：期限付き自動投票システムコマンド
    new SlashCommandBuilder()
        .setName('vote')
        .setDescription('タイトル・本文・選択肢・期限を指定してアンケート投票を開始します')
        .addStringOption(option => option.setName('title').setDescription('アンケートのタイトル').setRequired(true))
        .addStringOption(option => option.setName('body').setDescription('アンケートの詳しい趣旨説明').setRequired(true))
        .addIntegerOption(option => option.setName('duration').setDescription('投票の制限時間（分単位で指定）').setRequired(true))
        .addStringOption(option => option.setName('option1').setDescription('選択肢 1').setRequired(true))
        .addStringOption(option => option.setName('option2').setDescription('選択肢 2').setRequired(true))
        .addStringOption(option => option.setName('option3').setDescription('選択肢 3（任意）').setRequired(false))
        .addStringOption(option => option.setName('option4').setDescription('選択肢 4（任意）').setRequired(false))
        .addStringOption(option => option.setName('option5').setDescription('選択肢 5（任意）').setRequired(false))
        .addMentionableOption(option => option.setName('mention').setDescription('通知用のメンション').setRequired(false))
].map(command => command.toJSON());

// ==========================================
// 4. 各種補助・AI関数定義
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

async function buildServerStatusEmbed(guild) {
    const members = await guild.members.fetch({ withPresences: true });
    const totalMembers = guild.memberCount;
    const botCount = members.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;
    const onlineCount = members.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline').size;
    const offlineCount = humanCount - onlineCount;
    const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;

    return new EmbedBuilder()
        .setTitle(`📊 リアルタイム・サーバー稼働状況`)
        .setDescription(`現在のサーバー全体の統計情報をリアルタイムに同期しています。(1分自動更新)`)
        .setColor('#2ECC71')
        .setThumbnail(guild.iconURL())
        .addFields(
            { name: '👥 メンバー総数', value: `\`\`\`js\n全体: ${totalMembers} 名 (人間: ${humanCount}人 / BOT: ${botCount}台)\n\`\`\``, inline: false },
            { name: '🟢 アクティビティ', value: `👤 **オンライン**: ${onlineCount} 名\n⚫ **オフライン**: ${offlineCount} 名`, inline: true },
            { name: '💬 部屋数', value: `📝 **テキスト**: ${textChannels}\n🔊 **ボイス**: ${voiceChannels}`, inline: true }
        )
        .setTimestamp();
}

// ⏰ 定期監視用タスク (10秒おきに 抽選・投票・試験の期限チェックと、サーバー情報上書き更新)
setInterval(async () => {
    const now = new Date();

    // 1. サーバー状況パネル更新 (1分周期)
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

    // 2. 🆕 抽選システムの自動締め切り・ランダム選出処理
    for (const [msgId, data] of lotteryData.entries()) {
        if (now > data.deadline) {
            lotteryData.delete(msgId);
            try {
                const channel = await client.channels.fetch(data.channelId);
                const msg = await channel.messages.fetch(msgId);
                
                let resultText = "🚫 **参加者がいなかったため、当選者はありませんでした。**";
                let winnerMention = "";

                if (data.participants.length > 0) {
                    // ランダムで1名を厳正に選出
                    const winnerId = data.participants[Math.floor(Math.random() * data.participants.length)];
                    resultText = `🎉 **見事に当選されたラッキーなメンバー:** <@${winnerId}> さん！おめでとうございます！`;
                    winnerMention = `<@${winnerId}>`;
                }

                const endEmbed = new EmbedBuilder()
                    .setTitle(`🏁 【抽選終了】${data.title}`)
                    .setDescription(`${data.body}\n\n━━━━━━━━━━━━━━━━━━━━\n${resultText}`)
                    .setColor('#7F8C8D')
                    .setTimestamp();

                // ボタンを無効化して上書き
                const disabledRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('lottery_join').setLabel(`募集終了 (総エントリー: ${data.participants.length}名)`).setStyle(ButtonStyle.Secondary).setDisabled(true));
                await msg.edit({ embeds: [endEmbed], components: [disabledRow] });

                // 結果をチャンネルにメンション付きで通知
                await channel.send({ content: `🔔 **【抽選結果発表】** ${winnerMention}\n「${data.title}」の自動抽選が完了しました！` });
            } catch (err) { console.error('抽選締め切りエラー:', err); }
        }
    }

    // 3. 🆕 投票システムの自動締め切り・集計処理
    for (const [msgId, data] of voteData.entries()) {
        if (now > data.deadline) {
            voteData.delete(msgId);
            try {
                const channel = await client.channels.fetch(data.channelId);
                const msg = await channel.messages.fetch(msgId);

                // 各選択肢の得票数を集計
                const counts = new Array(data.options.length).fill(0);
                Object.values(data.votes).forEach(optionIdx => { counts[optionIdx]++; });

                const totalVotes = Object.keys(data.votes).length;

                // 結果テキストの構築
                let resultFields = "";
                data.options.forEach((opt, index) => {
                    const count = counts[index];
                    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    const bar = '🟩'.repeat(Math.round(percent / 10)) + '░'.repeat(10 - Math.round(percent / 10));
                    resultFields += `**${index + 1}. ${opt}**\n\`${bar}\` **${count}票** (${percent}%)\n\n`;
                });

                const endVoteEmbed = new EmbedBuilder()
                    .setTitle(`🏁 【投票締め切り】${data.title}`)
                    .setDescription(`${data.body}\n\n📊 **最終集計結果 (総投票数: ${totalVotes}票)**\n━━━━━━━━━━━━━━━━━━━━\n${resultFields}`)
                    .setColor('#7F8C8D')
                    .setTimestamp();

                await msg.edit({ embeds: [endVoteEmbed], components: [] }); // ボタンを完全消去して終了
                await channel.send({ content: `🔔 **【投票終了】** 「${data.title}」の投票受付期間が終了し、集計が確定しました！` });
            } catch (err) { console.error('投票締め切りエラー:', err); }
        }
    }
}, 10000);

// ==========================================
// 5. メッセージイベント
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // しりとりシステム
    const channelId = message.channel.id;
    if (message.content.trim() === 'しりとり') {
        if (!shiritoriGames.has(channelId)) {
            shiritoriGames.set(channelId, 'しりとり');
            return await message.reply('🍎 しりとりゲームを開始しました！最初の単語は「しりとり」です。「**り**」から始まる言葉をどうぞ！\n終了は「しりとり終了」');
        }
    }
    if (shiritoriGames.has(channelId)) {
        const currentWord = shiritoriGames.get(channelId);
        const lastChar = currentWord.slice(-1);
        if (message.content.trim() === 'しりとり終了') { shiritoriGames.delete(channelId); return await message.reply('🏁 終了しました！'); }
        const userText = message.content.trim();
        if (userText.length > 1 && (userText.startsWith(lastChar) || (lastChar === 'ー' && userText.startsWith(currentWord.slice(-2, -1))))) {
            if (userText.endsWith('ん')) { shiritoriGames.delete(channelId); return await message.reply(`💥 「ん」がついたので終了です！`); }
            const botAnswers = { 'あ': 'アイス', 'い': 'いぬ', 'う': 'うみ', 'え': 'えんぴつ', 'お': 'おかね', 'か': 'カメラ', 'き': 'きつね', 'く': 'くるま', 'け': 'ケーキ', 'こ': 'こま', 'さ': 'さくら', 'し': 'しんぶん', 'す': 'すいか', 'せ': 'せっけん', 'そ': 'そら', 'た': 'たぬき', 'ち': 'ちきゅう', 'つ': 'つくえ', 'て': 'てがみ', 'と': 'トマト', 'な': 'なっとう', 'に': 'にんじん', 'ぬ': 'ぬいぐるみ', 'ね': 'ねこ', 'の': 'ノート', 'は': 'ハムスター', 'ひ': 'ひこうき', 'ふ': 'ふうせん', 'へ': 'へび', 'ほ': 'ほん', 'ま': 'まつり', 'み': 'みかん', 'む': 'むし', 'め': 'めがね', 'も': 'もち', 'や': 'やま', 'ゆ': 'ゆき', 'よ': 'よる', 'ら': 'らいおん', 'り': 'りんご', 'る': 'るすばん', 'れ': 'れもん', 'ろ': 'ろけっと', 'わ': 'わに' };
            const botWord = botAnswers[userText.slice(-1)] || 'るすばん';
            if (botWord.endsWith('ん')) { shiritoriGames.delete(channelId); return await message.reply(`🤖 「${botWord}」あ、ボットの負けです！`); }
            shiritoriGames.set(channelId, botWord);
            return await message.reply(`🤖 ボット: 「**${botWord}**」！次は 「**${botWord.slice(-1)}**」！`);
        }
    }

    // 配属試験のDM回収処理
    if (message.channel.type !== ChannelType.DM) return;
    const userId = message.author.id;
    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId); const examInfo = EXAM_DATA[examState.type]; const currentStep = examState.step;
        examState.answers.push({ title: examInfo.questions[currentStep - 1].title, answer: message.content });
        if (currentStep < 7) {
            examState.step += 1; activeExams.set(userId, examState);
            const nextEmbed = new EmbedBuilder().setTitle(`${examInfo.name} - ${examInfo.questions[examState.step - 1].title}`).setDescription(`${examInfo.questions[examState.step - 1].text}`).setColor(examInfo.color);
            return await message.channel.send({ embeds: [nextEmbed] });
        }
        activeExams.delete(userId); userExamSettings.delete(userId);
        await message.channel.send('⏳ **すべての解答を回収しました。最終レポートを作成しています...**');
        let choiceScore = 0;
        for (let i=0; i<4; i++) { if (examState.answers[i].answer.toUpperCase().includes('B')) choiceScore += 25; }
        let aiEvaluation = await askAI("最高人事責任者AI", `解答審査:\n1問:${examState.answers[0].answer}\n5問:${examState.answers[4].answer}`);
        if (!aiEvaluation) { aiEvaluation = `【AI採点結果】: 選択問集計 ${choiceScore}点 / 100点\n【推奨する配属先】: 🛡️ モデレーター\n【寸評】: 通信混雑のため、選択問題のみを自動集計しました。記述内容は人事部でご確認ください。`; }
        const examChannelId = process.env.EXAM_CHANNEL_ID;
        if (examChannelId) {
            try {
                const examChannel = await client.channels.fetch(examChannelId);
                const finalReport = new EmbedBuilder().setTitle(`🏁 配属試験 最終提出レポート: ${examInfo.name}`).setColor(examInfo.color).setDescription(`👤 **受験ユーザー:** <@${message.author.id}>`)
                    .addFields({ name: '📥 【提出された全回答一覧】', value: `**第1問:** ${examState.answers[0].answer}\n**第2問:** ${examState.answers[1].answer}\n**第3問:** ${examState.answers[2].answer}\n**第4問:** ${examState.answers[3].answer}\n**第5問:** ${examState.answers[4].answer}\n**第6問:** ${examState.answers[5].answer}\n**第7問:** ${examState.answers[6].answer}` }, { name: '🤖 総合人事判定スコア・配属判定', value: aiEvaluation }, { name: '📘 【公式】選択問題正解 ＆ 記述の回答例', value: examInfo.guide }).setTimestamp();
                await examChannel.send({ embeds: [finalReport] });
            } catch (e) {}
        }
        return await message.channel.send('🎉 **人事部への解答転送がすべて完了しました！お疲れ様でした！**');
    }
});

// ==========================================
// 6. インタラクションイベント (コマンド＆ボタンクリック)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    // 🍏 ボタンコンポーネントのクリックイベント
    if (interaction.isButton()) {
        const { customId, message, user } = interaction;

        // 🆕 抽選への参加ボタン処理
        if (customId === 'lottery_join') {
            const data = lotteryData.get(message.id);
            if (!data) return interaction.reply({ content: '❌ この抽選データは見つからないか、既に終了しています。', ephemeral: true });
            
            if (data.participants.includes(user.id)) {
                return interaction.reply({ content: '💡 あなたは既にこの抽選会にエントリーしています！追加登録は不要です。', ephemeral: true });
            }
            
            data.participants.push(user.id);
            lotteryData.set(message.id, data);

            // 募集用埋め込みのエントリー人数表示を更新
            const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                .setFields({ name: '👥 現在のエントリー人数', value: `\`${data.participants.length}\` 名が参加中！` });
            await message.edit({ embeds: [updatedEmbed] });

            return interaction.reply({ content: '🎉 抽選エントリーが正常に完了しました！当選発表をお待ちください。', ephemeral: true });
        }

        // 🆕 投票ボタンの処理
        if (customId.startsWith('vote_opt_')) {
            const optionIndex = parseInt(customId.replace('vote_opt_', ''), 10);
            const data = voteData.get(message.id);
            if (!data) return interaction.reply({ content: '❌ この投票は終了しているか、無効です。', ephemeral: true });

            if (data.votes[user.id] !== undefined) {
                return interaction.reply({ content: '⚠️ すでに投票済みです。アンケートはお一人様1回までとなります。', ephemeral: true });
            }

            // 投票を記録
            data.votes[user.id] = optionIndex;
            voteData.set(message.id, data);

            return interaction.reply({ content: `✅ 「${data.options[optionIndex]}」への投票を受け付けました！`, ephemeral: true });
        }

        // ロールパネル用
        if (customId.startsWith('role_')) {
            const roleId = customId.replace('role_', ''); const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: 'ロールが見つかりません。', ephemeral: true });
            if (interaction.member.roles.cache.has(roleId)) { await interaction.member.roles.remove(role); await interaction.reply({ content: `❌ ロール ${role.name} を外しました。`, ephemeral: true }); }
            else { await interaction.member.roles.add(role); await interaction.reply({ content: `✅ ロール ${role.name} を付与しました。`, ephemeral: true }); }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // 🆕 新機能：期限付き自動抽選コマンドの処理
    if (commandName === 'lottery') {
        const title = interaction.options.getString('title');
        const body = interaction.options.getString('body');
        const duration = interaction.options.getInteger('duration');
        const mention = interaction.options.getMentionable('mention');

        const deadline = new Date(Date.now() + duration * 60000);
        const ts = Math.floor(deadline.getTime() / 1000);

        const lotteryEmbed = new EmbedBuilder()
            .setTitle(`🎉 【抽選開催】${title}`)
            .setDescription(`${body}\n\n━━━━━━━━━━━━━━━━━━━━\n⏰ **終了期限**: <t:${ts}:F> (<t:${ts}:R>)`)
            .addFields({ name: '👥 現在のエントリー人数', value: `\`0\` 名が参加中！` })
            .setColor('#F1C40F')
            .setFooter({ text: '下のボタンを押してエントリー！' });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('lottery_join').setLabel('🎉 参加する').setStyle(ButtonStyle.Success));

        let mentionContent = mention ? `${mention}` : "";
        const replyMsg = await interaction.channel.send({ content: mentionContent, embeds: [lotteryEmbed], components: [row] });
        
        lotteryData.set(replyMsg.id, { title, body, deadline, participants: [], mention, channelId: interaction.channel.id });
        return interaction.reply({ content: '✅ 抽選パネルを設置しました！', ephemeral: true });
    }

    // 🆕 新機能：期限付き自動投票コマンドの処理
    if (commandName === 'vote') {
        const title = interaction.options.getString('title');
        const body = interaction.options.getString('body');
        const duration = interaction.options.getInteger('duration');
        const mention = interaction.options.getMentionable('mention');

        const options = [];
        for (let i = 1; i <= 5; i++) {
            const opt = interaction.options.getString(`option${i}`);
            if (opt) options.push(opt);
        }

        const deadline = new Date(Date.now() + duration * 60000);
        const ts = Math.floor(deadline.getTime() / 1000);

        let optionsText = "";
        const buttons = [];
        options.forEach((opt, index) => {
            optionsText += `**${index + 1}️⃣**: ${opt}\n`;
            buttons.push(new ButtonBuilder().setCustomId(`vote_opt_${index}`).setLabel(`${index + 1}️⃣`).setStyle(ButtonStyle.Primary));
        });

        const voteEmbed = new EmbedBuilder()
            .setTitle(`📊 【アンケート投票】${title}`)
            .setDescription(`${body}\n\n📌 **選択肢一覧**:\n${optionsText}\n━━━━━━━━━━━━━━━━━━━━\n⏰ **投票期限**: <t:${ts}:F> (<t:${ts}:R>)`)
            .setColor('#3498DB')
            .setFooter({ text: '任意の数字ボタンを押して一票を投じてください！' });

        const row = new ActionRowBuilder().addComponents(buttons);
        let mentionContent = mention ? `${mention}` : "";
        const replyMsg = await interaction.channel.send({ content: mentionContent, embeds: [voteEmbed], components: [row] });

        voteData.set(replyMsg.id, { title, body, deadline, options, votes: {}, mention, channelId: interaction.channel.id });
        return interaction.reply({ content: '✅ 投票アンケートを開始しました！', ephemeral: true });
    }

    // embed作成コマンド
    if (commandName === 'embed') {
        const title = interaction.options.getString('title'); const body = interaction.options.getString('body'); const colorHex = interaction.options.getString('color');
        const userEmbed = new EmbedBuilder().setTitle(title).setDescription(body).setColor(colorHex).setTimestamp();
        await interaction.channel.send({ embeds: [userEmbed] });
        return interaction.reply({ content: '✅ 送信完了。', ephemeral: true });
    }

    // サーバー状況パネル設置
    if (commandName === 'server_status') {
        await interaction.deferReply({ ephemeral: true });
        try {
            const embed = await buildServerStatusEmbed(interaction.guild);
            const statusPanelMessage = await interaction.channel.send({ embeds: [embed] });
            serverStatusChannelId = interaction.channel.id; serverStatusMessageId = statusPanelMessage.id;
            return interaction.editReply({ content: '✅ 24時間自動更新ステータスパネルを設置しました！' });
        } catch (err) { return interaction.editReply({ content: '❌ 設置失敗。' }); }
    }

    // おみくじ・ダイス・その他
    if (commandName === 'omikuji') {
        const fortunes = ['大吉 🌟', '吉 ✨', '中吉 🎵', '小吉 💎', '末吉 🍃'];
        const omikujiEmbed = new EmbedBuilder().setTitle(`🔮 今日の運勢`).setDescription(`結果: **${fortunes[Math.floor(Math.random() * fortunes.length)]}**`).setColor('#FF69B4').setTimestamp();
        return interaction.reply({ embeds: [omikujiEmbed] });
    }
    if (commandName === 'dice') {
        return interaction.reply({ content: `🎲 出目: **${Math.floor(Math.random() * 100) + 1}** / 100` });
    }
    if (commandName === 'status') {
        currentStatus = interaction.options.getString('type'); await updateStatusMessage();
        return interaction.reply({ content: 'ステータスを更新しました。', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
