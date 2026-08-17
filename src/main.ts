import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      req.path.startsWith('/docs')
        ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
        : "default-src 'none'; frame-ancestors 'none'",
    );
    next();
  });
  app.useBodyParser('json', { limit: '6mb' });
  const internalApiToken = getInternalApiToken();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/webhooks/korapay' || req.path.startsWith('/docs')) return next();
    const supplied = String(req.headers['x-admin-token'] || '');
    const expected = Buffer.from(internalApiToken);
    const received = Buffer.from(supplied);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return res.status(401).json({ statusCode: 401, message: 'Unauthorized API request.' });
    }
    next();
  });
  const allowedOrigins = new Set([
    'http://localhost:3001',
    'https://disbursement.liqwifi.com',
    'https://liqwifi.com',
    ...(process.env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
  app.enableCors({ origin: [...allowedOrigins], credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LiqWiFi Disbursement API')
    .setDescription('Upload payout batches, approve them, enqueue disbursements, and track payment status.')
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-admin-token', in: 'header', description: 'Internal API token' },
      'admin-token',
    )
    .addSecurityRequirements('admin-token')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  const korapayWebhook = openApiDocument.paths['/webhooks/korapay']?.post;
  if (korapayWebhook) korapayWebhook.security = [];
  SwaggerModule.setup('docs', app, openApiDocument, {
    customSiteTitle: 'LiqWiFi API documentation',
    swaggerOptions: { persistAuthorization: true },
  });

  const host = process.env.API_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  await app.listen(process.env.PORT || 3000, host);
  console.log('Backend running on', process.env.PORT || 3000);
}
bootstrap();
