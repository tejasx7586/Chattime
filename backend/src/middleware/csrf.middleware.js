import crypto from 'crypto';

const isStateChangingMethod = (method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

export const ensureCsrfCookie = (req, res, next) => {
  const existingToken = req.cookies?.csrfToken;

  if (!existingToken) {
    const csrfToken = crypto.randomBytes(24).toString('hex');
    res.cookie('csrfToken', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  next();
};

export const validateCsrfToken = (req, res, next) => {
  if (!isStateChangingMethod(req.method)) {
    return next();
  }

  const csrfCookieToken = req.cookies?.csrfToken;
  const csrfHeaderToken = req.get('x-csrf-token');

  if (!csrfCookieToken || !csrfHeaderToken || csrfCookieToken !== csrfHeaderToken) {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }

  return next();
};
