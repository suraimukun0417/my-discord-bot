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

// 🔴 操作を制限する役職（ロール）の名前
const HR_ROLE_NAME = "人事部【Human Resources】"; 
const ALLOWED_ROLE_NAME = "ボット管理"; // 旧管理コマンド用

const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

let currentStatus = "online";
let statusMessageId = null;

// 試験データ管理用の変数
const activeExams = new Map();     // 受験者の進行状況
let examDeadline = null;           // 提出期限（Dateオブジェクト）

// フォーラムとユーザーDMの双方向マッピング
const forumToUser = new Map();     // フォーラムID -> ユーザーID
const userToForum = new Map();     // ユーザーID -> フォーラムID

// 全7問（選択4問、記述3問）の試験問題
const EXAM_DATA = {
    moderator: {
        name: '🛡️ モデレーター試験',
        color: '#3498DB',
        questions: [
            { title: '【第1問（選択）】ルール違反の確認', text: '一般ユーザーが「言葉遣いのルール」に明確に違反しているのを発見しました。最初にとるべき行動として適切なものはどれですか？\n\nA: 何も言わずに即座にサーバーからBANする\nB: 公開チャンネル、またはDMで注意・警告を与える\nC: 見て見ぬふりをする' },
            { title: '【第2問（選択）】大規模な荒らしへの対処', text: '複数のアカウントが同時に無意味な連投（スパム）を始めました。最優先すべき対応はどれですか？\n\nA: 荒らしユーザー全員に口頭で注意する\nB: 該当チャンネルの書き込み権限を一時的にロックし、適切にキック・BAN等の対処を行う\nC: 静観する' },
            { title: '【第3問（選択）】個人情報の取り扱い', text: 'メンバーが誤って他人の本名や写真を送信してしまいました。適切な対応はどれですか？\n\nA: 放置する\nB: すぐにそのメッセージを削除し、本人に注意を促すとともに他の運営に報告する\nC: スクリーンショットを撮って拡散する' },
            { title: '【第4問（選択）】権限の悪用について', text: '他のモデレーターが権限を悪用し、一般ユーザーを不当にキックしているのを目撃しました。どうすべきですか？\n\nA: 自分も一緒になってキックに加わる\nB: 独断で動かず、ログなどの証拠を確保してすぐに上の管理者に報告・相談する\nC: 喧嘩になるのが嫌なので無視する' },
            { title: '【第5問（記述）】ユーザー同士の口論への対応', text: '常連ユーザー同士がチャンネル内で激しい口論（喧嘩）を始めてしまいました。あなたはモデレーターとしてどのように声をかけ、どのようにこのトラブルを収めますか？対応方針を具体的に記述してください。' },
            { title: '【第6問（記述）】新規ユーザーへの配慮', text: 'サーバーに入りたての新規ユーザーが、ルールをよく知らずに雑談禁止のチャンネルで話し始めてしまいました。威圧感を与えずにルールを教えるための案内文章を考えて記述してください。' },
            { title: '【第7問（記述）】理想のモデレーター像', text: 'あなたがこのサーバーのモデレーターとして採用された場合、どのような点に気をつけて活動したいですか？あなたの強みや意気込みを自由に記述してください。' }
        ]
    },
    admin: {
        name: '👑 管理者試験',
        color: '#E74C3C',
        questions: [
            { title: '【第1問（選択）】権限設定のトラブル', text: '新しく作成したチャンネルが一般ユーザーに見えてしまっていると報告を受けました。最初に確認すべき項目はどれですか？\n\nA: チャンネルの閲覧権限（@everyone の設定）が正しく拒否されているか確認する\nB: 原因がわからないのでサーバー自体を削除して作り直す\nC: 放置する' },
            { title: '【第2問（選択）】ボットの不具合対応', text: 'サーバー内で稼働している主要ボットが突然コマンドに反応しなくなりました。優先すべき対応手順はどれですか？\n\nA: ボットの役職や管理権限をすべて剥奪する\nB: ボットのステータスや開発元の情報を確認し、ホスティングプラットフォームのログを見て再起動を試みる\nC: 他の管理者が直してくれるまで待つ' },
            { title: '【第3問（選択）】他の運営メンバーとの衝突', text: '運営方針を巡って、あなたと他の管理者の間で意見が真っ向から対立してしまいました。どう行動すべきですか？\n\nA: 独断でその管理者の権限を剥奪して追放する\nB: お互いの意見のメリット・デメリットを整理し、他のメンバーも交えて冷静に話し合って解決策を決める\nC: 運営を辞めてサーバーを荒らす' },
            { title: '【第4問（選択）】セキュリティ対策', text: 'サーバーのセキュリティレベル（認証レベル）を変更する際、最も考慮すべきバランスはどれですか？\n\nA: 荒らしを完全に防ぐために一番厳しい設定のまま固定し、新規が入れなくなっても気にしない\nB: 荒らし対策の安全性と、新規ユーザーの参加しやすさ（利便性）のバランスを考慮して適切なレベルを選ぶ\nC: 設定が面倒なので一番低い設定にする' },
            { title: '【第5問（記述）】サーバーの活性化企画', text: 'サーバー内のアクティブユーザーを今よりも増やし、コミュニティをより活発にするために、あなたが管理者になったら実施したい「新しいイベント」「企画」「改善案」などを具体的に記述してください。' },
            { title: '【第6問（記述）】トラブル発生時の危機管理', text: 'サーバーが大規模な荒らしアカウントの襲撃（レイド）に遭い、メンバーが不安に陥っています。復旧手順やメンバーへのアナウンスなど、どのように迅速な対応を行いますか？危機管理方針を記述してください。' },
            { title: '【第7問（記述）】長期的なサーバー運営のビジョン', text: 'あなたが管理者として半年〜1年後にこのサーバーをどのようなコミュニティに成長させたいですか？あなたの長期的なビジョンや目標を自由に記述してください。' }
        ]
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
        .setDescription('指定したユーザーのDMに配属試験を送信します（人事部専用）')
        .addUserOption(option => option.setName('user').setDescription('試験を受けさせたいメンバー').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('送信する試験の種類').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' })),
    new SlashCommandBuilder()
        .setName('exam_deadline')
        .setDescription('配属試験の提出期限を設定します（人事部専用）')
        .addIntegerOption(option => option.setName('minutes').setDescription('今から何分後を期限にするか（0で期限解除）').setRequired(true))
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

// 期限超過とフォーラム自動削除を毎秒チェックするタイマー
setInterval(async () => {
    if (examDeadline && new Date() > examDeadline) {
        for (const [forumId, userId] of forumToUser.entries()) {
            try {
                const thread = await client.channels.fetch(forumId);
                if (thread) await thread.delete('提出期限が切れたため、質問フォーラムを自動削除しました。');
            } catch (e) {}
            userToForum.delete(userId);
            forumToUser.delete(forumId);
        }
    }
}, 5000);

// ==========================================
// 5. イベントハンドラー
// ==========================================
client.once('ready', async () => {
    console.log(`${client.user.tag} が稼働しました。`);
    client.user.setActivity('試験システム稼働中', { type: ActivityType.Custom });
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try { await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands }); } catch (error) { console.error(error); }
    currentStatus = "online";
    await updateStatusMessage();
});

// DMメッセージ受信 ＆ 質問フォーラム双方向連動システム
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // --- 📥 人事部が「質問フォーラム内」で発言した内容をユーザーDMへ転送 ---
    if (message.channel.isThread() && forumToUser.has(message.channel.id)) {
        const targetUserId = forumToUser.get(message.channel.id);
        try {
            const targetUser = await client.users.fetch(targetUserId);
            if (targetUser) {
                const relayEmbed = new EmbedBuilder()
                    .setTitle('💬 人事部からの回答・メッセージ')
                    .setDescription(message.content || '*(ファイル等)*')
                    .setColor('#2ECC71')
                    .setTimestamp();
                await targetUser.send({ embeds: [relayEmbed] });
                await message.react('✅'); 
            }
        } catch (e) {
            await message.reply('❌ ユーザーへのDM転送に失敗しました。');
        }
        return;
    }

    // これ以降はDMチャンネルのみの処理
    if (message.channel.type !== ChannelType.DM) return;
    const userId = message.author.id;

    // ⏰ 共通：提出期限チェック
    if (examDeadline && new Date() > examDeadline) {
        if (activeExams.has(userId)) activeExams.delete(userId);
        return await message.channel.send('❌ **提出期限が過ぎています。これ以上回答や質問を送信することはできません。**');
    }

    // ❓ 試験中、ユーザーが「質問」と送信した場合のフォーラム自動作成
    if (message.content.trim() === '質問' && activeExams.has(userId)) {
        if (userToForum.has(userId)) {
            return await message.channel.send('💡 すでに質問フォーラムが開いています。このまま質問内容を送信してください。終わる場合は「**質問終了**」と送信してください。');
        }

        const forumChannelId = process.env.FORUM_CHANNEL_ID;
        if (!forumChannelId) {
            return await message.channel.send('❌ サーバー側のフォーラム設定が整っていません。');
        }

        try {
            const forumChannel = await client.channels.fetch(forumChannelId);
            if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
                const thread = await forumChannel.threads.create({
                    name: `❓ 質問: ${message.author.username} からの試験問い合わせ`,
                    autoArchiveDuration: 60,
                    message: {
                        content: `🔔 **受験者 (${message.author.tag} / ID: ${userId}) からの質問スレッドです。**\nこのスレッド内にメッセージを入力すると、自動的にそのユーザーのDMへ「人事部からの回答」として転送されます。`
                    },
                    reason: '試験中の質問対応用匿名スレッド'
                });

                userToForum.set(userId, thread.id);
                forumToUser.set(thread.id, userId);

                return await message.channel.send('✨ **人事部直通の質問フォーラムが新規作成されました！**\nこれより、このDMに入力した内容はすべて人事部へ転送されます。質問をどうぞ！\n\n*※質問が終わったら「**質問終了**」と送信すると、試験回答モードに戻ります。*');
            }
        } catch (error) {
            console.error(error);
            return await message.channel.send('❌ 質問フォーラムの作成に失敗しました。');
        }
    }

    // 🚪 ユーザーが「質問終了」と送信した場合のクローズ処理
    if (message.content.trim() === '質問終了' && activeExams.has(userId)) {
        if (!userToForum.has(userId)) {
            return await message.channel.send('💡 現在質問モードではありません。そのまま問題にお答えください。');
        }

        const threadId = userToForum.get(userId);
        try {
            const thread = await client.channels.fetch(threadId);
            if (thread) {
                await thread.send('🔒 **ユーザーが「質問終了」を宣言したため、この対話スレッドを閉じます（自動削除）。**');
                await thread.delete();
            }
        } catch (e) {}

        // マップから削除
        userToForum.delete(userId);
        forumToUser.delete(threadId);

        // 現在止まっていた問題を再案内して回答モードに完全復帰させる
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];
        const currentQuestion = examInfo.questions[examState.step - 1];

        const resumeEmbed = new EmbedBuilder()
            .setTitle(`↩️ 試験に戻りました: ${currentQuestion.title}`)
            .setDescription(`${currentQuestion.text}\n\n*※質問モードは終了しました。この問題への回答を送信してください。再度質問したい場合は「**質問**」と送信してください。*`)
            .setColor(examInfo.color);

        return await message.channel.send({ embeds: [resumeEmbed] });
    }

    // 📤 質問モード中のメッセージ転送（質問中のメッセージは回答として扱わずガードする）
    if (userToForum.has(userId)) {
        const threadId = userToForum.get(userId);
        try {
            const thread = await client.channels.fetch(threadId);
            if (thread) {
                await thread.send(`📬 **[ユーザーからの質問メッセージ]:** ${message.content}`);
                await message.react('✉️');
            }
        } catch (e) {
            userToForum.delete(userId);
            forumToUser.delete(threadId);
        }
        return; // ⚠️ ここで終了。質問中は問題は絶対に進みません！
    }

    // 📝 通常の試験回答システム（全7問ステップ回収）
    if (activeExams.has(userId)) {
        const examState = activeExams.get(userId);
        const examInfo = EXAM_DATA[examState.type];
        const currentStep = examState.step; // 1〜7

        // 回答を保存
        examState.answers.push({
            title: examInfo.questions[currentStep - 1].title,
            answer: message.content
        });

        if (currentStep < 7) {
            examState.step += 1;
            activeExams.set(userId, examState);

            const nextQuestion = examInfo.questions[examState.step - 1];
            const nextEmbed = new EmbedBuilder()
                .setTitle(`${examInfo.name} - ${nextQuestion.title}`)
                .setDescription(`${nextQuestion.text}\n\n*※このメッセージにそのまま回答を入力して送信してください。内容に困った際は「**質問**」と送信すると人事部に直接質問できます。*`)
                .setColor(examInfo.color);
            return await message.channel.send({ embeds: [nextEmbed] });
        }

        // 全7問すべて回答し終わった場合
        activeExams.delete(userId);

        await message.channel.send('⏳ **全7問の回答をすべて回収しました！現在、高性能AIが適正度を厳密に分析・採点しています。このまま15秒ほどお待ちください...**');

        // 🧠 強力なAI人事判定システム
        let aiEvaluation = "";
        try {
            const prompt = `あなたはDiscordサーバーの人事責任者AIです。受験者から送られた回答を厳格に審査し、採点してください。
選択問題（第1〜4問）の正解はすべて「B」です。AやC、あるいは「あああ」など無意味な文字・不正解は容赦なく0点（大幅減点）にしてください。
記述問題（第5〜7問）に「あああ」などの適当な文字列や無意味な文章が入力されていた場合も、その問題は0点にしてください。手抜きは絶対に見逃さないでください。

【試験名】: ${examInfo.name}
【第1問回答】: ${examState.answers[0].answer}
【第2問回答】: ${examState.answers[1].answer}
【第3問回答】: ${examState.answers[2].answer}
【第4問回答】: ${examState.answers[3].answer}
【第5問（記述）】: ${examState.answers[4].answer}
【第6問（記述）】: ${examState.answers[5].answer}
【第7問（記述）】: ${examState.answers[6].answer}

上記を確認し、必ず以下のフォーマットのみで厳しく判定を出力してください。
【AI採点結果】: ○○点 / 100点
【適正評価寸評】: （ここに、選択の正誤や、記述が適当か真面目かを踏まえた150文字以内の辛口な評価文）`;

            const response = await axios.post('https://chateverywhere.app/api/chat/', {
                messages: [
                    { role: "system", content: "手抜き回答や無意味な入力を厳しく見抜く採点AI。指定フォーマットを厳守すること。" },
                    { role: "user", content: prompt }
                ],
                model: "llama-3.1-70b"
            }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });

            if (response.data?.choices?.[0]?.message?.content) {
                aiEvaluation = response.data.choices[0].message.content;
            }
        } catch (e) { console.error(e); }

        // セーフティ・バックアップ採点
        if (!aiEvaluation) {
            let score = 0;
            if (examState.answers[0].answer.toUpperCase().includes('B')) score += 15;
            if (examState.answers[1].answer.toUpperCase().includes('B')) score += 15;
            if (examState.answers[2].answer.toUpperCase().includes('B')) score += 15;
            if (examState.answers[3].answer.toUpperCase().includes('B')) score += 15;
            if (examState.answers[4].answer.length > 6 && !/^[あいうえおぁぃぅぇぉ宛頭安アアン]+$/.test(examState.answers[4].answer)) score += 14;
            if (examState.answers[5].answer.length > 6 && !/^[あいうえおぁぃぅぇぉ宛頭安アアン]+$/.test(examState.answers[5].answer)) score += 13;
            if (examState.answers[6].answer.length > 6 && !/^[あいうえおぁぃぅぇぉ宛頭安アアン]+$/.test(examState.answers[6].answer)) score += 13;
            aiEvaluation = `【AI採点結果】: **${score}点 / 100点**\n【適正評価寸評】: (自動セーフティガード) 不正解および手抜き回答（あああ等）を厳しく無得点として自動算出しました。最終的な配属可否は運営で決定してください。`;
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
                            { name: `❓ ${examInfo.questions[5].title}`, value: examState.answers[5].answer, inline: false },
                            { name: `❓ ${examInfo.questions[6].title}`, value: examState.answers[6].answer, inline: false },
                            { name: '🤖 AIによる二重審査判定', value: aiEvaluation, inline: false }
                        )
                        .setTimestamp();
                    await examChannel.send({ embeds: [embed] });
                }
            } catch (e) { console.error(e); }
        }
        return await message.channel.send('🎉 **無事にすべての解答が人事部へ転送されました。試験はこれで終了です！お疲れ様でした！**');
    }

    // 通常DMログ転送
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
        currentStatus = interaction.options.getString('type');
        await updateStatusMessage();
        return interaction.reply({ content: `ステータスを更新しました。`, ephemeral: true });
    }

    if (commandName === 'rolepanel') {
        const text = interaction.options.getString('text');
        const role = interaction.options.getRole('role');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`role_${role.id}`).setLabel(`${role.name} を付ける/外す`).setStyle(ButtonStyle.Primary));
        await interaction.channel.send({ content: text, components: [row] });
        return interaction.reply({ content: 'ロールパネルを作成しました。', ephemeral: true });
    }

    if (commandName === 'dm_say') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const targetUser = interaction.options.getUser('user');
        const targetUserId = interaction.options.getString('user_id');
        let user = targetUser;
        if (!user && targetUserId) { try { user = await client.users.fetch(targetUserId.trim()); } catch (e) {} }
        if (!user) return interaction.reply({ content: '❌ 送信相手を指定してください。', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
            const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor('#5865F2').setTimestamp();
            await user.send({ embeds: [embed] });
            return interaction.editReply({ content: `✅ DMを送信しました。` });
        } catch (error) { return interaction.editReply({ content: `❌ 送信失敗。` }); }
    }

    if (commandName === 'ai') {
        await interaction.deferReply();
        const question = interaction.options.getString('question');
        try {
            const response = await axios.post('https://chateverywhere.app/api/chat/', {
                messages: [{ role: "system", content: "親切な日本語のアシスタント。" }, { role: "user", content: question }],
                model: "llama-3.1-70b"
            }, { timeout: 12000 });
            return interaction.editReply(`**質問:** ${question}\n\n**AI:** ${response.data?.choices?.[0]?.message?.content || "エラー"}`);
        } catch (error) { return interaction.editReply("AIエラー"); }
    }

    if (commandName === 'janken') {
        const userHand = interaction.options.getString('hand');
        const hands = ['goo', 'choki', 'paa'];
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

        await interaction.deferReply({ ephemeral: true });

        try {
            activeExams.set(targetUser.id, { type: examType, step: 1, answers: [] });

            let deadlineNotice = "なし";
            if (examDeadline) deadlineNotice = `<t:${Math.floor(examDeadline.getTime() / 1000)}:F> (<t:${Math.floor(examDeadline.getTime() / 1000)}:R>)`;

            const q1Embed = new EmbedBuilder()
                .setTitle(`📝 ${examInfo.name} の受講案内`)
                .setDescription(`人事部より配属試験が発行されました。**全7問**あります。\n\n**⏰ 提出期限**: ${deadlineNotice}\n\n*※試験中、わからないことがあれば、このDMに「**質問**」とだけ送信すると人事部と匿名で会話できます。*\n\n**${examInfo.questions[0].title}**\n${examInfo.questions[0].text}\n\n*※このメッセージにそのまま回答を打ち込んで送信してください。*`)
                .setColor(examInfo.color)
                .setTimestamp();

            await targetUser.send({ embeds: [q1Embed] });
            return interaction.editReply({ content: `✅ ${targetUser.tag} のDMへ「${examInfo.name}」を送信しました。` });
        } catch (error) {
            activeExams.delete(targetUser.id);
            return interaction.editReply({ content: `❌ ${targetUser.tag} へDMを送信できませんでした。` });
        }
    }

    if (commandName === 'exam_deadline') {
        const isHR = interaction.member.roles.cache.some(role => role.name === HR_ROLE_NAME);
        if (!isHR) return interaction.reply({ content: `⚠️ このコマンドは「${HR_ROLE_NAME}」ロールを持つ人だけが実行可能です。`, ephemeral: true });

        const minutes = interaction.options.getInteger('minutes');
        if (minutes === 0) {
            examDeadline = null;
            return interaction.reply({ content: '✅ 試験の提出期限を解除しました。' });
        }

        examDeadline = new Date(Date.now() + minutes * 60000);
        const timestamp = Math.floor(examDeadline.getTime() / 1000);
        return interaction.reply({ content: `✅ 試験の提出期限を今から **${minutes}分後** に設定しました！\n期限: <t:${timestamp}:F>` });
    }
});

client.login(process.env.DISCORD_TOKEN);
