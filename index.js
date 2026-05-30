require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// =================【設定項目】=================
// 1. 管理者のDiscordユーザーIDのリスト
// ※管理者にしたい人のIDを「,（カンマ）」で区切って何人でも追加できます。
const ADMIN_IDS = [
    '1272043976773337184',
    '1134063630921502762',
    '0000000000000000000'
]; 

// 2. DMのやり取り（送受信）を記録するチャンネルのID
const LOG_CHANNEL_ID = '1510215306901983312';
// ==============================================

// スラッシュコマンドの設定定義
const commands = [
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('ボットに指定したメッセージを喋らせます（管理者限定）')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('ボットに喋らせたい内容')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('dm_say')
        .setDescription('特定のユーザーにボットから埋め込みDMを送ります（管理者限定）')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('送信相手のユーザーを選択')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('title')
                .setDescription('埋め込みのタイトル')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('message')
                .setDescription('送りたい内容（埋め込みの本文）')
                .setRequired(true)
        )
];

// ボット起動時にコマンドをDiscordに登録
client.once('ready', async () => {
    console.log(`${client.user.tag} がオンラインになりました！`);
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('スラッシュコマンドを更新中...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('スラッシュコマンドの更新が完了しました！');
    } catch (error) {
        console.error(error);
    }
});

// スラッシュコマンドを受け取ったときの処理
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, user } = interaction;

    // 【変更】複数人の管理者チェック
    // コマンドを実行した人のIDが、ADMIN_IDSのリストの中に含まれているか確認します
    if (!ADMIN_IDS.includes(user.id)) {
        return interaction.reply({ content: 'このコマンドは管理者しか使用できません。', ephemeral: true });
    }

    // 1. サーバーのチャンネルで喋らせるコマンド (/say)
    if (commandName === 'say') {
        const text = options.getString('message');
        await interaction.channel.send(text);
        await interaction.reply({ content: 'メッセージを送信しました！', ephemeral: true });
    }

    // 2. 特定の人にボットから【埋め込みDM】を送るコマンド (/dm_say)
    if (commandName === 'dm_say') {
        const targetUser = options.getUser('user');
        const title = options.getString('title'); 
        const text = options.getString('message');

        const embed = new EmbedBuilder()
            .setColor(0x00FF7F) 
            .setTitle(title) 
            .setDescription(text) 
            .setTimestamp() 
            .setFooter({ text: `送信元: ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() });

        try {
            await targetUser.send({ embeds: [embed] });
            await interaction.reply({ content: `${targetUser.username} に埋め込みDMを送信しました！`, ephemeral: true });

            // ログ用チャンネルへ「送信記録」を投稿（誰が送信したかも記録に残るように変更）
            if (LOG_CHANNEL_ID !== 'ログ用のチャンネルID') {
                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('📤 【ログ】ボットからDMを送信しました')
                        .addFields(
                            { name: '実行した管理者', value: `${interaction.user.tag} (\`${interaction.user.id}\`)` }, // ←追加
                            { name: '対象ユーザー', value: `${targetUser.tag} (\`${targetUser.id}\`)` },
                            { name: 'タイトル', value: title },
                            { name: '内容', value: text }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '相手がDMを閉鎖しているか、ブロックされているため送信できませんでした。', ephemeral: true });
        }
    }
});

// ユーザーからボットにDMが届いたときの処理（受信ログ）
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.guild === null) {
        console.log(`【DM受信】 ${message.author.tag}: ${message.content}`);
        
        if (LOG_CHANNEL_ID !== 'ログ用のチャンネルID') {
            try {
                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
                if (logChannel) {
                    const receiveEmbed = new EmbedBuilder()
                        .setColor(0xFFD700)
                        .setTitle('📥 【ログ】ユーザーからDMを受信しました')
                        .addFields(
                            { name: '送信者', value: `${message.author.tag} (\`${message.author.id}\`)` },
                            { name: '内容', value: message.content }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [receiveEmbed] });
                }
            } catch (e) {
                console.error('ログチャンネルへの送信に失敗しました。', e);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);