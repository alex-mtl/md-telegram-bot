const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Read the API token from the 'tg-token' file
const TOKEN = fs.readFileSync('tg-token', 'utf8').trim();

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(TOKEN, { polling: true });

// Directory to store the group member files
const GROUP_DIR = 'groups';

function getGroupFile(chatId) {
    return path.join(GROUP_DIR, `${chatId}.json`);
}

function loadGroup(chatId) {
    const groupFile = getGroupFile(chatId);
    if (fs.existsSync(groupFile)) {
        const data = fs.readFileSync(groupFile, 'utf8');
        return new Set(JSON.parse(data));
    }
    return new Set();
}

function saveGroup(chatId, group) {
    if (!fs.existsSync(GROUP_DIR)) {
        fs.mkdirSync(GROUP_DIR);
    }
    const groupFile = getGroupFile(chatId);
    fs.writeFileSync(groupFile, JSON.stringify([...group]), 'utf8');
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Hi! Use /join_all to join the group, /leave_all to leave the group, and /notify_all <message> to notify all members.');
});

bot.onText(/\/join_all/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const group = loadGroup(chatId);
    if (!group.has(userId)) {
        group.add(userId);
        saveGroup(chatId, group);
        bot.getChat(chatId).then(chat => {
            const chatName = chat.title || chat.username || chat.first_name || chat.last_name;
            bot.sendMessage(chatId, `You have joined the "all" group in chat: ${chatName}`, thread);
        }).catch(err => {
            bot.sendMessage(userId, `You have joined the "all" group in chat: ${chatId}`);
            console.error(err);
        });
    } else {
        bot.sendMessage(chatId, 'You are already a member of the "all" group.', thread);
    }
});

bot.onText(/\/leave_all/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const group = loadGroup(chatId);
    if (group.has(userId)) {
        group.delete(userId);
        saveGroup(chatId, group);
        bot.sendMessage(chatId, 'You have left the "all" group.', thread);
    } else {
        bot.sendMessage(chatId, 'You are not a member of the "all" group.', thread);
    }
});

bot.onText(/\/notify_all (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const message = match[1];
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const group = loadGroup(chatId);
    if (message.trim() === '') {
        bot.sendMessage(chatId, 'Please provide a message to send.', thread);
        return;
    }
    bot.getChat(chatId).then(chat => {
        // const chatName = chat.title || chat.username || chat.first_name || chat.last_name;
        const chatName = msg.chat.username;
        let messageId = msg.message_id
        // const chatLink = `https://t.me/${chat.username || chatId}`;
        // const topicInfo = threadId ? ` in topic: ${threadId}` : '';
        let messageLink;

        if (chatName) {
            // For public channels/groups with a username
            if (threadId) {
                messageLink = `https://t.me/${chatName}/${threadId}/${messageId}`;
            } else {
                messageLink = `https://t.me/${chatName}/${messageId}`;
            }
        } else {
            // For private groups/chats without a username
            messageLink = `https://t.me/c/${chatId.toString().replace('-100', '')}/${messageId}`;
        }


        group.forEach(memberId => {
            bot.sendMessage(memberId, `@${username}: ${message} (${messageLink})`);
        });

        bot.sendMessage(chatId, 'Message sent to all group members.', thread);
    }).catch(err => {
        console.error(err);
        group.forEach(memberId => {
            bot.sendMessage(memberId, `@${username}: ${message}`);
        });

        bot.sendMessage(chatId, 'Message sent to all group members.', thread);
    });
});
