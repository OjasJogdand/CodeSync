import express from 'express';
import { executeCode } from '../controllers/codeController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/run', verifyToken, executeCode);

export default router;
