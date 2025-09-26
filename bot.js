const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Read the API token from the 'tg-token' file
const TOKEN = fs.readFileSync('tg-token', 'utf8').trim();

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(TOKEN, {
    polling: {
        params: {
            allowed_updates: JSON.stringify([
                'message',
                'chat_member',
                'my_chat_member',
                'edited_message',
                'chat_join_request',
                'callback_query'
            ]) ,
        }
    }
});


// Directory to store the group member files
const GROUP_DIR = 'groups';

function captchaMiddleware(handler) {
    return async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const gs = loadGS(chatId);
        if(gs.protect !== 'on') return handler(msg, match);
        // Check if user is in pending CAPTCHA list
        if (gs.banned && (gs.banned[userId] !== undefined)
            && (gs.banned[userId].ttl > Date.now())) {
            // User hasn't passed CAPTCHA - delete their message
            try {
                await bot.deleteMessage(chatId, msg.message_id);
                console.log(`Deleted message from pending user ${userId}`);
            } catch (error) {
                console.error('Error deleting message:', error);
            }
            return; // Stop further processing
        }

        // User passed CAPTCHA or not in list - proceed to original handler
        return handler(msg, match);
    };
}

function adminMiddleware(handler) {
    return async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const threadId = msg.message_thread_id;
        let thread = threadId ? { message_thread_id: threadId } : {}
        // Check if sender is admin (for demonstration purposes, adminId is hard-coded)
        const admin = await bot.getChatAdministrators(chatId);
        const isAdmin = admin.some(member => member.user.id === userId);

        if (!isAdmin) {
            bot.sendMessage(chatId, "❌ This command is for admins only.", thread)
                .then((sentMessage) => {
                    setTimeout(() => {
                        bot.deleteMessage(chatId, sentMessage.message_id)
                    }, 3000)

                });
            return;
        }

        return handler(msg, match);
    };
}

async function checkDeleteMessagePermission(chatId) {
    try {
        const botInfo = await bot.getChatMember(chatId, (await bot.getMe()).id);

        if (botInfo.status === 'administrator') {
            const canDeleteMessages = botInfo.can_delete_messages;
            console.log(`Can delete messages: ${canDeleteMessages}`);
            errMess = (canDeleteMessages
                ? 'Bot has permission to delete messages.'
                : 'Bot has no permission to delete messages.');
            console.log(`Err:`+errMess);
            return {
                canDeleteMessages,
                errMessage: errMess,
            };
        } else {
            return {
                canDeleteMessages: false,
                errMessage: 'Bot is not an administrator. '+botInfo.status,
            };
        }
    } catch (error) {
        console.error('Error checking permissions:', error.message);
        return {
            canDeleteMessages: false,
            errMessage: 'Error checking permissions: ' + error.message,
        };
    }
}
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

function generateRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function restrictUser(bot, chatId, userId) {
    try {
        await bot.restrictChatMember(chatId, userId, {
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false,
            until_date: Math.floor(Date.now() / 1000) + 180 // Ограничение на 1 час
        });
    } catch (error) {
        console.error('Error restricting user:', error);
    }
}

// Функция для снятия ограничений
async function unrestrictUser(bot, chatId, userId) {
    try {
        await bot.restrictChatMember(chatId, userId, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            until_date: 0
        });
    } catch (error) {
        console.error('Error unrestricting user:', error);
    }
}

async function createCaptchaKeyboard(correctAnswer, chatId) {
    const buttons = [];
    const answers = new Set([correctAnswer]);

    // Генерируем 4 уникальных неправильных ответа
    while (answers.size < 5) {
        answers.add(generateRandomNumber(0, 100));
    }

    // Преобразуем в массив и перемешиваем
    const answersArray = Array.from(answers).sort(() => Math.random() - 0.5);
    console.log(answersArray);

    // Создаем кнопки
    await answersArray.forEach(answer => {
        buttons.push({
            text: answer.toString(),
            callback_data: `captcha_${chatId}|${answer}`
        });
    });

    return {
        inline_keyboard: [buttons],
        resize_keyboard: true
    };
}
bot.on('polling_error', (error) => {
    console.error(`Polling error: ${error.message}`);
    // Optionally, implement a retry mechanism or delay to prevent constant retries.
});
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    bot.sendMessage(msg.chat.id, 'Hi! Use /join_all to join the group, /leave_all to leave the group, and /notify_all <message> to notify all members.', thread);
});

bot.onText(/\/(join_all|join)/, (msg) => {
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

bot.onText(/\/(leave_all|leave)/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const group = loadGroup(chatId);

    let replyText = '';

    if (group.has(userId)) {
        group.delete(userId);
        saveGroup(chatId, group);
        replyText = 'You have left the "all" group.';
    } else {
        replyText = 'You are not a member of the "all" group.';
    }

    bot.sendMessage(chatId, replyText, thread).then((sentMsg) => {
        // Удалить оба сообщения через 20 секунд
        setTimeout(() => {
            bot.deleteMessage(chatId, messageId).catch(err =>
                console.warn('Failed to delete user message:', err.message)
            );
            bot.deleteMessage(chatId, sentMsg.message_id).catch(err =>
                console.warn('Failed to delete bot reply:', err.message)
            );
        }, 5000);
    });
});

bot.onText(/\/add_all\s+(@\w+(\s+@\w+)*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminId = msg.from.id; // Assuming the sender is the admin
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}

    // List of mentioned users
    const mentionedUsers = match[1].split(/\s+/);

    // Check if sender is admin (for demonstration purposes, adminId is hard-coded)
    const admin = await bot.getChatAdministrators(chatId);
    const isAdmin = admin.some(member => member.user.id === adminId);

    if (!isAdmin) {
        bot.sendMessage(chatId, 'You do not have permission to use this command.', thread);
        return;
    }

    // Load group
    const group = loadGroup(chatId);

    // Iterate through mentioned users
    for (const username of mentionedUsers) {
        // Remove '@' from username
        const user = username.replace('@', '');

        try {
            // Fetch user info by username
            const userInfo = await bot.getChatMember(chatId, user);

            // Add user to the group if not already a member
            if (userInfo && !group.has(userInfo.user.id)) {
                group.add(userInfo.user.id);
                saveGroup(chatId, group);
                bot.sendMessage(chatId, `User ${username} has been added to the "all" group.`, thread);
            } else {
                bot.sendMessage(chatId, `User ${username} is already a member of the "all" group or does not exist.`, thread);
            }
        } catch (err) {
            console.error(`Error adding user ${username}:`, err);
            bot.sendMessage(chatId, `Error adding user ${username}.`, thread);
        }
    }
});

bot.onText(/\/show_all/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id; // The user who is requesting the list
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    // Check if sender is an admin (for demonstration purposes, adminId is hard-coded)
    const admin = bot.getChatAdministrators(chatId);
    admin.then(admins => {
        const isAdmin = admins.some(member => member.user.id === userId);

        if (!isAdmin) {
            bot.sendMessage(chatId, 'You do not have permission to use this command.', thread);
            return;
        }

        // Load the group
        const group = loadGroup(chatId);

        if (group.size === 0) {
            bot.sendMessage(chatId, 'The "all" group is empty.', thread);
            return;
        }

        // Fetch user details
        const userDetailsPromises = Array.from(group).map(userId =>
            bot.getChatMember(chatId, userId)
                .then(member => ({
                    id: userId,
                    username: member.user.username || member.user.first_name || 'Unknown'
                }))
                .catch(() => ({ id: userId, username: 'Unknown' }))
        );

        Promise.all(userDetailsPromises).then(userDetails => {
            const userList = userDetails
                // .map(user => `@${user.username}`)
                .map(user => `${user.username}`)
                .join('\n');

            bot.sendMessage(chatId, `Users in the "all" group:\n${userList}`, thread);
        }).catch(err => {
            console.error('Error fetching user details:', err);
            bot.sendMessage(chatId, 'Error fetching user details.', thread);
        });
    }).catch(err => {
        console.error('Error checking admin status:', err);
        bot.sendMessage(chatId, 'Error checking admin status.', thread);
    });
});



bot.onText(/^\/(notify_all|all)\s+((.|\n)+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const message = match[2];
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const group = loadGroup(chatId);
    if (message.trim() === '') {
        bot.sendMessage(chatId, 'Please provide a message to send.', thread);
        return;
    }
    bot.getChat(chatId).then(async (chat) => {
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


        // group.forEach(memberId => {
        //     bot.sendMessage(memberId, `@${username}: ${message} (${messageLink})`);
        const memberIds = Array.from(group);
        let permissionDenied = ''
        console.log(memberIds);
        await Promise.all(
            memberIds.map(async (memberId) => {
                try {
                    await bot.sendMessage(memberId, `@${username}: ${message} (${messageLink})`);
                    // await bot.sendMessage(userId, message);
                    console.log(`Message sent to user ${memberId}`);
                    return true; // Message successfully sent
                } catch (error) {
                    if (error.response && error.response.statusCode === 403) {

                        const chatMember = await bot.getChatMember(chatId, memberId);
                        let mention = chatMember.user.username ? `@${chatMember.user.username} ` : `${chatMember.user.first_name} ${chatMember.user.last_name || ''} `;
                        console.error(`Cannot send message to user ${memberId} ${mention}: ${error.response.body.description}`);
                        permissionDenied = permissionDenied + mention

                    } else {
                        console.error(`Failed to send message to user ${memberId}:`, error.message);
                    }
                    return false; // Message failed
                }

            })
        )
        if (permissionDenied.length > 2) {
            bot.sendMessage(chatId, permissionDenied + ` do not have permission to receive direct messages from the bot.`, thread);
        }
        bot.sendMessage(chatId, 'Message sent to all group members.', thread);
    }).catch(err => {
        console.error(err);
        group.forEach(memberId => {
            bot.sendMessage(memberId, `@${username}: ${message}`);
        });

        bot.sendMessage(chatId, 'Message sent to all group members.', thread);
    });
});

// event management
const EVENT_DIR = 'events';

if (!fs.existsSync(EVENT_DIR)) {
    fs.mkdirSync(EVENT_DIR);
}

function getEventFile(chatId, eventId) {
    return path.join(EVENT_DIR, `${chatId}_${eventId}.json`);
}

function getGSFile(chatId) {
    return path.join(GROUP_DIR, `${chatId}.settings.json`);
}

function saveGS(chatId, settings) {
    const gsFile = getGSFile(chatId);
    fs.writeFileSync(gsFile, JSON.stringify(settings), 'utf8');
}
function saveEvent(chatId, eventId, event) {
    if (!event.eventLink) {
        formattedChatId = Math.abs(chatId).toString().slice(3);
        if (event.thread?.message_thread_id) {

            event.eventLink = `https://t.me/c/${formattedChatId}/${event.thread.message_thread_id}/${event.postMessageId ?? event.originalMessageId}`;
        } else {
            event.eventLink = `https://t.me/c/${formattedChatId}/${event.postMessageId ?? event.originalMessageId}`;
        }
    }
    const eventFile = getEventFile(chatId, eventId);
    fs.writeFileSync(eventFile, JSON.stringify(event), 'utf8');
}

function loadEvent(chatId, eventId) {
    const eventFile = getEventFile(chatId, eventId);
    if (fs.existsSync(eventFile)) {
        const data = fs.readFileSync(eventFile, 'utf8');
        return JSON.parse(data);
    }
    return null;
}

function loadGS(chatId) {
    const gsFile = getGSFile(chatId);
    if (fs.existsSync(gsFile)) {
        const data = fs.readFileSync(gsFile, 'utf8');
        return JSON.parse(data);
    }
    return {};
}

function loadEvents(chatId) {
    const eventsDir = path.join(__dirname, 'events');
    const eventFiles = fs.readdirSync(eventsDir).filter(file => file.startsWith(`${chatId}_`));

    return eventFiles.map(file => {
        const eventId = file.split('_')[1].split('.')[0];
        return loadEvent(chatId, eventId);
    }).filter(event => event !== null);
}

async function newEvent(chatId, thread, msg, event = {}) {

    if (Object.keys(event).length === 0) {
        const eventId = new Date().getTime();
        event = {
            id: eventId,
            chatId,
            thread,
            title: '',
            description: '',
            time: '',
            eventLink: '',
            originalMessageId: msg.message_id,
            authorId: msg.from.id,
            addPlayerMsgId: null,
            removePlayerMsgId: null,
            comments: {},
            remindMsgs: {},
            remindJoin: 0,
            participants: {
                go: [],
                cantGo: [],
                late: []
            }
        };
    } else {
        console.log(390, event,event === {})
    }
    await saveEvent(chatId, event.id, event);
    return event;
}

function remindJoinEvent(chatId, eventId) {
    const event = loadEvent(chatId, eventId);

    if (!event) {
        bot.sendMessage(chatId, 'Event not found.');
        return;
    }

    const group = loadGroup(chatId);

    const respondedUsers = new Set([
        ...event.participants.go,
        ...event.participants.cantGo,
        ...event.participants.late
    ]);

    const notResponded = Array.from(group).filter(userId => !respondedUsers.has(userId));

    let permissionDenied = '';

    bot.getChat(chatId).then(chat => {
        const chatName = chat.title || chat.username || chat.first_name || chat.last_name;
        Promise.all(notResponded.map(async (userId) => {
            try {
                const oldMessageId = event.remindMsgs?.[userId];
                console.log(event.remindMsgs)
                if (oldMessageId) {
                    await bot.deleteMessage(userId, oldMessageId).catch(err => {
                        console.warn(`Could not delete old reminder for ${userId}:`, err.message);
                    });
                }

                // Отправляем новое напоминание
                // const sentMessage = await bot.sendMessage(userId, `${chatName}\n\nYou haven't responded to the event "${event.title}".\nPlease check it out here: ${event.eventLink}`);
                const goUsernames = await Promise.all(event.participants.go.map(id => getUsernameFromId(chatId, id)));
                const cantGoUsernames = await Promise.all(event.participants.cantGo.map(id => getUsernameFromId(chatId, id)));
                const lateUsernames = await Promise.all(event.participants.late.map(id => getUsernameFromId(chatId, id)));

                const goList = formatParticipantList(event.participants.go, goUsernames, event.comments);
                const cantGoList = formatParticipantList(event.participants.cantGo, cantGoUsernames, event.comments);
                const lateList = formatParticipantList(event.participants.late, lateUsernames, event.comments);


                // Update the event post text with participant lists
                const responseText = `📅 ${event.title}\n${event.description}\n🕗 ${event.time}\n\n🟢 Going:\n${goList}\n\n🔴 Can't Go:\n${cantGoList}\n\n⏰ Late:\n${lateList}`;

                const sentMessage = await bot.sendMessage(
                    userId,
                    `<b>${chatName}</b>\n\nYou haven't responded to the event \n\n${responseText}\n\nPlease check it out <a href="${event.eventLink}">here</a>.`,
                    { parse_mode: 'HTML' }
                );

                // Обновляем remindMsgs
                if (!event.remindMsgs) event.remindMsgs = {};
                event.remindMsgs[userId] = sentMessage.message_id;
                saveEvent(chatId, eventId, event);
                // await bot.sendMessage(userId, `${chatName}\n\nYou haven't responded to the event "${event.title}".\nPlease check it out here: ${event.eventLink}`);
                // console.log(`${chatName}: Reminder sent to user ${userId}`);
            } catch (error) {
                if (error.response && error.response.statusCode === 403) {
                    try {
                        const chatMember = await bot.getChatMember(chatId, userId);
                        const mention = chatMember.user.username
                            ? `@${chatMember.user.username}`
                            : `${chatMember.user.first_name} ${chatMember.user.last_name || ''}`;
                        //console.log(`${chatName}: Cannot DM user ${userId}: ${mention}`);
                        permissionDenied += mention + ' ';
                    } catch (innerErr) {
                        console.error(`Failed to fetch user ${userId}:`, innerErr);
                    }
                } else {
                    console.error(`${chatName}: Failed to send reminder to user ${userId}:`, error.message);
                }
            }
        })).then(() => {
            if (permissionDenied.trim().length > 0) {
                console.error(`${chatName}: ${permissionDenied} cannot receive private messages from the bot.`);
            }
        }).catch(err => {
            console.error(`${chatName}: Error sending reminders:`, err);
        });
    }).catch(err => {
        console.error('341:',err);
    });

}

bot.on('channel_post', async (msg) => {
    console.log(msg); // Посмотри, какие данные приходят

    const text = msg.text || '';
    const match = text.match(/\/(create_event|event) (.+)/s);

    if (match) {
        const [title, description, time] = match[2].split('|').map(s => s.trim());

        await bot.sendMessage(msg.chat.id, `Создано событие: ${title} -+- ${description} -+- ${time}`);
    }
});

bot.onText(/\/tz/, async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const chatType = msg.chat.type;

    if (chatType === 'private') {
        bot.sendMessage(chatId, 'Please run this command in group chat. It makes no sense here')
            .then((sentMessage) => {
            setTimeout(() => {
                bot.deleteMessage(chatId, sentMessage.message_id)
            }, 10000)

        });

    } else {
        const userId = msg.from.id;

        try {
            const member = await bot.getChatMember(chatId, userId);

            if (['administrator', 'creator'].includes(member.status)) {
                const timezones = [];
                for (let i = -11; i <= 12; i++) {
                    const sign = i >= 0 ? '+' : '-';
                    const absVal = Math.abs(i).toString().padStart(2, '0');
                    const offset = `${sign}${absVal}`;
                    timezones.push({ text: `${offset}`, callback_data: `tz_${chatId}|${offset}` });
                }

                // Формируем клавиатуру с 6 кнопками в строке
                const keyboard = [];
                for (let i = 0; i < timezones.length; i += 6) {
                    keyboard.push(timezones.slice(i, i + 6));
                }

                bot.sendMessage(chatId, 'Select your group time zone (UTC+/-):', {
                    ...thread,
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                })
                    .then((sentMessage) => {
                        bot.deleteMessage(chatId, msg.message_id)
                        setTimeout(() => {

                            bot.deleteMessage(chatId, sentMessage.message_id)
                        }, 120000)

                    });
            } else {
                // Пользователь обычный участник
                bot.sendMessage(chatId, 'Only admins can set the timezone.')
                    .then((sentMessage) => {
                        bot.deleteMessage(chatId, msg.message_id)
                        setTimeout(() => {

                            bot.deleteMessage(chatId, sentMessage.message_id)
                        }, 5000)
                    });
            }
        } catch (error) {
            console.error('525 Error checking admin status:', error);
            bot.sendMessage(chatId, 'Error checking your permissions.')
                .then((sentMessage) => {
                    bot.deleteMessage(chatId, msg.message_id)
                    setTimeout(() => {
                        bot.deleteMessage(chatId, sentMessage.message_id)
                    }, 5000)
            });
        }
    }

});


// bot.onText(/\/create_event (.+)/s, (msg, match) => {
bot.onText(/\/(create_event|event) (.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const [title, description, time] = match[2].split('|').map(s => s.trim());

    if (!title || !description || !time) {
        console.error(`Error `, title, description, time);
        bot.sendMessage(chatId, 'Please provide title, description, and time in the format: /create_event Title | Description | Time', thread);
        return;
    }

    const { canDeleteMessages, errMessage } = await checkDeleteMessagePermission(chatId);
    if (!canDeleteMessages ) {
        bot.sendMessage(chatId, errMessage, thread);
        return;
    }
    formattedChatId = Math.abs(chatId).toString().slice(3);
    let eventLink = `https://t.me/c/${formattedChatId}/${msg.message_id+1}`;
    if (thread?.message_thread_id) {
        eventLink = `https://t.me/c/${formattedChatId}/${thread.message_thread_id}/${msg.message_id+1}`;
    }

    event = await newEvent(chatId, thread, msg)
    const update = {
        title,
        description,
        time,
        eventLink,
        originalMessageId: msg.message_id,
        authorId: msg.from.id
    };
    event = { ...event, ...update };
    console.log(605, event)
    eventId = event.id
    saveEvent(chatId, eventId, event);
    const eventText = `📅 ${title}\n${description}\n🕗 ${time}\n\n🟢 Going:\n\n\n🔴 Can't Go:\n\n\n⏰ Late:\n`;

    bot.sendMessage(chatId, eventText, {
        ...thread,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Go', callback_data: `go_${chatId}_${eventId}` },
                { text: 'Can\'t go', callback_data: `cantgo_${chatId}_${eventId}` }],
                [{ text: 'Attend but late', callback_data: `late_${chatId}_${eventId}` }],
                // [{ text: 'Add', callback_data: `add_${chatId}_${eventId}` },
                // { text: 'Remove', callback_data: `remove_${chatId}_${eventId}` }],
                [{ text: `${eventLink}`, url: `${eventLink}` }]
            ]
        }
    }).then((sentMessage) => {
        bot.pinChatMessage(chatId, sentMessage.message_id);
        event.postMessageId = sentMessage.message_id; // Store the event post message ID
        formattedChatId = Math.abs(event.chatId).toString().slice(3);
        event.eventLink = `https://t.me/c/${formattedChatId}/${sentMessage.message_id}`;
        if (event.thread?.message_thread_id) {
            event.eventLink = `https://t.me/c/${formattedChatId}/${event.thread.message_thread_id}/${sentMessage.message_id}`;
        }
        const reminderOptions = [0, 4, 6, 8, 12];
        const reminderButtons = reminderOptions.map(h => ({
            text: `${(event.remindJoin ?? 0)=== h ? '🟩' : '⬜️'}${h === 0 ? '0' : h + 'h'}`,
            callback_data: `remindJoin_${chatId}_${event.id}|${h}`
        }));
        bot.sendMessage(msg.from.id, msg.text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    //[{text: 'Edit', callback_data: `edit_${chatId}_${eventId}`}],
                    [{text: `${eventLink}`, url: `${eventLink}`}],
                    [
                        { text: 'Edit', switch_inline_query_current_chat: `edit:${chatId}:${eventId}: ${event.title}|${event.description}|${event.time}` }
                    ],
                    [
                        { text: '➕ Add player', callback_data: `add_${chatId}_${event.id}` },
                        { text: '➖ Remove player', callback_data: `remove_${chatId}_${event.id}` }
                    ],
                    // [
                    //     { text: '🖼️ Add image', callback_data: `addimage_${chatId}_${event.id}` }
                    // ],
                    [
                        { text: 'Remind to join every X hours:', callback_data: 'noop' }
                    ],
                    reminderButtons

                ]
            }
        }).then((sentAuthorMessage) => {
                bot.deleteMessage(chatId, event.originalMessageId);
                console.log('347', sentAuthorMessage.chat.id, msg.from.id, sentAuthorMessage.chat);

                event.chatBotId = sentAuthorMessage.chat.id;
                event.authorId = msg.from.id;
                event.version = '1.51'
                event.originalMessageId = sentAuthorMessage.message_id
                saveEvent(chatId, eventId, event);
            })

    });
    // schedule.scheduleJob(new Date(Date.parse(time) - 10 * 60 * 1000), () => {
    //     event.participants.go.forEach(userId => {
    //         bot.sendMessage(userId, `Your event "${title}" starts in 10 minutes.`);
    //     });
    //     event.participants.late.forEach(userId => {
    //         bot.sendMessage(userId, `Your event "${title}" starts in 10 minutes.`);
    //     });
    // });
});

const cronJobs = new Map();
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    if (data === 'noop') {
        return;
    }
    const [mainPart, argPart] = data.split('|');
    const [action, chatId, eventId, threadId = null] = mainPart.split('_');
//    const args = argPart.split('_');
    const args = (argPart ?? '').split('_');
    console.log(data, 'args:', args)

    const userId = callbackQuery.from.id;
    // const username = callbackQuery.from.username;
    let thread = threadId ? { message_thread_id: threadId } : {}
    let realThread = callbackQuery.message.message_thread_id ? { message_thread_id: callbackQuery.message.message_thread_id } : {}

    const getUsernameFromId = async (userId) => {
        try {
            const chatMember = await bot.getChatMember(chatId, userId);
            return chatMember.user.username ? `@${chatMember.user.username}` : `${chatMember.user.first_name} ${chatMember.user.last_name || ''}`;
        } catch (error) {
            console.error(`Error fetching username for user ID ${userId}:`, error);
            return null;
        }
    };

    const event = loadEvent(chatId, eventId);

    if (!event && action !== 'tz' && action !== 'captcha' && action !== 'restoreuser') {
        bot.sendMessage(chatId, 'Event not found.');
        console.log('Event not found.', data, event, args);
        return;
    }

    // Remove user from all list7s
    if (['go', 'cantgo', 'late'].includes(action) ) {
        event.participants.go = event.participants.go.filter(id => id !== userId);
        event.participants.cantGo = event.participants.cantGo.filter(id => id !== userId);
        event.participants.late = event.participants.late.filter(id => id !== userId);
    }

    if (action === 'go') {
        event.participants.go.push(userId);
        saveEvent(chatId, eventId, event);
        printEvent(chatId, event, thread);
    } else if (action === 'tz') {
        const groupSettings = loadGS(chatId);
        groupSettings.tz = args[0] ?? groupSettings?.tz ?? "-04";
        saveGS(chatId, groupSettings);
    } else if (action === 'pickdate') {
        event.eDate = args[0]

        if (event.garbage?.calendar?.length) {
            for (const messageId of event.garbage.calendar) {
                bot.deleteMessage(chatId, messageId).catch(() => {});
            }

            // Optionally clear after deletion:
            event.garbage.calendar = [];
        }
        saveEvent(chatId, eventId, event);
        pickTime(chatId, eventId, event);
    } else if (action === 'selecthour') {
        event.eTime = args[0]

        if (event.garbage?.calendar?.length) {
            for (const messageId of event.garbage.calendar) {
                bot.deleteMessage(chatId, messageId).catch(() => {});
            }

            // Optionally clear after deletion:
            event.garbage.calendar = [];
        }
        saveEvent(chatId, eventId, event);
        if (event.description === '') {

        } else {
            printEvent(chatId, event, thread);
        }
    } else if (action === 'remindJoin') {
        // let freq = parseInt(args[1] ?? 0)
        let freq = parseInt(args[0] ?? 0)
        console.log(`554: event.remindJoin = freq = ${freq}`)
        event.remindJoin = freq;
        event.reminder ??= {};
        console.log(event)
        const jobKey = `${chatId}_${eventId}`;
        // Stop old job if exists
        if (cronJobs.has(jobKey)) {
            const job = cronJobs.get(jobKey);
            job.stop();      // Stop the job
            cronJobs.delete(jobKey);  // Remove from the list
        }

        // if (event?.reminder?.join) {
        //     event.reminder.join.stop();
        //     event.reminder.join = null;
        // }
        if ([4, 6, 8, 12].includes(freq)) {
            if (eventId == '1745143303069') {
                job =  cron.schedule(`*/${freq} * * * *`, () => {
                    remindJoinEvent(chatId, eventId)
                    console.log('Freq reminder set to '+freq);
                });
            } else {
                job =  cron.schedule(`0 */${freq} * * *`, () => {
                    remindJoinEvent(chatId, eventId)
                    console.log('Freq reminder set to '+freq);
                });
            }

            cronJobs.set(jobKey, job);
        }
        saveEvent(chatId, eventId, event);
        printEvent(chatId, event, thread);
    } else if (action === 'addimage') {
        bot.sendMessage(event.authorId, `Please reply to this message with an image to add to the event:\nImage for event ID ${event.id}`, realThread)
            .then(sent => {
                event.awaitingImage = sent.message_id;
                saveEvent(chatId, eventId, event);
            });
    } else if (action === 'cantgo') {
        event.participants.cantGo.push(userId);
        saveEvent(chatId, eventId, event);
        printEvent(chatId, event, thread);
    } else if (action === 'late') {
        event.participants.late.push(userId);
        saveEvent(chatId, eventId, event);
        printEvent(chatId, event, thread);
    } else if (action === 'add') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        bot.sendMessage(event.authorId, `Add player:${chatId}:${eventId}:`, realThread)
            .then((sentMessage) => {
                event.addPlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                //printEvent(event.chatId, event, thread);
            });
    } else if (action === 'link') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        bot.sendMessage(chatId, 'Add player:', realThread)
            .then((sentMessage) => {
                event.addPlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                printEvent(event.chatId, event, thread);
            });
    } else if (action === 'captcha') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        const gs = loadGS(chatId);
        if (gs.banned[userId] !== undefined) {
            let captchaParams = gs.banned[userId];
            await bot.deleteMessage(chatId, captchaParams.captchaMessage).catch(() => {});
            console.log('captchaParams', captchaParams, args)
            if(captchaParams.answer == parseInt(args[0])) {
                if (chatId.toString().startsWith('-100')) {
                    unrestrictUser(bot, chatId, userId);
                }
                gs.kicked[userId] = gs.banned[userId];
                delete gs.banned[userId];
                saveGS(chatId, gs);
                bot.sendMessage(chatId, 'Welcome!', realThread)
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id).catch(err =>
                                console.warn('Failed to delete help message:', err.message)
                            );
                        }, 2000);
                    });
            } else {
                bot.sendMessage(chatId, 'Wrong answer! You\'s been banned!', realThread)
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id).catch(err =>
                                console.warn('Failed to delete help message:', err.message)
                            );
                        }, 2000);
                    });
                // const chat = await bot.getChat(chatId);
                // return chat.type;
                if (chatId.toString().startsWith('-100')) {
                    unrestrictUser(bot, chatId, userId);
                    // await bot.kickChatMember(chatId, userId);
                    await bot.banChatMember(chatId, userId);
                } else {
                    await bot.banChatMember(chatId, userId);
                }
            }
        }
    } else if (action === 'restoreuser') {
        const admin = await bot.getChatAdministrators(chatId);
        const isAdmin = admin.some(member => member.user.id === userId);

        if (!isAdmin) {
            bot.sendMessage(chatId, "❌ This command is for admins only.", thread)
                .then((sentMessage) => {
                    setTimeout(() => {
                        bot.deleteMessage(chatId, sentMessage.message_id)
                    }, 3000)

                });
            return;
        } else {
            const gs = loadGS(chatId);

            const targetUserId = args[0];
            delete gs.kicked[targetUserId];
            await bot.unbanChatMember(chatId, targetUserId);

            bot.sendMessage(chatId, `Unbanned!`, thread).then(sent => {
                setTimeout(async () => {

                    await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    await bot.deleteMessage(chatId, messageId).catch(() => {});
                }, 5000);
            });
        }

    } else if (action === 'remove') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        bot.sendMessage(event.authorId, `Remove player:${chatId}:${eventId}:`, realThread)
            .then((sentMessage) => {
                event.removePlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                // printEvent(chatId, event, thread);
            });
    }



});

//
bot.onText(/^@MaoDaoBot edit:(-\d+):(\d+):(.*)/s, (msg, match) => {
    console.log(match, msg.from.id)
// bot.on('edited_message', async (msg) => {
    const chatId = match[1];
    const eventId = match[2];
    const newContent = match[3];
    const event =  loadEvent(chatId, eventId);
    // console.log('442',event)

    if (event.id !== eventId || msg.from.id !== event.authorId) {
    // const chatId = msg.chat.id;
    // const messageId = msg.message_id;
    // const threadId = msg.message_thread_id;
    // let thread = threadId ? { message_thread_id: threadId } : {}

    // Load events for the chat

        const [title, description, time] = newContent.split('|').map(s => s.trim());

        // console.error(`Event: `, event);
        if (!title || !description || !time) {
            bot.sendMessage(msg.from.id, 'Invalid format', );
            return;
        }

        // let thread = event.threadthreadId ? { message_thread_id: threadId } : {}
        // Update event details
        event.title = title;
        event.description = description;
        event.time = time;

        saveEvent(chatId, event.id, event);
        printEvent(chatId, event, event.thread);
        bot.deleteMessage(msg.chat.id, msg.message_id);
    } else {

        console.log('Event id:'+eventId+' not found in group:'+chatId)
        console.log(event.id,eventId,msg.from.id, event.authorId)
    }
});

// bot.onText(/^\/callme (.+)/, (msg, match) => {
bot.onText(/^\/callme(?:@\w+)?\s(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newNickname = match[1].trim();
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    if (!newNickname) {
        bot.sendMessage(chatId, 'Please provide a nickname.', thread).then(sent => {
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, messageId).catch(() => {});
            }, 5000);
        });
        return;
    }

    if (newNickname.length > 64) {
        bot.sendMessage(chatId, 'Nickname is too long. Maximum allowed length is 64 characters.', thread).then(sent => {
            setTimeout(() => {
                bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                bot.deleteMessage(chatId, messageId).catch(() => {});
            }, 5000);
        });
        return;
    }

    const groupSettings = loadGS(chatId);
    if (!groupSettings.nicknames) {
        groupSettings.nicknames = {};
    }

    groupSettings.nicknames[userId] = newNickname;
    saveGS(chatId, groupSettings);

    bot.sendMessage(chatId, `Your nickname has been set to: ${newNickname}`, thread).then(sent => {
        setTimeout(async () => {
            await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            await bot.deleteMessage(chatId, messageId).catch(() => {});
        }, 5000);
    });
});

bot.onText(/^\/protect$/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    const groupSettings = loadGS(chatId);

    groupSettings.protect = 'on';
    if(!groupSettings.banned) {
        groupSettings.banned = {};
    }
    if(!groupSettings.kicked) {
        groupSettings.kicked = {};
    }

    saveGS(chatId, groupSettings);

    bot.sendMessage(chatId, `New user should pass captcha now!`, thread).then(sent => {
        setTimeout(async () => {
            await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            await bot.deleteMessage(chatId, messageId).catch(() => {});
        }, 5000);
    });
});
bot.onText(/^\/unprotect$/, adminMiddleware((msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    const groupSettings = loadGS(chatId);

    groupSettings.protect = 'off';
    saveGS(chatId, groupSettings);

    bot.sendMessage(chatId, `Protection is off!`, thread).then(sent => {
        setTimeout(async () => {
            await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            await bot.deleteMessage(chatId, messageId).catch(() => {});
        }, 5000);
    });
}));

bot.onText(/^\/ban (\d+)$/, adminMiddleware(async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const targetUserId = match[1];
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    const gs = loadGS(chatId);

    try {
        const chatMember = await bot.getChatMember(chatId, targetUserId);
        const user = chatMember.user;
        if (gs.banned[targetUserId] !== undefined) {
            gs.kicked[targetUserId] = gs.banned[targetUserId]
            delete gs.banned[targetUserId];
        } else {
            gs.kicked[targetUserId]= {
                'date': new Date().getTime(),
                'reason': 'Admin request',
                'user': targetUserId,
                'name': user.first_name,
                'username': user.username,
                'ttl': new Date().getTime()+1,
                'answer': 'admin'
            };
        }
        saveGS(chatId, gs)
        await bot.banChatMember(chatId, targetUserId);
        bot.sendMessage(chatId, `${user.first_name} has been Banned!`, thread).then(sent => {
            setTimeout(async () => {
                await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                await bot.deleteMessage(chatId, messageId).catch(() => {});
            }, 5000);
        });
    } catch (error) {
        bot.sendMessage(chatId, `${error} User not found in chat member list!`, thread).then(sent => {
            setTimeout(async () => {
                await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                await bot.deleteMessage(chatId, messageId).catch(() => {});
            }, 5000);
        });
    }
}));

bot.onText(/^\/unban (\d+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const targetUserId = match[1];
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    const gs = loadGS(chatId);

// Unban the user completely
    delete gs.kicked[targetUserId];
    await bot.unbanChatMember(chatId, targetUserId);

    bot.sendMessage(chatId, `Unbanned!`, thread).then(sent => {
        setTimeout(async () => {
            await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            await bot.deleteMessage(chatId, messageId).catch(() => {});
        }, 5000);
    });
});



bot.onText(/^\/kicked$/, adminMiddleware(async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    const messageId = msg.message_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    const gs = loadGS(chatId);

    if (!gs.kicked || Object.keys(gs.kicked).length === 0) {
        bot.sendMessage(chatId, "📭 No recently kicked users found.", thread).then(sent => {
            setTimeout(async () => {
                await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                await bot.deleteMessage(chatId, messageId).catch(() => {});
            }, 5000);
        });
        return;
    }

    const recentKicks = Object.entries(gs.kicked)
        .sort(([,a], [,b]) => b.date - a.date)
        .slice(0, 10); // Last 10 users

    let message = "🔴 **Recently Kicked Users**\n\n";
    const keyboard = [];

    recentKicks.forEach(([userId, kickData], index) => {
        const timeAgo = Math.floor((Date.now() - kickData.date) / 1000 / 60); // minutes ago
        const userInfo = `@${kickData.username || kickData.name}`;

        message += `${index + 1}. ${userInfo} (${timeAgo}m ago)\\-\n`;
        // message += `   Reason: ${kickData.reason}\\-\n\n`;

        // Add restore button for each user
        keyboard.push([
            {
                text: `✅ Restore ${kickData.name}`,
                callback_data: `restoreuser_${chatId}|${userId}`
            }
        ]);
    });
    // keyboard.push([
    //     { text: "🔄 Refresh", callback_data: "refresh_kicks" },
    //     { text: "🗑️ Clear All", callback_data: "clear_all_kicks" }
    // ]);

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: keyboard
        },
        ...thread
    };


    bot.sendMessage(chatId, message, options).then(sent => {
        setTimeout(async () => {
            await bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            await bot.deleteMessage(chatId, messageId).catch(() => {});
        }, 20000);
    });
}));


// bot.onText(/@MaoDaoBot edit:(-\d+)/, (msg, match) => {
// // bot.onText(/@MaoDaoBot edit:(\d+):(\d+):(.*)/, (msg, match) => {
//         console.log(match)
//
// });

// bot.on('new_chat_members', (msg) => {
//     const chatId = msg.chat.id;
//     const userId = msg.from.id;
//     const threadId = msg.message_thread_id;
//     let thread = threadId ? { message_thread_id: threadId } : {}
//
//     bot.sendMessage(
//         chatId,
//         `Welcome! Please click [here](https://t.me/MaoDaoBot?start=from_group) to start interacting with me in private chat.`,
//         { parse_mode: 'Markdown', ...thread }
//     );
//
//
//     const group = loadGroup(chatId);
//     if (!group.has(userId)) {
//         group.add(userId);
//         saveGroup(chatId, group);
//         bot.getChat(chatId).then(chat => {
//             const chatName = chat.title || chat.username || chat.first_name || chat.last_name;
//             bot.sendMessage(chatId, `You have joined the "all" group in chat: ${chatName}`, thread);
//         }).catch(err => {
//             bot.sendMessage(userId, `You have joined the "all" group in chat: ${chatId}`);
//             console.error(err);
//         });
//     } else {
//         bot.sendMessage(chatId, 'You are already a member of the "all" group.', thread);
//     }
// });
// Enable this via bot.start({ allowed_updates: ['chat_member'] })
bot.on('chat_member', async (ctx) => {
    // console.log('chat_member',ctx) // very cool event!
    // const update = ctx.chatMember;
    const chatId = ctx.chat.id;
    const threadId = ctx?.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {};
    const userId = ctx.new_chat_member.user.id
    const gs = loadGS(chatId);
    if(gs.protect === 'on' && ctx.chat.type === 'supergroup') {
        if (ctx.new_chat_member.status === 'member' &&
            ctx.old_chat_member.status === 'left') {

            // User joined
            console.log('User joined via chat_member:', ctx.new_chat_member.user.id);
            await handleNewUserJoin(ctx.chat, userId, gs, thread, ctx.new_chat_member.user);
        }
    }

});

async function handleNewUserJoin(chat, userId, groupSettings, thread, newMember) {
    const chatId = chat.id;
    console.log('protect on handleNewUserJoin', chatId, userId, groupSettings, thread, newMember);
    if (!groupSettings.banned) {
        groupSettings.banned = {};
        groupSettings.kicked = {};
    }

    const correctAnswer = generateRandomNumber(0, 100);
    groupSettings.banned[userId] = {
        'date': new Date().getTime(),
        'reason': 'New member',
        'user': userId,
        'name': newMember.first_name,
        'username': newMember.username,
        'ttl': new Date().getTime()+180,
        'answer': correctAnswer
    };
    saveGS(chatId, groupSettings);
    const isSupergroup = chat.type === 'supergroup';
    const isGroup = chat.type === 'group';
    if(isSupergroup) {
       await restrictUser(bot, chatId, userId);
    }

    const keyboard = await createCaptchaKeyboard(correctAnswer, chatId );

    const captchaMessage = await bot.sendMessage(
        chatId,
        `👋 Добро пожаловать, ${newMember.first_name}!\n\n` +
        `Если вы не бот, выберете цифру которую вы видите на экране \n>>> ${correctAnswer} <<<\n\n` +
        `У вас есть 2 минуты чтобы ответить.`,
        {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
            ...thread
        }
    );
    groupSettings.banned[userId].captchaMessage = captchaMessage.message_id;
    saveGS(chatId, groupSettings);

    const timeout = setTimeout(async ()  => {
        const gs = loadGS(chatId);

        bot.deleteMessage(chatId, captchaMessage.message_id); // Удаляем captchaMessage
        // Время вышло - кикаем пользователя
        if (gs.banned[userId] !== undefined) {
            try {
                // await bot.kickChatMember(chatId, userId);
                if (isSupergroup) {
                    // await bot.unrestrictChatMember(chatId, userId);
                    unrestrictUser(bot, chatId, userId);
                    // await bot.kickChatMember(chatId, userId);
                    await bot.banChatMember(chatId, userId);
                } else {
                    await bot.banChatMember(chatId, userId);
                }

                await bot.sendMessage(
                    chatId,
                    `⏰ Время вышло! ${newMember.first_name} не прошел проверку.`,
                    thread
                );

                gs.kicked[userId] = gs.banned[userId];
                delete gs.banned[userId];
                saveGS(chatId, gs);
            } catch (error) {
                if (!error.response?.body?.description?.includes('USER_NOT_PARTICIPANT')) {
                    console.error('Error kicking user:', error);
                }
                // console.error('Error kicking user:', error);
            }
        }
    }, 2 * 60 * 1000); // 2 минуты
}

bot.on('new_chat_members',async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {};
    console.log('new_chat_members handler!')

    msg.new_chat_members.forEach(async (newMember) => {
        const userId = newMember.id; // Get the correct user ID
        if(userId == '7202342115') return;

        // if (newMember.is_bot) continue; //not sure if this is needed
        const groupSettings = loadGS(chatId);
        console.log('groupSettings.protect :', groupSettings.protect ?? 'off');
        if(groupSettings.protect === 'on') {
            console.log('protect on new_chat_members');
            await handleNewUserJoin(msg.chat, userId, groupSettings, thread, newMember);


        } else {
            bot.sendMessage(
                chatId,
                `Welcome, ${newMember.first_name}! Please click [here](https://t.me/MaoDaoBot?start=from_group) to start interacting with me in private chat.`,
                { parse_mode: 'Markdown', ...thread }
            );

            const group = loadGroup(chatId);
            if (!group.has(userId)) {
                group.add(userId);
                saveGroup(chatId, group);

                bot.getChat(chatId).then(chat => {
                    const chatName = chat.title || chat.username || chat.first_name || chat.last_name;
                    bot.sendMessage(chatId, `${newMember.first_name}, you have joined the "all" group in chat: ${chatName}`, thread);
                }).catch(err => {
                    bot.sendMessage(userId, `You have joined the "all" group in chat: ${chatId}`);
                    console.error(err);
                });
            } else {
                bot.sendMessage(chatId, `${newMember.first_name}, you are already a member of the "all" group.`, thread);
            }
        }



    });
});

bot.on('left_chat_member', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.left_chat_member.id;

    const group = loadGroup(chatId);
    if (group.has(userId)) {
        group.delete(userId);
        saveGroup(chatId, group);
    }
});


bot.on('edited_message', async (msg) => {

    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}

    // Load events for the chat
    const events = loadEvents(chatId);
    const event = events.find(event => event.originalMessageId === messageId);

    if (event) {
        const [title, description, time] = msg.text.replace(/^\/(?:create_event|event)\s*/, '').split('|').map(s => s.trim());

        // console.error(`Event: `, event);
        if (!title || !description || !time) {
            console.error(`Error `, title, description, time);
            bot.sendMessage(chatId, 'Please provide title, description, and time in the format: /create_event Title | Description | Time', thread);
            return;
        }

        // Update event details
        event.title = title;
        event.description = description;
        event.time = time;

        saveEvent(chatId, event.id, event);
        printEvent(chatId, event, thread);

    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const thread = threadId ? { message_thread_id: threadId } : {};

    const helpText = `
<b>Список команд бота:</b>

<b>Основные команды:</b>
/start - Необходимо выполнить эту команду в личном сообщении к боту. 
     Это даст возможность получать личные сообщения от бота.
     Эти сообщения используются для напоминаний о мероприятиях и ивентах.
     А также для оповещения командой "/notify_all".
/help - Показать это справочное сообщение

<b>Команды группы "all":</b>
/join или /join_all - Присоединиться к группе "all"
/leave или /leave_all - Покинуть группу "all"
/add_all @username1 @username2 - Добавить пользователей в группу "all" (только для админов)
/show_all - Показать список участников группы "all" (только для админов)
/notify_all сообщение - Отправить сообщение всем участникам группы "all"

<b>Команды событий:</b>
/event или /create_event Название и дата  | Описание | Время - Создать новое событие
Пример: /event Воскресенье, 25 декабря 2023, Хоккей | Игра на льду | 20:00
/tz - Установить часовой пояс группы (только для админов)

<b>Персональные команды:</b>
/callme Никнейм - Установить свой никнейм в группе
Пример: /callme Хоккейный фанат

<b>Как использовать события:</b>
1. Создайте событие командой /event
2. Участники могут нажимать кнопки:
   - "Go" - Я иду
   - "Can't go" - Не смогу прийти
   - "Attend but late" - Приду, но позже
3. Можно отвечать на сообщение события, чтобы добавить комментарий
4. Организатор может добавлять/удалять участников через кнопки в личном чате с ботом

Все команды работают как в групповых чатах, так и в личных сообщениях с ботом.
`;

    bot.sendMessage(chatId, helpText, {
        ...thread,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    }).then((sentMessage) => {
        // Удалить сообщение через 2 минуты
        setTimeout(() => {
            bot.deleteMessage(chatId, sentMessage.message_id).catch(err =>
                console.warn('Failed to delete help message:', err.message)
            );
        }, 120000);
    });
});

bot.on('message', async (msg) => {
    let chatId = msg.chat.id;
    // const messageId = msg.message_id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}

    if (msg.reply_to_message) {
        // const isFromBot = msg.reply_to_message.from?.id === bot.getMe().then(me => me.id);
        //
        // if (!isFromBot) {
        //     return ;
        // }

        const repliedMessageId = msg.reply_to_message.message_id;
        // const originalText = msg.reply_to_message.text
        const originalText = msg.reply_to_message?.text ?? '';
        // const match = originalText.match(/^Add player:(-?\d+):(\d+):/);
        const match = originalText.match(/^(Add|Remove) player:(-?\d+):(\d+):/);

        if (match) {
            chatId = match[2];
            //const eventId = match[3];
        }

        const events = loadEvents(chatId);
        const event = events.find(event => event.postMessageId === repliedMessageId);
        const eventAdd = events.find(event => event.addPlayerMsgId === repliedMessageId);
        const eventRemove = events.find(event => event.removePlayerMsgId === repliedMessageId);

        if (event) {

            if (
                event.participants.go.includes(userId) ||
                event.participants.cantGo.includes(userId) ||
                event.participants.late.includes(userId)
            ) {
                if (event.comments === undefined) {
                    event.comments = {}
                }
                event.comments[''+userId+''] = msg.text

                saveEvent(chatId, event.id, event);
                printEvent(chatId, event, thread);

                bot.deleteMessage(chatId, msg.message_id).catch((error) => {
                    if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                        console.log(msg.text)
                        console.log("The message can't be deleted. It might be too old or already deleted.");
                        // Handle the case, e.g., by logging or ignoring the error
                    } else {
                        // Handle other errors
                        console.error("Failed to delete message:", error);
                    }
                });

            } else {
                bot.sendMessage(chatId, "You should attend to this event before you can comment", thread)
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id)
                        }, 10000)

                    });
            }
        } else if (eventAdd) {

            if (
                msg.text && (msg.text.trim() !== '')
                && !eventAdd.participants.go.includes('#'+msg.text+'#')
            ) {
                eventAdd.participants.go.push('#'+msg.text+'#');
                eventAdd.addPlayerMsgId = null;
                saveEvent(chatId, eventAdd.id, eventAdd);
                printEvent(chatId, eventAdd, thread);
            }


            bot.deleteMessage(msg.chat.id, msg.message_id).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("478 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });

            bot.deleteMessage(msg.chat.id, repliedMessageId).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("489 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });
        } else if (eventRemove) {

            if (
                msg.text && (msg.text.trim() !== '')
                && eventRemove.participants.go.includes('#'+msg.text+'#')
            ) {

                eventRemove.participants.go = eventRemove.participants.go.filter(id => id !== '#'+msg.text+'#');
                // eventRemove.participants.go.filter(function (id) {
                //     return id !== ;
                // });
                eventRemove.removePlayerMsgId = null;
                saveEvent(chatId, eventRemove.id, eventRemove);
                printEvent(chatId, eventRemove, thread);
            }


            bot.deleteMessage(msg.chat.id, msg.message_id).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("512 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });

            bot.deleteMessage(msg.chat.id, repliedMessageId).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("523 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });
        }
    }
});

// Helper function to format participant lists
const formatParticipantList = function (participants, usernames, comments) {
    return usernames.map((username, index) => {
        let participantId = participants[index];
        let str = `${index + 1}. <a href="tg://user?id=${participantId}">${username}</a>`;
        if (participantId.length >= 2 && participantId[0] === '#' && participantId[participantId.length - 1] === '#') {
            str = `${index + 1}. ${username}`;
        }

        if (comments.hasOwnProperty(participantId)) {
            if (comments[participantId].trim().length > 0) {
                str += ' ' + comments[participantId];
            }
        }
        return str;
    }).join('\n');
}

const getUsernameFromId = async (chatId, userId) => {
    try {
        // Виртуальные участники вида #Name#
        if (typeof userId === 'string' && userId.startsWith('#') && userId.endsWith('#')) {
            return userId.slice(1, -1);
        }

        const groupSettings = loadGS(chatId);
        const nickname = groupSettings.nicknames?.[userId];

        const chatMember = await bot.getChatMember(chatId, userId);
        const baseName = chatMember.user.username
            ? `@${chatMember.user.username}`
            : `${chatMember.user.first_name} ${chatMember.user.last_name || ''}`;

        return nickname ? `${nickname}` : baseName;
    } catch (error) {
        console.error(`Error fetching username for user ID ${userId}:`, error);
        return 'Unknown';
    }
};


const printEvent = async (chatId, event, thread) => {
    // Fetch usernames for participants
    const goUsernames = await Promise.all(event.participants.go.map(id => getUsernameFromId(chatId, id)));
    const cantGoUsernames = await Promise.all(event.participants.cantGo.map(id => getUsernameFromId(chatId, id)));
    const lateUsernames = await Promise.all(event.participants.late.map(id => getUsernameFromId(chatId, id)));

    // Format participant lists
    const goList = formatParticipantList(event.participants.go, goUsernames, event.comments);
    const cantGoList = formatParticipantList(event.participants.cantGo, cantGoUsernames, event.comments);
    const lateList = formatParticipantList(event.participants.late, lateUsernames, event.comments);


    // Update the event post text with participant lists
    const responseText = `📅 ${event.title}\n${event.description}\n🕗 ${event.time}\n\n🟢 Going:\n${goList}\n\n🔴 Can't Go:\n${cantGoList}\n\n⏰ Late:\n${lateList}`;
    //
    // // Edit the event post text
    // if (event.imageFileId) {
    //     await bot.sendPhoto(chatId, event.imageFileId, { ...thread });
    // }
    bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: event.postMessageId, // Store and use the message ID of the event post
        ...thread,
        parse_mode: 'HTML',
        "disable_web_page_preview": true,
        reply_markup: {
            inline_keyboard: [
                [{text: 'Go', callback_data: `go_${chatId}_${event.id}`},
                {text: 'Can\'t go', callback_data: `cantgo_${chatId}_${event.id}`}],
                [{text: 'Attend but late', callback_data: `late_${chatId}_${event.id}`}],
                // [{ text: 'Add', callback_data: `add_${chatId}_${event.id}` },
                // { text: 'Remove', callback_data: `remove_${chatId}_${event.id}` }],
                [{ text: `${event.eventLink}`, url: `${event.eventLink}` }]
            ]
        }
    }).catch(error => {
        if (error.response.body.error_code === 400 && error.response.body.description.includes('message is not modified')) {
            console.log('Attempted to modify a message with identical content.');
        } else {
            throw error; // or handle other errors
        }
    });
    console.log('Setting reaction with thread:', thread);


    if (event.version >= '1.51') {
        const reminderOptions = [0, 4, 6, 8, 12];
        const reminderButtons = reminderOptions.map(h => ({
            text: `${(event.remindJoin ?? 0)=== h ? '🟩' : '⬜️'}${h === 0 ? '0' : h + 'h'}`,
            callback_data: `remindJoin_${chatId}_${event.id}|${h}`
        }));

        bot.editMessageText(`/event ${event.title}|${event.description}|${event.time}`, {
            chat_id: event.chatBotId,
            message_id: event.originalMessageId, // Store and use the message ID of the event post
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: `${event.eventLink}`, url: `${event.eventLink}`}],
                    [
                        { text: 'Edit', switch_inline_query_current_chat: `edit:${chatId}:${event.id}: ${event.title}|${event.description}|${event.time}` }
                    ],
                    [
                        { text: '➕ Add player', callback_data: `add_${chatId}_${event.id}` },
                        { text: '➖ Remove player', callback_data: `remove_${chatId}_${event.id}` }
                    ],
                    // [
                    //     { text: '🖼️ Add image', callback_data: `addimage_${chatId}_${event.id}` }
                    // ],
                    [
                        { text: 'Remind to join every X hours:', callback_data: 'noop' },
                    ],
                    reminderButtons
                ]
            }
        }).catch(error => {
            if (error.response.body.error_code === 400 && error.response.body.description.includes('message is not modified')) {
                console.log('Attempted to modify a message to author with identical content.');
            } else {
                throw error; // or handle other errors
            }
        });
    }

}

function generateDateKeyboard(chatId, eventId) {
    const today = new Date();
    const dates = [];
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (let i = 0; i < 25; i++) {
        const d = new Date(today.getTime() + i * oneDayMs);
        dates.push({
            // label: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
            label: d.getDate().toString(),
            data: d.toISOString().split('T')[0], // YYYY-MM-DD
            dayOfWeek: d.getDay() === 0 ? 7 : d.getDay() // Mon=1...Sun=7
        });
    }
    const dayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const headerRow = dayLabels.map(label => ({
        text: label,
        callback_data: 'noop'
    }));

    // Формируем недельные строки
    const rows = [headerRow]; // <-- добавляем заголовок

    let weekRow = new Array(7).fill(null);
    dates.forEach(date => {
        weekRow[date.dayOfWeek - 1] = {
            text: date.label,
            callback_data: `pickdate_${chatId}_${eventId}|${date.data}`
        };

        // Если это воскресенье или последний элемент — пушим строку
        if (date.dayOfWeek === 7 || date === dates[dates.length - 1]) {
            // заполняем пустые ячейки
            for (let i = 0; i < 7; i++) {
                if (!weekRow[i]) {
                    weekRow[i] = { text: ' ', callback_data: 'noop' };
                }
            }
            rows.push(weekRow);
            weekRow = new Array(7).fill(null);
        }
    });

    return {
        text: '📅 Выберите дату:',
        reply_markup: {
            inline_keyboard: rows
        }
    };
}

function generateTimeKeyboard(chatId, userId, eventId, state = {}) {
    const rows = [];
    const hourRow = [];
    for (let h = 8; h < 23; h++) {
        const hStr = h.toString().padStart(2, '0');
        const display = `${h}:${'00'}`;
        hourRow.push({
            text: state.hour === hStr ? `🕐${display}` : display,
            callback_data: `selecthour_${chatId}_${eventId}|${hStr}`
        });
        if ((h-2) % 5 === 0) rows.push(hourRow.splice(0, hourRow.length));
    }
    if (hourRow.length > 0) {
        rows.push(hourRow);
    }

    return {
        text: `⏰ Выберите время:`,
        reply_markup: {
            inline_keyboard: [
                ...rows,
                // minuteRow,
                // saveButton
            ]
        }
    };
}


bot.onText(/^\/new$/, async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {};
    const event = await newEvent(chatId, thread, msg)
    if (msg.chat.type === 'private') {
        return bot.sendMessage(msg.chat.id, '⚠️ This command can only be used in a group.')
            .then(sent => {
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 3000);
            });
    } else {
        console.log(1370, event, event.id)
        const calendar = generateDateKeyboard(chatId,event.id);
        bot.sendMessage(chatId, calendar.text, { ...thread, ...calendar })
            .then(sent => {
                event.garbage = {};
                event.garbage.calendar = [sent.message_id, msg.message_id];
                saveEvent(chatId, event.id, event);
                setTimeout(() => {
                    bot.deleteMessage(chatId, sent.message_id).catch(() => {});
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                }, 10000);
            });
        ;
    }

});

async function pickTime(chatId, eventId, event) {
    const timeKeyboard = generateTimeKeyboard(chatId, event.authorId, eventId)
    console.log(timeKeyboard)
    bot.sendMessage(chatId, timeKeyboard.text, { ...event.thread, ...timeKeyboard })
        .then(sent => {
            event.garbage = {};
            event.garbage.calendar = [sent.message_id];
            saveEvent(chatId, eventId, event);

        });
}

bot.onText(/^\/reaction/, async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;

    if (!threadId) {
        bot.sendMessage(chatId, 'This command only works in a topic (thread).');
        return;
    }


    const botUser = await bot.getMe();
    const info = await bot.getChatMember(chatId, botUser.id);
    console.log('Bot status:', info.status);
    console.log('Bot permissions:', info);

    try {
        // Send message to the same thread
        const sentMsg = await bot.sendMessage(chatId, 'React to this message!', {
            message_thread_id: threadId
        });
        console.log(`Message ${sentMsg.message_id} in thread ${threadId} chatId ${chatId} sent`);
        // Add emoji reactions
        const reaction = [
            // { type: 'emoji', emoji: '🔥' },
            { type: 'emoji', emoji: '💯' },
            // { type: 'emoji', emoji: '👍' }
        ];
        const reaction1 = [
            // { type: 'emoji', emoji: '🔥' }
            { type: 'emoji', emoji: '😢' }
            // { type: 'emoji', emoji: '👍' }
        ];
        await bot.setMessageReaction(chatId, sentMsg.message_id, {reaction: JSON.stringify(reaction)}, { message_thread_id: threadId });
        // await bot.setMessageReaction(chatId, sentMsg.message_id, {reaction: JSON.stringify(reaction1)}, { message_thread_id: threadId });

        console.log(`Reactions set for message ${sentMsg.message_id} in thread ${threadId}`);
    } catch (err) {
        console.error('Error setting reaction:', err.response?.body || err);
        bot.sendMessage(chatId, 'Failed to send message or set reactions.', {
            message_thread_id: threadId
        });
    }
});

// const testEmojis = ["👍", '👎', '❤️', '🔥', '🥲', '🎉', '💯', '🤔', '😢', '❓', '👀',
// "✅" ,"❎" ,"☑️" ,"⬜️" ,"🟥" ,"✅"];
const testEmojis = [
    // Основные реакции
    '👍', '👎', '❤️', '🔥', '🥰', '😆', '🤔', '😮', '😢', '🎉',

    // Специальные отметки
    '✅', '✔️', '☑️', '❎', '✖️', '❌', '⭕', '🚫',

    // Альтернативные варианты
    '🔴', '🟢', '🔵', '🟣', '⚪', '⚫',

    // Дополнительные
    '❗', '❕', '⁉️', '‼️', '💯', '🔺', '🔻'
];
bot.onText(/^\/test_reactions/, async (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;

    if (!threadId) {
        bot.sendMessage(chatId, 'Please use this command inside a topic (thread).');
        return;
    }

    try {
        const sentMsg = await bot.sendMessage(chatId, 'Testing available reactions...', {
            message_thread_id: threadId
        });

        console.log(`Testing reactions on message ${sentMsg.message_id}`);

        const allowed = [];
        const denied = [];

        for (const emoji of testEmojis) {
            const reaction = [
                { type: 'emoji', emoji }
            ]
            try {
                await bot.setMessageReaction(chatId, sentMsg.message_id, {reaction: JSON.stringify(reaction)}, { message_thread_id: threadId });

                console.log(`✅ Reaction allowed: ${emoji}`);
                allowed.push(emoji);
            } catch (err) {
                const desc = err.response?.body?.description || '';
                if (desc.includes('REACTION_EMPTY')) {
                    console.log(`❌ Reaction blocked: ${emoji}`);
                    denied.push(emoji);
                } else {
                    console.error(`⚠️ Unexpected error for ${emoji}:`, desc);
                    denied.push(`${emoji} (error)`);
                }
            }
        }

        // Report results
        await bot.sendMessage(chatId,
            `✅ Allowed: ${allowed.join(' ')}\n❌ Blocked: ${denied.join(' ')}`,
            { message_thread_id: threadId }
        );

    } catch (err) {
        console.error('Failed to test reactions:', err);
        bot.sendMessage(chatId, 'Failed to perform reaction test.', {
            message_thread_id: threadId
        });
    }
});

bot.onText(/(.*)/s, captchaMiddleware((msg, match) => {
    console.log('Processing non-command message:', msg.chat.username, msg.chat.id, msg.chat.type, msg.text);
}));