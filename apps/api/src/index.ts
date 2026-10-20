import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { requestIdMiddleware, requireAuth } from './middleware/auth.js';
import apiRoutes from './routes/api.js';

const logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(requireAuth);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      requestId: req.requestId,
      serviceId: req.identity?.serviceId,
      role: req.identity?.role
    });
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'bayora-api',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/v1', apiRoutes);

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, requestId: (req as any).requestId }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      requestId: (req as any).requestId
    },
    requestId: (req as any).requestId
  });
});

app.listen(PORT, () => {
  logger.info(`Bayora API server listening on port ${PORT}`);
});

export default app;