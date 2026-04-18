import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/user.model.js';
import { protectRoute } from '../middleware/auth.middleware.js';
import { setAuthCookie } from '../utils/token.js';

const router = express.Router();

router.post('/signup', async (req, res, next) => {
  try {
    const name = req.body?.name?.trim();
    const email = req.body?.email?.trim()?.toLowerCase();
    const password = req.body?.password;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ message: 'Email is already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    setAuthCookie(res, user._id.toString());

    return res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = req.body?.email?.trim()?.toLowerCase();
    const password = req.body?.password;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    setAuthCookie(res, user._id.toString());

    return res.status(200).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (_, res) => {
  res.clearCookie('jwt', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });

  return res.status(200).json({ message: 'Logged out successfully' });
});

router.get('/me', protectRoute, (req, res) => {
  return res.status(200).json({ user: req.user });
});

router.get('/users', protectRoute, async (req, res, next) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } }).select('-password').sort({ name: 1 });
    return res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
});

export default router;
