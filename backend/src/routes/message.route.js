import express from 'express';
import mongoose from 'mongoose';
import { protectRoute } from '../middleware/auth.middleware.js';
import Message from '../models/message.model.js';
import { messageRateLimit } from '../middleware/rate-limit.middleware.js';
import { emitToUser, isUserOnline } from '../realtime/realtime.gateway.js';

const router = express.Router();

router.use(messageRateLimit);
router.use(protectRoute);

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

    if (incomingUnreadMessages.length > 0) {
      const readTimestamp = new Date();
      const incomingUnreadIds = incomingUnreadMessages.map((message) => message._id);

      await Message.updateMany(
        { _id: { $in: incomingUnreadIds } },
        {
          $set: {
            readAt: readTimestamp,
            deliveredAt: readTimestamp,
          },
        }
      );

      incomingUnreadMessages.forEach((message) => {
        message.readAt = readTimestamp;
        message.deliveredAt = message.deliveredAt || readTimestamp;
      });

      emitToUser(otherUserId, 'message:read', {
        messageIds: incomingUnreadIds.map((id) => id.toString()),
        readAt: readTimestamp.toISOString(),
        readerId: req.user._id.toString(),
      });
    }

    return res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
});

export default router;
