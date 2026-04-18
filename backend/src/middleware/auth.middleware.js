import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

export const protectRoute = async (req, res, next) => {
  try {
    const token = req.cookies?.jwt;

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      return res.status(500).json({ message: 'Server configuration error' });
    }

    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
