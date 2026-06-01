const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const express = require('express');
const axios = require('axios');
const { createCanvas } = require('canvas');

// ==========================================
// 1. Webサーバーの設定 (UptimeRobot / Render 用)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.send('Bot is fully upgraded with TTS and AI Image Generator!'); });
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

// 🗣️ 読み上げ用状態管理
const ttsConnections = new Map(); // guildId -> voiceConnection
const ttsChannels = new Map();    // guildId -> textChannelId

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

// Helper: 締め切り用の共通日時オプションを追加する関数
function addDateTimeOptions(builder) {
    return builder
        .addIntegerOption(o => o.setName('year').setDescription('年 (例: 2026)').setRequired(true))
        .addIntegerOption(o => o.setName('month').setDescription('月 (1〜12)').setRequired(true))
        .addIntegerOption(o => o.setName('day').setDescription('日 (1〜31)').setRequired(true))
        .addIntegerOption(o => o.setName('hour').setDescription('時 (0〜23)').setRequired(true))
        .addIntegerOption(o => o.setName('minute').setDescription('分 (0〜59)').setRequired(true));
}

// ==========================================
// 3. 全スラッシュコマンドの定義配列
// ==========================================
const baseCommands = [
    new SlashCommandBuilder().setName('status').setDescription('ボットのステータスを変更します（ボット管理用）').addStringOption(o => o.setName('type').setDescription('種類').setRequired(true).addChoices({ name: '起動', value: 'online' }, { name: 'メンテ', value: 'maintenance' }, { name: '停止', value: 'offline' })),
    new SlashCommandBuilder().setName('dm_say').setDescription('ユーザーにボットから埋め込みDMを送ります（Staff/Admin用）').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('description').setDescription('本文').setRequired(true)).addUserOption(o => o.setName('user').setDescription('相手')),
    new SlashCommandBuilder().setName('exam').setDescription('指定したユーザーのDMに配属試験を送信します（人事部専用）').addUserOption(o => o.setName('user').setDescription('試験対象').setRequired(true)).addStringOption(o => o.setName('type').setDescription('試験種別').setRequired(true).addChoices({ name: '🛡️ モデレーター試験', value: 'moderator' }, { name: '👑 管理者試験', value: 'admin' })),
    new SlashCommandBuilder().setName('exam_result').setDescription('配属試験の結果を一括発表します（人事部専用）').addUserOption(o => o.setName('user1').setDescription('受験者').setRequired(true)).addStringOption(o => o.setName('score1').setDescription('点数').setRequired(true)).addStringOption(o => o.setName('role1').setDescription('配属先').setRequired(true)),
    new SlashCommandBuilder().setName('embed').setDescription('カラー指定つきの埋め込みを投稿します（Staff/Admin用）').addStringOption(o => o.setName('title').setDescription('タイトル').setRequired(true)).addStringOption(o => o.setName('body').setDescription('本文').setRequired(true)).addStringOption(o => o.setName('color').setDescription('
