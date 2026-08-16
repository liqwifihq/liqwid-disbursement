import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { AppModule } from './modules/app.module';
import * as dotenv from 'dotenv';
import { AppDataSource } from './ormconfig';
import { getInternalApiToken, validateRuntimeConfig } from './config';

dotenv.config();

async function bootstrap() {
  validateRuntimeConfig('api');
  await AppDataSource.initialize();
  console.log('DataSource initialized');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.useBodyParser('json', { limit: '6mb' });
  const internalApiToken = getInternalApiToken();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/webhooks/korapay') return next();
    const supplied = String(req.headers['x-admin-token'] || '');
    const expected = Buffer.from(internalApiToken);
    const received = Buffer.from(supplied);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return res.status(401).json({ statusCode: 401, message: 'Unauthorized API request.' });
    }
    next();
  });
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.enableShutdownHooks();
  const host = process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  await app.listen(process.env.PORT || 3000, host);
  console.log('Backend running on', process.env.PORT || 3000);
}
bootstrap();
