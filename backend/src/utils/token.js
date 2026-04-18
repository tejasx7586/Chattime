import jwt from 'jsonwebtoken';

export const generateToken = (userId) => {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }

  return jwt.sign({ userId }, jwtSecret, {
    expiresIn: '7d',
  });
};

export const setAuthCookie = (res, userId) => {
  const token = generateToken(userId);

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return token;
};
