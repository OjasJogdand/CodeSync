import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/authRoutes.js';
import codeRoutes from './routes/codeRoutes.js';
import registerSocketHandlers from './socket/socketHandler.js';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
});

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 8000;

// Attach Socket.IO to the HTTP server with CORS for the frontend
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
});

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// REST routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});
app.use('/api/auth', authRoutes);
app.use('/api/code', codeRoutes);

// Delegate all socket logic to the dedicated handler file
registerSocketHandlers(io);

// Use httpServer (not app.listen) so Socket.IO shares the same port
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
