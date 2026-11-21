import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "@/src/app.module";
import { appConfig } from "@/config/app.config";
import { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

async function bootstrap() {
  // rawBody: true keeps the unparsed body for webhooks; bodyParser stays on.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // NOTE: sir's boilerplate served the "uploads" folder publicly here.
  // Customer snapshots and video must never be public, so that line is gone:
  // media is served only by MediaController with short-lived signed tokens.

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", true);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI needs 'unsafe-inline' to function correctly
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "validator.swagger.io"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 1. Logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const now = new Date().toISOString().replace("T", " ").replace(/\..+/, "");
    console.log(`[HTTP] [${now}] ${req.method} ${req.originalUrl}`);
    next();
  });

  // 2. Every route lives under /v1
  app.setGlobalPrefix("v1");

  // 3. Validation: Nest's own pipe, so the response lists each failed field
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 4. Swagger
  const config = new DocumentBuilder()
    .setTitle("VisionGuard Digital Watcher API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  // 5. Cookie Parser
  app.use(cookieParser());

  // 6. CORS
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : [appConfig.env.FRONTEND_URL];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 86400,
  });

  await app.listen(appConfig.env.PORT);
  console.log(`VisionGuard API on http://localhost:${appConfig.env.PORT}/v1  (Swagger: /api)`);
}
bootstrap();
