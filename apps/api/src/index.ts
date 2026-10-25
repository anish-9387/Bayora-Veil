import express, { Request, Response, NextFunction, Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { requestIdMiddleware, requireAuth } from './middleware/auth.js';
import apiRoutes from './routes/api.js';
import { query, closePool } from './db/client.js';
import { login, logout } from './security/accounts.js';
import { rateLimit } from './security/limits.js';
import { z } from 'zod';

// Extend Express Request type globally
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      identity?: {
        serviceId: string;
        tenantId: string;
        userId: string;
        role: string;
        capabilities: Array<{ capability: string; resource: string; action: string }>;
      };
      capabilities: Array<{ capability: string; resource: string; action: string }>;
    }
  }
}

const logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: 'info' }
    : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
);

const app: Express = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
if (process.env.NODE_ENV === 'production') {
  for (const key of ['DATABASE_URL', 'CORS_ORIGIN', 'RED_CELL_URL', 'BLUE_CELL_URL', 'AUDIT_CELL_URL', 'REPLAY_CELL_URL', 'RED_CELL_TOKEN', 'BLUE_CELL_TOKEN', 'AUDIT_CELL_TOKEN', 'REPLAY_CELL_TOKEN'])
    if (!process.env[key]) throw new Error(`Required production setting: ${key}`);
  if (process.env.EXECUTION_PROFILE !== 'isolated' || process.env.AUTH_MODE === 'demo') throw new Error('Production requires isolated execution and account authentication');
  const origin = new URL(process.env.CORS_ORIGIN!);
  if (origin.protocol !== 'https:' || origin.origin !== process.env.CORS_ORIGIN) throw new Error('CORS_ORIGIN must be an exact HTTPS origin');
  for (const key of ['RED_CELL_TOKEN', 'BLUE_CELL_TOKEN', 'AUDIT_CELL_TOKEN', 'REPLAY_CELL_TOKEN'])
    if (process.env[key]!.length < 32) throw new Error('Production service credentials must contain at least 32 characters');
}
app.set('trust proxy', 1);
app.disable('x-powered-by');

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
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.identity?.tenantId) void query('INSERT INTO request_metrics (tenant_id, path, status, duration_ms) VALUES ($1, $2, $3, $4)', [req.identity.tenantId, path.replace(/[0-9a-f-]{36}/gi, ':id'), res.statusCode, duration]).catch(() => logger.error({ requestId: req.requestId }, 'Request metric write failed'));
    logger.info({
      method: req.method,
      path,
      status: res.statusCode,
      duration,
      requestId: req.requestId,
      serviceId: req.identity?.serviceId,
      role: req.identity?.role
    });
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
app.get('/ready', async (_req, res) => {
  try { await query('SELECT 1'); res.json({ status: 'ready' }); } catch { res.status(503).json({ status: 'unavailable' }); }
});
app.get('/api/v1/auth/mode', (_req, res) => res.json({ demo: process.env.AUTH_MODE === 'demo' && process.env.NODE_ENV !== 'production' }));
app.post('/api/v1/auth/login', rateLimit(10, 'login'), async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { message: 'Invalid sign-in request' } });
    const result = await login(parsed.data.email, parsed.data.password);
    if (!result) return res.status(401).json({ error: { message: 'Invalid email or password' } });
    res.json(result);
  } catch (error) { next(error); }
});
app.use('/api/v1', requireAuth, rateLimit(120, 'api'));
app.get('/api/v1/auth/me', (req, res) => res.json({ user: req.identity }));
app.post('/api/v1/auth/logout', async (req, res, next) => {
  try { await logout((req.headers.authorization || '').replace(/^Bearer /, '')); res.sendStatus(204); } catch (error) { next(error); }
});

app.use('/api/v1', apiRoutes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ name: err.name, requestId: req.requestId }, 'Request failed');
  const status = err instanceof z.ZodError ? 400 : (err as Error & { status?: number }).status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      requestId: req.requestId
    },
    requestId: req.requestId
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Bayora API server listening on port ${PORT}`);
});
setInterval(() => {
  void query("DELETE FROM sessions WHERE expires_at < NOW(); DELETE FROM rate_limits WHERE window_start < NOW() - interval '1 day'; DELETE FROM request_metrics WHERE created_at < NOW() - interval '7 days'; DELETE FROM work_leases WHERE expires_at < NOW()")
    .catch(() => logger.error('Operational data retention failed'));
}, 15 * 60 * 1000).unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(() => { void closePool().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 15000).unref();
});

export default app;
