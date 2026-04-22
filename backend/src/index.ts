import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { initSocketIO } from './config/socket.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';
import { logger } from './services/observability/logger.js';
import { metricsHandler } from './services/observability/metrics.js';

// BullMQ workers (self-register on import)
import './jobs/notification.worker.js';
import './jobs/email.worker.js';
import './jobs/material-prompt.worker.js';
import './jobs/class-reminder.worker.js';
import './jobs/ingest.worker.js';
import './jobs/ocr.worker.js';
import { startClassReminderScheduler, startMaterialPromptScheduler } from './jobs/queues.js';

const app = express();
const server = createServer(app);

// Security
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  credentials: true,
}));

// Structured request logs (pino) — replaces morgan/console for production.
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' } }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Prometheus scrape endpoint — protected by X-Metrics-Key header.
app.get('/metrics', metricsHandler());

// Swagger
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cognitive Copilot API',
      version: '1.0.0',
      description: 'Academic LMS Platform API',
    },
    servers: [{ url: `http://localhost:${env.PORT}/api` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

// Socket.io
initSocketIO(server);

// Start (skip if imported for testing)
if (process.env.NODE_ENV !== 'test') {
  async function start() {
    try {
      await prisma.$connect();
      console.log('Database connected');

      await startClassReminderScheduler();
      await startMaterialPromptScheduler();

      server.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server.started');
        logger.info(`API docs: http://localhost:${env.PORT}/api/docs`);
      });
    } catch (err) {
      logger.error({ err }, 'server.start_failed');
      process.exit(1);
    }
  }

  start();
}

export default app;
