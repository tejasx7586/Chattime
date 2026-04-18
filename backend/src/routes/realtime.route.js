import express from 'express';
import mongoose from 'mongoose';
import { protectRoute } from '../middleware/auth.middleware.js';
import { messageRateLimit } from '../middleware/rate-limit.middleware.js';
import { emitToUser, openRealtimeStream } from '../realtime/realtime.gateway.js';

const router = express.Router();

router.use(messageRateLimit);
router.use(protectRoute);

router.get('/stream', (req, res) => {
  openRealtimeStream(req, res);
});

router.post('/typing', async (req, res) => {
  const toUserId = req.body?.toUserId;
  const isTyping = Boolean(req.body?.isTyping);

  if (!toUserId || !mongoose.Types.ObjectId.isValid(toUserId)) {
    return res.status(400).json({ message: 'Valid toUserId is required' });
  }

  emitToUser(toUserId, 'typing', {
    fromUserId: req.user._id.toString(),
    isTyping,
  });

  return res.status(200).json({ ok: true });
});

export default router;
