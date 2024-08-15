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

// event management
const EVENT_DIR = 'events';

if (!fs.existsSync(EVENT_DIR)) {
    fs.mkdirSync(EVENT_DIR);
}

function getEventFile(chatId, eventId) {
    return path.join(EVENT_DIR, `${chatId}_${eventId}.json`);
}

function saveEvent(chatId, eventId, event) {
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
bot.onText(/\/create_event (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    let thread = threadId ? { message_thread_id: threadId } : {}
    const [title, description, time] = match[1].split('|').map(s => s.trim());

    if (!title || !description || !time) {
        console.error(`Error `, title, description, time);
        bot.sendMessage(chatId, 'Please provide title, description, and time in the format: /create_event Title | Description | Time', thread);
        return;
    }

    const eventId = new Date().getTime();
    const event = {
        id: eventId,
        title,
        description,
        time,
        originalMessageId: msg.message_id,
        comments: {},
        participants: {
            go: [],
            cantGo: [],
            late: []
        }
    };

    saveEvent(chatId, eventId, event);

    bot.sendMessage(chatId, `Event: \n${title}\n${description}\nTime: ${time}`, {
        ...thread,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Go', callback_data: `go_${chatId}_${eventId}` }],
                [{ text: 'Can\'t go', callback_data: `cantgo_${chatId}_${eventId}` }],
                [{ text: 'Attend but late', callback_data: `late_${chatId}_${eventId}` }]
            ]
        }
    }).then((sentMessage) => {
        bot.pinChatMessage(chatId, sentMessage.message_id);
        event.postMessageId = sentMessage.message_id; // Store the event post message ID
        saveEvent(chatId, eventId, event);
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
    const username = callbackQuery.from.username;

    let thread = threadId ? { message_thread_id: threadId } : {}

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
    event.participants.go = event.participants.go.filter(id => id !== userId);
    event.participants.cantGo = event.participants.cantGo.filter(id => id !== userId);
    event.participants.late = event.participants.late.filter(id => id !== userId);

    if (action === 'go') {
        event.participants.go.push(userId);
    } else if (action === 'cantgo') {
        event.participants.cantGo.push(userId);
    } else if (action === 'late') {
        event.participants.late.push(userId);
    }

    saveEvent(chatId, eventId, event);

    printEvent(chatId, event, thread);

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
        const [title, description, time] = msg.text.replace('/create_event ', '').split('|').map(s => s.trim());
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

                bot.deleteMessage(chatId, msg.message_id)

            } else {
                bot.sendMessage(chatId, "You should attend to this event before you can comment", thread)
                    .then((sentMessage) => {
                        setTimeout(() => {
                            bot.deleteMessage(chatId, sentMessage.message_id)
                        }, 10000)

                    });
            }
        }
    }
});

// Helper function to format participant lists
const formatParticipantList = function (participants, usernames, comments) {
    return usernames.map((username, index) => {
        let participantId = participants[index];
        let str = `${index + 1}. <a href="tg://user?id=${participantId}">${username}</a>`;
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
        const chatMember = await bot.getChatMember(chatId, userId);
        return chatMember.user.username ? `@${chatMember.user.username}` : `${chatMember.user.first_name} ${chatMember.user.last_name || ''}`;
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
    const responseText = `Event:\n${event.title}\n${event.description}\nTime: ${event.time}\n\nGoing:\n${goList}\n\nCan't Go:\n${cantGoList}\n\nLate:\n${lateList}`;
    //
    // // Edit the event post text
    bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: event.postMessageId, // Store and use the message ID of the event post
        ...thread,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{text: 'Go', callback_data: `go_${chatId}_${event.id}`}],
                [{text: 'Can\'t go', callback_data: `cantgo_${chatId}_${event.id}`}],
                [{text: 'Attend but late', callback_data: `late_${chatId}_${event.id}`}]
            ]
        }
    });
}