import express from 'express';
import mongoose from 'mongoose';
import { protectRoute } from '../middleware/auth.middleware.js';
import Message from '../models/message.model.js';
import { messageRateLimit } from '../middleware/rate-limit.middleware.js';
import { emitToUser, isUserOnline } from '../realtime/realtime.gateway.js';

const router = express.Router();

router.use(messageRateLimit);
router.use(protectRoute);

const markMessagesAsRead = async (messages, readerId) => {
  if (messages.length === 0) {
    return null;
  }

  const readTimestamp = new Date();
  const messageIds = messages.map((message) => message._id);

  await Message.updateMany(
    { _id: { $in: messageIds } },
    [
      {
        $set: {
          readAt: readTimestamp,
          deliveredAt: { $ifNull: ['$deliveredAt', readTimestamp] },
        },
      },
    ]
  );

  messages.forEach((message) => {
    message.readAt = readTimestamp;
    message.deliveredAt = message.deliveredAt || readTimestamp;
  });

  const messageIdsBySender = messages.reduce((accumulator, message) => {
    const senderId = message.senderId.toString();
    if (!accumulator[senderId]) {
      accumulator[senderId] = [];
    }
    accumulator[senderId].push(message._id.toString());
    return accumulator;
  }, {});

  Object.entries(messageIdsBySender).forEach(([senderId, senderMessageIds]) => {
    emitToUser(senderId, 'message:read', {
      messageIds: senderMessageIds,
      readAt: readTimestamp.toISOString(),
      readerId,
    });
  });

  return { readTimestamp, messageIds: messageIds.map((id) => id.toString()) };
};

router.post('/send', async (req, res, next) => {
  try {
    const receiverId = req.body?.receiverId;
    const text = req.body?.text?.trim();

    if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: 'Valid receiverId is required' });
    }

    if (!text) {
      return res.status(400).json({ message: 'Message text is required' });
    }

    const receiverOnline = isUserOnline(receiverId);
    const deliveredAt = receiverOnline ? new Date() : null;

    const newMessage = await Message.create({
      senderId: req.user._id,
      receiverId,
      text,
      deliveredAt,
    });

    emitToUser(receiverId, 'message:new', { message: newMessage });
    emitToUser(req.user._id.toString(), 'message:new', { message: newMessage });

    return res.status(201).json({ message: newMessage });
  } catch (error) {
    next(error);
  }
});

router.post('/read', async (req, res, next) => {
  try {
    const senderId = req.body?.senderId;
    const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds : [];

    if (senderId && !mongoose.Types.ObjectId.isValid(senderId)) {
      return res.status(400).json({ message: 'Valid senderId is required' });
    }

    const validMessageIds = messageIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!senderId && validMessageIds.length === 0) {
      return res.status(400).json({ message: 'senderId or valid messageIds are required' });
    }

    const query = {
      receiverId: req.user._id,
      readAt: null,
    };

    if (senderId) {
      query.senderId = senderId;
    }

    if (validMessageIds.length > 0) {
      query._id = { $in: validMessageIds };
    }

    const unreadMessages = await Message.find(query);
    const result = await markMessagesAsRead(unreadMessages, req.user._id.toString());

    return res.status(200).json({
      messageIds: result?.messageIds || [],
      readAt: result?.readTimestamp?.toISOString() || null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const otherUserId = req.query?.userId;

    if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ message: 'Valid userId query is required' });
    }

    const messages = await Message.find({
      $or: [
        { senderId: req.user._id, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: req.user._id },
      ],
    }).sort({ createdAt: 1 });

    const incomingUnreadMessages = messages.filter(
      (message) => message.receiverId.toString() === req.user._id.toString() && !message.readAt
    );

    await markMessagesAsRead(incomingUnreadMessages, req.user._id.toString());

    return res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
});

export default router;
