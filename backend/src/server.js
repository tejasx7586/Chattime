import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.route.js';
import messageRoutes from './routes/message.route.js';

dotenv.config();

const app = express();
const __dirname = path.resolve();

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/api/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (_, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

app.use((_, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((error, _, res, __) => {
  console.error(error);
  const status = error?.status || 500;
  const message = status === 500 ? 'Internal server error' : error.message;
  res.status(status).json({ message });
});

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
