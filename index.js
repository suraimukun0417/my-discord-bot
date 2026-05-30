const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');

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
// 2. Discord Bot の設定
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

// ステータスの定義
const STATUS_TEMPLATES = {
    online: "🟢オンライン ⋯ 稼働中",
    maintenance: "🔴オフライン ⋯ メンテナンス中",
    offline: "⚫️オフライン ⋯ 稼働していません"
};

// 状態を保持する変数（起動時はオンライン）
let currentStatus = "online";
let statusMessageId = null;

// ステータス表示を更新する関数
async function updateStatusMessage() {
    const channelId = process.env.STATUS_CHANNEL_ID;
    if (!channelId) {
        console.error("エラー: STATUS_CHANNEL_ID が設定されていません。");
        return;
    }

    try {
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
        console.error("ステータスメッセージの更新に失敗しました:", error);
    }
}

// ボット起動時の処理
client.once('ready', async () => {
    console.log(`${client.user.tag} がオンラインになりました！`);
    client.user.setActivity('ステータス監視中', { type: ActivityType.Watching });

    currentStatus = "online";
    await updateStatusMessage();
});

// コマンドによるステータス変更の処理
client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== process.env.STATUS_CHANNEL_ID) return;

    // ステータス変更コマンドのリスト
    const validCommands = ['!status メンテ', '!status 起動', '!status 停止'];
    if (!validCommands.includes(message.content)) return;

    // 🔴 送信者が特定のロールを持っているかチェック
    const hasRole = message.member.roles.cache.some(role => role.name === ALLOWED_ROLE_NAME);
    
    if (!hasRole) {
        // ロールを持っていない場合は警告を出し、メッセージを消去して終了
        const reply = await message.reply(`⚠️ このコマンドは「${ALLOWED_ROLE_NAME}」ロールを持つ人のみ実行できます。`);
        setTimeout(() => reply.delete().catch(() => {}), 5000); // 5秒後に警告を消す
        await message.delete().catch(() => {});
        return;
    }

    // ロールを持っている場合のみ以下の処理を実行
    if (message.content === '!status メンテ') {
        currentStatus = "maintenance";
    } else if (message.content === '!status 起動') {
        currentStatus = "online";
    } else if (message.content === '!status 停止') {
        currentStatus = "offline";
    }

    await updateStatusMessage();
    await message.delete().catch(() => {});
});

// ボットのログイン
client.login(process.env.DISCORD_TOKEN);
