// chatRoutes.js - Chat API routes
const express = require('express');
const router = express.Router();
const { sendMessage, getConversation } = require('../controllers/chatController');

router.post('/', (req, res) => {
  try {
    const { receiverId, text } = req.body;
    const senderId = req.user.id;

    if (!receiverId || !text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Receiver ID and text are required' });
    }

    if (parseInt(receiverId) === senderId) {
      return res.status(400).json({ error: 'Cannot send message to yourself' });
    }

    const message = sendMessage(senderId, receiverId, text);
    res.status(201).json({ message: 'Message sent successfully', data: message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:user1/:user2', (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const user1Id = parseInt(user1);
    const user2Id = parseInt(user2);
    const senderId = req.user.id;

    // User must be part of conversation
    if (senderId !== user1Id && senderId !== user2Id) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }

    const conversation = getConversation(user1Id, user2Id);
    res.json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

