import express from 'express';
import mongoose from 'mongoose';
import { protectRoute } from '../middleware/auth.middleware.js';
import Message from '../models/message.model.js';
import { messageRateLimit } from '../middleware/rate-limit.middleware.js';

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

    const newMessage = await Message.create({
      senderId: req.user._id,
      receiverId,
      text,
    });

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

    return res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
});

export default router;
