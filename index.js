const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const express = require('express');
const axios = require('axios');

// ==========================================
// 1. Webサーバーの設定 (UptimeRobot / Render 用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('Bot is running!'); });
app.listen(PORT, () => { console.log(`Web server is listening on port ${PORT}`); });

// ==========================================
// 2. 初期設定・環境変数・グローバル管理データ
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

const HR_ROLE_NAME = "人事部【Human Resources】"; 
const ALLOWED_ROLE_NAME = "ボット管理";

const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

let currentStatus = "online";
let statusMessageId = null;

const activeExams = new Map();
const userExamSettings = new Map();
const forumToUser = new Map();
const userToForum = new Map();

// 全7問の試験問題データ
const EXAM_DATA = {
    moderator: {
        name: '🛡️ モデレーター試験',
        color: '#3498DB',
        questions: [
            { type: 'choice', title: '【第1問（選択）】ルール違反の確認', text: '一般ユーザーが「言葉遣いのルール」に明確に違反しているのを発見しました。最初にとるべき行動として適切なものはどれですか？\n\nA: 何も言わずに即座にサーバーからBANする\nB: 公開チャンネル、またはDMで注意・警告を与える\nC: 見て見ぬふりをする' },
            { type: 'choice', title: '【第2問（選択）】大規模な荒らしへの対処', text: '複数のアカウントが同時に無意味な連投（スパム）を始めました。最優先すべき対応はどれですか？\n\nA: 荒らしユーザー全員に口頭で注意する\nB: 該当チャンネルの書き込み権限を一時的にロックし、適切にキック・BAN等の対処を行う\nC: 静観する' },
            { type: 'choice', title: '【第3問（選択）】個人情報の取り扱い', text: 'メンバーが誤って他人の本名や写真を送信してしまいました。適切な対応はどれですか？\n\nA: 放置する\nB: すぐにそのメッセージを削除し、本人に注意を促すとともに他の運営に報告する\nC: スクリーンショットを撮って拡散する' },
            { type: 'choice', title: '【第4問（選択）】権限の悪用について', text: '他のモデレーターが権限を悪用し、一般ユーザーを不当にキックしているのを目撃しました。どうすべきですか？\n\nA: 自分も一緒になってキックに加わる\nB: 独断で動かず、ログなどの証拠を確保してすぐに上の管理者に報告・相談する\nC: 喧嘩になるのが嫌なので無視する' },
            { type: 'essay', title: '【第5問（記述）】ユーザー同士の口論への対応', text: '常連ユーザー同士がチャンネル内で激しい口論（喧嘩）を始めてしまいました。あなたはモデレーターとしてどのように声をかけ、どのようにこのトラブルを収めますか？対応方針を具体的に記述してください。' },
            { type: 'essay', title: '【第6問（記述）】新規ユーザーへの配慮', text: 'サーバーに入りたての新規ユーザーが、ルールをよく知らずに雑談禁止のチャンネルで話し始めてしまいました。威圧感を与えずにルールを教えるための案内文章を考えて記述してください。' },
            { type: 'essay', title: '【第7問（記述）】理想のモデレーター像', text: 'あなたがこのサーバーのモデレーターとして採用された場合、どのような点に気をつけて活動したいですか？あなたの強みや意気込みを自由に記述してください。' }
        ],
        // 最下部に出力する正解と記述の解説・回答例
        guide: `📊 **【モデレーター試験 正解＆回答例解説】**\n\n**■ 選択問題（第1〜4問）の正解**\n全て **「B」** が正解です。\n\n**■ 記述問題の評価基準・回答例**\n**・第5問 (ユーザー間の口論対処)**\n当事者双方を落ち着かせるため、一旦冷静になるよう公開通告するか、個別のスレッドやDMに誘導して論点を整理できる対応が理想です。感情的にどちらかを一方的に加害者扱いしない中立性がポイントです。\n**・第6問 (新規への案内文例)**\n「ご参加ありがとうございます！こちらのチャンネルは〇〇専用となっているため、雑談はぜひこちらの【#雑談チャンネル】でお楽しみください！」といった、歓迎しつつ優しく誘導する文章が適切です。\n**・第7問 (意気込み・強み)**\n主観を挟まず客観的なログをベースに対応できる点や、定期的なインアクティブ見回りへの意欲など、コミュニティ維持への熱意を評価します。`
    },
    admin: {
        name: '👑 管理者試験',
        color: '#E74C3C',
        questions: [
            { type: 'choice', title: '【第1問（選択）】権限設定のトラブル', text: '新しく作成したチャンネルが一般ユーザーに見えてしまっていると報告を受けました。最初に確認すべき項目はどれですか？\n\nA: チャンネルの閲覧権限（@everyone の設定）が正しく拒否されているか確認する\nB: 原因がわからないのでサーバー自体を削除して作り直す\nC: 放置する' },
            { type: 'choice', title: '【第2問（選択）】ボットの不具合対応', text: 'サーバー内で稼働している主要ボットが突然コマンドに反応しなくなりました。優先すべき対応手順はどれですか？\n\nA: ボットの役職や管理権限をすべて剥奪する\nB: ボットのステータスや開発元の情報を確認し、ホスティングプラットフォームのログを見て再起動を試みる\nC: 他の管理者が直してくれるまで待つ' },
            { type: 'choice', title: '【第3問（選択）】他の運営メンバーとの衝突', text: '運営方針を巡って、あなたと他の管理者の間で意見が真っ向から対立してしまいました。どう行動すべきですか？\n\nA: 独断でその管理者の権限を剥奪して追放する\nB: お互いの意見のメリット・デメリットを整理し、他のメンバーも交えて冷静に話し合って解決策を決める\nC: 運営を辞めてサーバーを荒らす' },
            { type: 'choice', title: '【第4問（選択）】セキュリティ対策', text: 'サーバーのセキュリティレベル（認証レベル）を変更する際、最も考慮すべきバランスはどれですか？\n\nA: 荒らしを完全に防ぐために一番厳しい設定のまま固定し、新規が入れなくなっても気にしない\nB: 荒らし対策の安全性と、新規ユーザーの参加しやすさ（利便性）のバランスを考慮して適切なレベルを選ぶ\nC: 設定が面倒なので一番低い設定にする' },
            { type: 'essay', title: '【第5問（記述）】サーバーの活性化企画', text: 'サーバー内のアクティブユーザーを今よりも増やし、コミュニティをより活発にするために、あなたが管理者になったら実施したい「新しいイベント」「企画」「改善案」などを具体的に記述してください。' },
            { type: 'essay', title: '【第6問（記述）】トラブル発生時の危機管理', text: 'サーバーが大規模な荒らしアカウントの襲撃（レイド）に遭い、メンバーが不安に陥っています。復旧手順やメンバーへのアナウンスなど、どのように迅速な対応を行いますか？危機管理方針を記述してください。' },
            { type: 'essay', title: '【第7問（記述）】長期的なサーバー運営のビジョン', text: 'あなたが管理者として半年〜1年後にこのサーバーをどのようなコミュニティに成長させたいですか？あなたの長期的なビジョンや目標を自由に記述してください。' }
        ],
        // 最下部に出力する正解と記述の解説・回答例
        guide: `📊 **【管理者試験 正解＆回答例解説】**\n\n**■ 選択問題（第1〜4問）の正解**\n全て **「B」** が正解です。\n\n**■ 記述問題の評価基準・回答例**\n**・第5問 (活性化企画案)**\n単なる雑談だけでなく「定期告知」「ゲームイベント」「役職の段階報酬」など、継続して人が定着する具体的なシステム改修案があるか、企画力・実行力を確認します。\n**・第6問 (レイド時の危機管理)**\nBotの認証制限引き上げ、問題アカウントの一括BAN、荒らされたログの削除、一般メンバー向けに「現在復旧対応中です」とアナウンスしてパニックを防ぐという、手順の迅速性と透明性が評価ポイントです。\n**・第7問 (長期ビジョン)**\nサーバーの規模拡大や運営体制の自動化・属人化からの脱却など、一歩引いたマクロな目線でサーバーの長寿化・健全化を設計できているかを見ます。`
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
        .addUserOption(option => option.setName('user').setDescription('相手').setRequired(false))
        .addStringOption(option => option.setName('user_id').setDescription('ID').setRequired(false)),
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
        .setDescription('指定したユーザーのDMに配属試験を送信します。提出期限も同時に設定可能です（人事部専用）')
        .addUserOption(option => option.setName('user').setDescription('試験を受けさせたいメンバー').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('送信する試験の種類').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' }))
        .addIntegerOption(option => option.setName('year').setDescription('期限の【年】を指定 (例: 2026 / 省略で無期限)').setRequired(false))
        .addIntegerOption(option => option.setName('month').setDescription('期限の【月】を指定 (1〜12)').setRequired(false))
        .addIntegerOption(option => option.setName('day').setDescription('期限の【日】を指定 (1〜31)').setRequired(false))
        .addIntegerOption(option => option.setName('hour').setDescription('期限の【時】を指定 (0〜23)').setRequired(false))
        .addIntegerOption(option => option.setName('minute').setDescription('期限の【分】を指定 (0〜59)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('exam_result')
        .setDescription('配属試験の結果を一括発表します（人事部専用・最大3名まで同時発表可）')
        .addUserOption(option => option.setName('user1').setDescription('1人目の受験者（メンションされます）').setRequired(true))
        .addStringOption(option => option.setName('score1').setDescription('1人目の点数 (例: 85点)').setRequired(true))
        .addStringOption(option => option.setName('role1').setDescription('1人目の配属先 (例: 👑 管理者 / 🛡️ モデレーター)').setRequired(true))
        .addUserOption(option => option.setName('user2').setDescription('2人目の受験者（任意）').setRequired(false))
        .addStringOption(option => option.setName('score2').setDescription('2人目の点数（任意）').setRequired(false))
        .addStringOption(option => option.setName('role2').setDescription('2人目の配属先（任意）').setRequired(false))
        .addUserOption(option => option.setName('user3').setDescription('3人目の受験者（任意）').setRequired(false))
        .addStringOption(option => option.setName('score3').setDescription('3人目の点数（任意）').setRequired(false))
        .addStringOption(option => option.setName('role3').setDescription('3人目の配属先（任意）').setRequired(false))
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
    } catch (error) { console.error(error); }
}

async function sendToLogChannel(embed) {
    const logChannelId = process.env.LOG_CHANNEL_ID;
    if (!logChannelId) return;
    try { const logChannel = await client.channels.fetch(logChannelId); if (logChannel) await logChannel.send({ embeds: [embed] }); } catch (error) {}
}

function generateProgressEmbed(examState, userTag) {
    const totalQuestions = 7;
    const answeredCount = examState.answers.length;
    let choiceAnswered = 0, essayAnswered = 0;

    examState.answers.forEach((ans, index) => {
        if (index < 4) choiceAnswered++; else essayAnswered++;
    });

    const choicePct = Math.round((choiceAnswered / 4) * 100);
    const essayPct = Math.round((essayAnswered / 3) * 100);
    const totalPct = Math.round((answeredCount / totalQuestions) * 100);

    const barLength = 10;
    const filledLength = Math.round((answeredCount / totalQuestions) * barLength);
    const emptyLength = barLength - filledLength;
    const gaugeBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);

    return new EmbedBuilder()
        .setTitle('📊 試験進行状況アナリティクス')
        .setColor('#9B59B6')
        .setDescription(`**受験者:** ${userTag}\n\n**全体進捗ゲージ:**\n\`[${gaugeBar}]\` **${totalPct}%** (${answeredCount} / ${totalQuestions} 問完了)`)
        .addFields(
            { name: '📝 選択問題 (第1〜4問)', value: `\`${choicePct}%\` 完了 (${choiceAnswered} / 4)`, inline: true },
            { name: '✍️ 記述問題 (第5〜7問)', value: `\`${essayPct}%\` 完了 (${essayAnswered} / 3)`, inline: true }
        )
        .setTimestamp();
}

async function askAI(systemPrompt, userPrompt) {
    try {
        const response = await axios.post('https://chateverywhere.app/api/chat/', {
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            model: "llama-3.1-70b"
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        return response.data?.choices?.[0]?.message?.content || null;
    } catch (error) {
        try {
            const backupResponse = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', {
                model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
            }, { timeout: 10000 });
            return backupResponse.data?.choices?.[0]?.message?.content || null;
        } catch (backupError) { return null; }
    }
}

setInterval(async () => {
    const now = new Date();
    for (const [userId, settings] of userExamSettings.entries()) {
        if (settings.deadline && now > settings.deadline) {
            if (activeExams.has(userId)) {
                activeExams.delete(userId);
                try {
                    const targetUser = await client.users.fetch(userId);
                    if (targetUser) {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle('⏰ 【重要】試験の提出期限が終了しました')
                            .setDescription('人事部より指定されていた試験の回答提出期限を過ぎたため、**試験を自動的に終了しました。**\nこれ以上の回答受付や人事部への質問送信はできません。ご了承ください。')
                            .setColor('#E74C3C')
                            .setTimestamp();
                        await targetUser.send({ embeds: [timeoutEmbed] });
                    }
                } catch (dmErr) {}
            }
            if (userToForum.has(userId)) {
                const forumId = userToForum.get(userId);
                try { const thread = await client.channels.fetch(forumId); if (thread) await thread.delete('提出期限が切れたため自動削除しました。'); } catch (e) {}
                userToForum.delete(userId); forumToUser.delete(forumId);
            }
            userExamSettings.delete(userId);
        }
    }
}, 3000);

// ==========================================
// 5. イベントハンドラー
// ==========================================
client.once('ready', async () => {
    console.log(`${client.user.tag} が起動しました。`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try { await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands }); } catch (error) { console.error(error); }
    currentStatus = "online";
    await updateStatusMessage();
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.channel.isThread() && forumToUser.has(message.channel.id)) {
        const targetUserId = forumToUser.get(message.channel.id);
        try {
            const targetUser = await client.users.fetch(targetUserId);
            if (targetUser) {
                const relayEmbed = new EmbedBuilder().setTitle('💬 人事部からの回答・メッセージ').setDescription(message.content || '*(ファイル等)*').setColor('#2ECC71').setTimestamp();
                await targetUser.send({ embeds: [relayEmbed] }); await message.react('✅'); 
            }
        } catch (e) { await message.reply('❌ ユーザーへのDM転送に失敗しました。'); }
        return;
    }

    if (message.channel.type !== ChannelType.DM) return;
    const userId = message.author.id;

    const userSettings = userExamSettings.get(userId) || { deadline: null, dmMsgId: null, logMsgId: null };
    if (userSettings.deadline && new Date() > userSettings.deadline) {
        if (activeExams.has(userId)) activeExams.delete(userId);
        return await message.channel.send('❌ **提出期限が過ぎています。これ以上回答や質問を送信することはできません。**');
    }

    if (message.content.trim() === '質問' && activeExams.has(userId)) {
        if (userToForum.has(userId)) return await message.channel.send('💡 すでに質問モードに入っています。');
        const forumChannelId = process.env.FORUM_CHANNEL_ID;
        if (!forumChannelId) return await message.channel.send('❌ フォーラム設定が整っていません。');
        try {
            const forumChannel = await client.channels.fetch(forumChannelId);
            if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
                const thread = await forumChannel.threads.create({
                    name: `❓ 質問: ${message.author.username} からの試験問い合わせ`,
                    autoArchiveDuration: 60,
                    message: { content: `🔔 **受験者 (${message.author.tag} / ID: ${userId}) からの質問スレッドです。**\nこのスレッド内に発言すると、自動的にユーザーのDMへ転送されます。` }
                });
                userToForum.set(userId, thread.id); forumToUser.set(thread.id, userId);
                return await message.channel.send('✨ **人事部直通の質問フォーラムが新規作成されました！**\nメッセージを入力すると転送されます。終了時は「**質問終了**」と送信してください。');
            }
        } catch (error) { return await message.channel.send('❌ 質問フォーラムの作成に失敗しました。'); }
    }

    if (message.content.trim() === '質問終了' && activeExams.has(userId)) {
        if (!userToForum.has(userId)) return await message.channel.send('💡 現在質問モードではありません。');
        const threadId = userToForum.get(userId);
        try { const thread = await client.channels.fetch(threadId); if (thread) await thread.delete(); } catch (e) {}
        userToForum.delete(userId); forumToUser.delete(threadId);

        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];
        const currentQuestion = examInfo.questions[examState.step - 1];

        const resumeEmbed = new EmbedBuilder().setTitle(`↩️ 試験回答モードに戻りました`).setDescription(`以下の問題への【回答】を入力して送信してください。\n\n**${currentQuestion.title}**\n${currentQuestion.text}`).setColor(examInfo.color);
        return await message.channel.send({ embeds: [resumeEmbed] });
    }

    if (userToForum.has(userId)) {
        const threadId = userToForum.get(userId);
        try { const thread = await client.channels.fetch(threadId); if (thread) { await thread.send(`📬 **[ユーザーからの質問]:** ${message.content}`); await message.react('✉️'); } } catch (e) { userToForum.delete(userId); forumToUser.delete(threadId); }
        return; 
    }

    // 試験問題の回収メイン処理
    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examType = examState.type];
        const currentStep = examState.step; 

        examState.answers.push({ title: examInfo.questions[currentStep - 1].title, answer: message.content });

        // 進行中の1個の埋め込みをアップデート
        const progressEmbed = generateProgressEmbed(examState, message.author.tag);
        let msgIds = userExamSettings.get(userId) || { deadline: null, dmMsgId: null, logMsgId: null };

        if (msgIds.dmMsgId) {
            try { const existingDmMsg = await message.channel.messages.fetch(msgIds.dmMsgId); await existingDmMsg.edit({ embeds: [progressEmbed] }); } catch (e) { const newDmMsg = await message.channel.send({ embeds: [progressEmbed] }); msgIds.dmMsgId = newDmMsg.id; }
        } else { const newDmMsg = await message.channel.send({ embeds: [progressEmbed] }); msgIds.dmMsgId = newDmMsg.id; }

        const examChannelId = process.env.EXAM_CHANNEL_ID;
        if (examChannelId) {
            try {
                const examChannel = await client.channels.fetch(examChannelId);
                if (examChannel) {
                    if (msgIds.logMsgId) {
                        try { const existingLogMsg = await examChannel.messages.fetch(msgIds.logMsgId); await existingLogMsg.edit({ embeds: [progressEmbed] }); } catch (e) { const newLogMsg = await examChannel.send({ embeds: [progressEmbed] }); msgIds.logMsgId = newLogMsg.id; }
                    } else { const newLogMsg = await examChannel.send({ embeds: [progressEmbed] }); msgIds.logMsgId = newLogMsg.id; }
                }
            } catch (e) {}
        }
        userExamSettings.set(userId, msgIds);

        if (currentStep < 7) {
            examState.step += 1;
            activeExams.set(userId, examState);
            const nextQuestion = examInfo.questions[examState.step - 1];
            const nextEmbed = new EmbedBuilder().setTitle(`${examInfo.name} - ${nextQuestion.title}`).setDescription(`${nextQuestion.text}\n\n*※そのまま回答を入力して送信してください。*`).setColor(examInfo.color);
            return await message.channel.send({ embeds: [nextEmbed] });
        }

        // 全問終了処理
        activeExams.delete(userId);
        userExamSettings.delete(userId); 

        await message.channel.send('⏳ **全7問の回答をすべて回収しました！現在、高性能AIが適正度を厳密に分析・配属判定をしています。このまま15秒ほどお待ちください...**');

        const systemPrompt = "最高人事責任者として厳格に採点と配属先（管理者への抜擢含む）をジャッジするAI。";
        const prompt = `あなたはDiscordサーバーの最高人事責任者AIです。受験者から送られた全7問の回答を厳格に審査し、100点満点で採点した上で、最適な【最終配属先】を決定してください。

【採点ルール】
・選択問題（第1〜4問）の正解はすべて「B」です。それ以外や無意味な入力は容赦なく0点（大幅減点）にしてください。
・記述問題（第5〜7問）に「あああ」等の手抜きや無意味な入力があった場合も、その問題は0点にしてください。

【配属判定ルール】
回答内容が非常に優秀で、高いリーダーシップや危機管理能力、コミュニティ活性化の視点を持っていると判断した場合、受けている試験の種類に関わらず「👑 管理者」への飛び級・抜擢配属（または管理者候補生として採用）を決定してください。
基準を満たしているが一般的な対応力の場合は「🛡️ モデレーター」への配属とし、手抜き回答や正解率が著しく低い場合は「❌ 不採用」としてください。

【元々の試験名】: ${examInfo.name}
【第1問回答】: ${examState.answers[0].answer}
【第2問回答】: ${examState.answers[1].answer}
【第3問回答】: ${examState.answers[2].answer}
【第4問回答】: ${examState.answers[3].answer}
【第5問（記述）】: ${examState.answers[4].answer}
【第6問（記述）】: ${examState.answers[5].answer}
【第7問（記述）】: ${examState.answers[6].answer}

上記を確認し、必ず以下のフォーマットのみで厳しく判定を出力してください。他の余計な前置きや文言は出力しないでください。
【AI採点結果】: ○○点 / 100点
【推奨する配属先】: （「👑 管理者」「🛡️ モデレーター」「❌ 不採用」のいずれかを必ず明記）
【適正評価・配属理由寸評】: （選択の正誤や記述の質、なぜその配属先に決定したかの理由を記述）`;

        let aiEvaluation = await askAI(systemPrompt, prompt);
        if (!aiEvaluation) {
            aiEvaluation = `【AI採点結果】: 判定処理完了\n【推奨する配属先】: 🛡️ モデレーター (手動確認)\n【適正評価・配属理由寸評】: 自動セーフティにより算出。記述内容を人事部で最終ジャッジしてください。`;
        }

        // 📊 要望に沿って新設計された、全解答・点数・理由・解説の最終レポート埋め込み
        if (examChannelId) {
            try {
                const examChannel = await client.channels.fetch(examChannelId);
                if (examChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle(`🏁 配属試験 最終レポート: ${examInfo.name}`)
                        .setColor(examInfo.color)
                        .setDescription(`👤 **受験ユーザー:** <@${message.author.id}> (${message.author.tag} / ID: ${message.author.id})`)
                        .addFields(
                            { name: '📥 【受験者の実際の全回答】', value: `
**第1問（選択）:** ${examState.answers[0].answer}
**第2問（選択）:** ${examState.answers[1].answer}
**第3問（選択）:** ${examState.answers[2].answer}
**第4問（選択）:** ${examState.answers[3].answer}
**第5問（記述）:** ${examState.answers[4].answer}
**第6問（記述）:** ${examState.answers[5].answer}
**第7問（記述）:** ${examState.answers[6].answer}
`, inline: false },
                            { name: '🤖 AIによる総合人事判定・最終配属先候補', value: aiEvaluation, inline: false },
                            { name: '📘 【人事部用：試験問題の正解＆記述回答例】', value: examInfo.guide, inline: false }
                        )
                        .setTimestamp();
                    await examChannel.send({ embeds: [embed] });
                }
            } catch (e) { console.error('最終レポート送信エラー:', e); }
        }
        return await message.channel.send('🎉 **無事にすべての解答が人事部へ転送されました。試験はこれで終了です！お疲れ様でした！**');
    }

    const logEmbed = new EmbedBuilder().setTitle('📩 ユーザーからのDM受信').setDescription(message.content || '*(テキストなし)*').setColor('#FF9900').addFields({ name: '送信ユーザー', value: `${message.author.tag} (${message.author.id})` }).setTimestamp();
    await sendToLogChannel(logEmbed);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (['status', 'rolepanel', 'dm_say'].includes(commandName)) {
        const hasRole = interaction.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
        if (!hasRole) return interaction.reply({ content: `⚠️ 権限がありません。`, ephemeral: true });
    }

    if (commandName === 'status') {
        currentStatus = interaction.options.getString('type'); await updateStatusMessage();
        return interaction.reply({ content: `ステータスを更新しました。`, ephemeral: true });
    }

    if (commandName === 'rolepanel') {
        const text = interaction.options.getString('text'); const role = interaction.options.getRole('role');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role_${role.id}`).setLabel(`${role.name} を付ける/外す`).setStyle(ButtonStyle.Primary));
        await interaction.channel.send({ content: text, components: [row] });
        return interaction.reply({ content: 'ロールパネルを作成しました。', ephemeral: true });
    }

    if (commandName === 'dm_say') {
        const title = interaction.options.getString('title'); const description = interaction.options.getString('description');
        const targetUser = interaction.options.getUser('user'); const targetUserId = interaction.options.getString('user_id');
        let user = targetUser; if (!user && targetUserId) { try { user = await client.users.fetch(targetUserId.trim()); } catch (e) {} }
        if (!user) return interaction.reply({ content: '❌ 送信相手を指定してください。', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
            const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#5865F2').setTimestamp();
            await user.send({ embeds: [embed] }); return interaction.editReply({ content: `✅ DMを送信しました。` });
        } catch (error) { return interaction.editReply({ content: `❌ 送信失敗。` }); }
    }

    if (commandName === 'ai') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        const reply = await askAI("親切な日本語のアシスタント。", question);
        if (reply) return await interaction.editReply(`**質問:** ${question}\n\n**AI:** ${reply}`);
        else return await interaction.editReply("⚠️ AIシステムが混み合っています。もう一度お試しください。");
    }

    if (commandName === 'janken') {
        const userHand = interaction.options.getString('hand'); const hands = ['goo', 'choki', 'paa'];
        const botHand = hands[Math.floor(Math.random() * hands.length)];
        const handLabels = { goo: '✊ グー', choki: '✌️ チョキ', paa: '🖐️ パー' };
        let result = userHand === botHand ? "🤝 あいこ！" : ((userHand==='goo'&&botHand==='choki')||(userHand==='choki'&&botHand==='paa')||(userHand==='paa'&&botHand==='goo')) ? "🎉 あなたの勝ち！" : "👾 ボットの勝ち！";
        return interaction.reply({ content: `あなた: ${handLabels[userHand]}\nボット: ${handLabels[botHand]}\n\n${result}` });
    }

    if (commandName === 'exam') {
        const isHR = interaction.member.roles.cache.some(role => role.name === HR_ROLE_NAME);
        if (!isHR) return interaction.reply({ content: `⚠️ このコマンドは「${HR_ROLE_NAME}」ロールを持つ人だけが実行可能です。`, ephemeral: true });

        const targetUser = interaction.options.getUser('user');
        const examType = interaction.options.getString('type');
        const examInfo = EXAM_DATA[examType];
        const year = interaction.options.getInteger('year');
        let calculatedDeadline = null;

        if (year && year > 0) {
            const now = new Date();
            const month = interaction.options.getInteger('month') ?? (now.getMonth() + 1);
            const day = interaction.options.getInteger('day') ?? now.getDate();
            const hour = interaction.options.getInteger('hour') ?? 23;
            const minute = interaction.options.getInteger('minute') ?? 59;
            calculatedDeadline = new Date(year, month - 1, day, hour, minute, 0);
            if (isNaN(calculatedDeadline.getTime())) return interaction.reply({ content: '❌ 無効な日付項目が含まれています。', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            activeExams.set(targetUser.id, { type: examType, step: 1, answers: [] });
            userExamSettings.set(targetUser.id, { deadline: calculatedDeadline, dmMsgId: null, logMsgId: null });

            let deadlineNotice = "なし";
            if (calculatedDeadline) { const ts = Math.floor(calculatedDeadline.getTime() / 1000); deadlineNotice = `<t:${ts}:F> (<t:${ts}:R>)`; }

            const q1Embed = new EmbedBuilder()
                .setTitle(`📝 ${examInfo.name} の受講案内`)
                .setDescription(`人事部より配属試験が発行されました。**全7問**あります。\n\n**⏰ 提出期限**: ${deadlineNotice}\n\n*※試験中、わからないことがあれば、このDMに「**質問**」とだけ送信すると人事部と匿名で会話できます。*\n\n**${examInfo.questions[0].title}**\n${examInfo.questions[0].text}\n\n*※このメッセージにそのまま回答を打ち込んで送信してください。*`)
                .setColor(examInfo.color).setTimestamp();

            await targetUser.send({ embeds: [q1Embed] });
            let replyText = `✅ ${targetUser.tag} のDMへ「${examInfo.name}」を送信しました。`;
            if (calculatedDeadline) replyText += ` (提出期限を設定しました)`;
            return interaction.editReply({ content: replyText });
        } catch (error) {
            activeExams.delete(targetUser.id); userExamSettings.delete(targetUser.id);
            return interaction.editReply({ content: `❌ ${targetUser.tag} へDMを送信できませんでした。` });
        }
    }

    if (commandName === 'exam_result') {
        const isHR = interaction.member.roles.cache.some(role => role.name === HR_ROLE_NAME);
        if (!isHR) return interaction.reply({ content: `⚠️ このコマンドは「${HR_ROLE_NAME}」ロールを持つ人だけが実行可能です。`, ephemeral: true });

        const u1 = interaction.options.getUser('user1'); const s1 = interaction.options.getString('score1'); const r1 = interaction.options.getString('role1');
        const u2 = interaction.options.getUser('user2'); const s2 = interaction.options.getString('score2'); const r2 = interaction.options.getString('role2');
        const u3 = interaction.options.getUser('user3'); const s3 = interaction.options.getString('score3'); const r3 = interaction.options.getString('role3');

        const resultEmbed = new EmbedBuilder()
            .setTitle('📢 【公式発表】運営・配属試験 結果通知')
            .setDescription('厳正なる選考およびAI人事評価の結果、以下の通り配属先を決定いたしました。選出されたメンバーの今後の活躍を期待します！')
            .setColor('#F1C40F').setThumbnail(client.user.displayAvatarURL()).setTimestamp();

        resultEmbed.addFields({ name: `👤 受験者: ${u1.username}`, value: `・**対象メンバー:** <@${u1.id}>\n・**試験採点点数:** \`${s1}\`\n・**最終決定配属:** **${r1}**`, inline: false });
        if (u2 && s2 && r2) resultEmbed.addFields({ name: `👤 受験者: ${u2.username}`, value: `・**対象メンバー:** <@${u2.id}>\n・**試験採点点数:** \`${s2}\`\n・**最終決定配属:** **${r2}**`, inline: false });
        if (u3 && s3 && r3) resultEmbed.addFields({ name: `👤 受験者: ${u3.username}`, value: `・**対象メンバー:** <@${u3.id}>\n・**試験採点点数:** \`${s3}\`\n・**最終決定配属:** **${r3}**`, inline: false });

        let mentionText = `🔔 結果発表通知: <@${u1.id}>`;
        if (u2) mentionText += ` <@${u2.id}>`; if (u3) mentionText += ` <@${u3.id}>`;

        await interaction.channel.send({ content: mentionText, embeds: [resultEmbed] });
        return interaction.reply({ content: '✅ 試験結果を公開チャンネルに送信しました！', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
