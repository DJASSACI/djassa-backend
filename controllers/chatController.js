// chatController.js - Chat message business logic
const fs = require('fs');
const path = require('path');

const MESSAGES_FILE = path.join(__dirname, 'messages.json');

const readJSONFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

const writeJSONFile = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    return false;
  }
};

const getOrCreateConversation = (user1Id, user2Id, messages = []) => {
  const sortedUsers = [user1Id, user2Id].sort((a, b) => a - b).join('-');
  return { conversationId: sortedUsers, messages };
};

// Send new message
const sendMessage = (senderId, receiverId, text) => {
  const messages = readJSONFile(MESSAGES_FILE);
  const conversation = getOrCreateConversation(senderId, receiverId, messages);
  
  const newMessage = {
    id: Date.now(),
    senderId: parseInt(senderId),
    receiverId: parseInt(receiverId),
    text: text.trim(),
    createdAt: new Date().toISOString(),
    read: false
  };
  
  conversation.messages.push(newMessage);
  messages.push(newMessage);
  
  writeJSONFile(MESSAGES_FILE, messages);
  return newMessage;
};

// Get conversation history
const getConversation = (user1Id, user2Id) => {
  const messages = readJSONFile(MESSAGES_FILE);
  const conversationId = [user1Id, user2Id].sort((a, b) => a - b).join('-');
  
  return messages.filter(msg => {
    const msgUsers = [msg.senderId, msg.receiverId].sort((a, b) => a - b).join('-');
    return msgUsers === conversationId;
  }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
};

module.exports = {
  sendMessage,
  getConversation
};

