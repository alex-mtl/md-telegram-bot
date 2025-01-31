const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Read the API token from the 'tg-token' file
const TOKEN = fs.readFileSync('tg-token', 'utf8').trim();

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(TOKEN, { polling: true });

// Directory to store the group member files
const GROUP_DIR = 'groups';


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
                errMessage: 'Bot is not an administrator.',
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



bot.onText(/\/notify_all\s+((.|\n)+)/, (msg, match) => {
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

function loadEvents(chatId) {
    const eventsDir = path.join(__dirname, 'events');
    const eventFiles = fs.readdirSync(eventsDir).filter(file => file.startsWith(`${chatId}_`));

    return eventFiles.map(file => {
        const eventId = file.split('_')[1].split('.')[0];
        return loadEvent(chatId, eventId);
    }).filter(event => event !== null);
}

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

    const eventId = new Date().getTime();
    const event = {
        id: eventId,
        chatId,
        thread,
        title,
        description,
        time,
        eventLink,
        originalMessageId: msg.message_id,
        authorId: msg.from.id,
        addPlayerMsgId: null,
        removePlayerMsgId: null,
        comments: {},
        participants: {
            go: [],
            cantGo: [],
            late: []
        }
    };

    saveEvent(chatId, eventId, event);
    const eventText = `📅 ${title}\n${description}\n🕗 ${time}\n\n🟢 Going:\n\n\n🔴 Can't Go:\n\n\n⏰ Late:\n`;

    bot.sendMessage(chatId, eventText, {
        ...thread,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Go', callback_data: `go_${chatId}_${eventId}` },
                { text: 'Can\'t go', callback_data: `cantgo_${chatId}_${eventId}` }],
                [{ text: 'Attend but late', callback_data: `late_${chatId}_${eventId}` }],
                [{ text: 'Add', callback_data: `add_${chatId}_${eventId}` },
                { text: 'Remove', callback_data: `remove_${chatId}_${eventId}` }],
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
        bot.sendMessage(msg.from.id, msg.text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    //[{text: 'Edit', callback_data: `edit_${chatId}_${eventId}`}],
                    [{text: `${eventLink}`, url: `${eventLink}`}],
                    [
                        { text: 'Edit', switch_inline_query_current_chat: `edit:${chatId}:${eventId}: ${event.title}|${event.description}|${event.time}` }
                    ]
                ]
            }
        }).then((sentAuthorMessage) => {
                bot.deleteMessage(chatId, event.originalMessageId);
                console.log('347', sentAuthorMessage.chatId, msg.from.id, sentAuthorMessage.chat);

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


bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const [action, chatId, eventId, threadId = null] = data.split('_');
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

    if (!event) {
        bot.sendMessage(chatId, 'Event not found.');
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
        bot.sendMessage(chatId, 'Add player:', realThread)
            .then((sentMessage) => {
                event.addPlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                printEvent(event.chatId, event, thread);
            });
    } else if (action === 'link') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        bot.sendMessage(chatId, 'Add player:', realThread)
            .then((sentMessage) => {
                event.addPlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                printEvent(event.chatId, event, thread);
            });
    } else if (action === 'remove') {
        // bot.sendMessage(userId, 'Please enter the name or ID of the player to add:');
        bot.sendMessage(chatId, 'Remove player:', realThread)
            .then((sentMessage) => {
                event.removePlayerMsgId = sentMessage.message_id
                saveEvent(chatId, eventId, event);
                printEvent(chatId, event, thread);
            });
    }



});

//
bot.onText(/@MaoDaoBot edit:(-\d+):(\d+):(.*)/s, (msg, match) => {
    console.log(match, msg.from.id)
// bot.on('edited_message', async (msg) => {
    const chatId = match[1];
    const eventId = match[2];
    const newContent = match[3];
    const event =  loadEvent(chatId, eventId);
    console.log('442',event)

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

bot.on('new_chat_members', (msg) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {};

    msg.new_chat_members.forEach((newMember) => {
        const userId = newMember.id; // Get the correct user ID

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
    });
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


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    // const messageId = msg.message_id;
    const userId = msg.from.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}

    if (msg.reply_to_message) {

        const repliedMessageId = msg.reply_to_message.message_id;
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


            bot.deleteMessage(chatId, msg.message_id).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("478 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });

            bot.deleteMessage(chatId, repliedMessageId).catch((error) => {
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


            bot.deleteMessage(chatId, msg.message_id).catch((error) => {
                if (error.response.body.error_code === 400 && error.response.body.description.includes("message can't be deleted")) {
                    console.log(msg.text)
                    console.log("512 The message can't be deleted. It might be too old or already deleted.");
                    // Handle the case, e.g., by logging or ignoring the error
                } else {
                    // Handle other errors
                    console.error("Failed to delete message:", error);
                }
            });

            bot.deleteMessage(chatId, repliedMessageId).catch((error) => {
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
        if (userId.length >= 2 && userId[0] === '#' && userId[userId.length - 1] === '#') {
            const player = userId.slice(1, -1)
            return player;
        } else {
            const chatMember = await bot.getChatMember(chatId, userId);
            return chatMember.user.username ? `@${chatMember.user.username}` : `${chatMember.user.first_name} ${chatMember.user.last_name || ''}`;
        }

    } catch (error) {
        console.error(`Error fetching username for user ID ${userId}:`, error);
        return null;
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
    bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: event.postMessageId, // Store and use the message ID of the event post
        ...thread,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{text: 'Go', callback_data: `go_${chatId}_${event.id}`},
                {text: 'Can\'t go', callback_data: `cantgo_${chatId}_${event.id}`}],
                [{text: 'Attend but late', callback_data: `late_${chatId}_${event.id}`}],
                [{ text: 'Add', callback_data: `add_${chatId}_${event.id}` },
                { text: 'Remove', callback_data: `remove_${chatId}_${event.id}` }],
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

    if (event.version >= '1.51') {
        bot.editMessageText(`/event ${event.title}|${event.description}|${event.time}`, {
            chat_id: event.chatBotId,
            message_id: event.originalMessageId, // Store and use the message ID of the event post
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{text: `${event.eventLink}`, url: `${event.eventLink}`}],
                    [
                        { text: 'Edit', switch_inline_query_current_chat: `edit:${chatId}:${event.id}: ${event.title}|${event.description}|${event.time}` }
                    ]
                ]
            }
        })
    }

}