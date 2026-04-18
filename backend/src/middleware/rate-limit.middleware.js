import rateLimit from 'express-rate-limit';

const getClientKey = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedIp =
    typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : undefined;

  return req.ip || req.socket?.remoteAddress || forwardedIp || `${req.method}:${req.originalUrl}`;
};

const makeLimiter = (windowMs, max) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientKey,
    message: { message: 'Too many requests, please try again later' },
  });

export const globalRateLimit = makeLimiter(60 * 1000, 300);
export const authRateLimit = makeLimiter(60 * 1000, 30);
export const messageRateLimit = makeLimiter(60 * 1000, 120);
