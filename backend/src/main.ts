import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  DocumentBuilder,
  SwaggerModule,
  SwaggerCustomOptions,
} from '@nestjs/swagger';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpLogger } from './common/middlewares/httpLogger.middleware';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware';
import { CentralizedValidationPipe } from './common/pipes/validation.pipe';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { GracefulShutdownService } from './common/services/graceful-shutdown.service';
import {
  ApiVersionMiddleware,
  CURRENT_API_VERSION,
} from './common/middlewares/api-version.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Correlation-ID middleware MUST be registered before any logger or
  // pipe so the AsyncLocalStorage context is opened for the rest of
  // the request lifecycle (BE-08).
  app.use(new CorrelationIdMiddleware().use);
  app.use(new HttpLogger().use);

  // GLOBAL VALIDATION — replaced by the centralised pipe so every
  // controller shares the same 400 error shape (BE-01).
  app.useGlobalPipes(new CentralizedValidationPipe());

  // GLOBAL SERIALIZATION
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // GLOBAL EXCEPTION FILTER — emits the stable { statusCode, error,
  // message, correlationId, timestamp, path } shape (BE-08).
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ENABLE CORS
  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? [
            'https://Oraculum.vercel.app',
            'https://www.Oraculum.vercel.app',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3002',
            'http://localhost:3003',
          ]
        : true,
    credentials: true,
  });

  // API VERSIONING (BE-25)
  //
  // URI-based versioning: every route is prefixed with /api/vN/.
  // The default version is "1" so unversioned calls fall through to v1.
  // A middleware adds X-API-Version and X-API-Versions-Supported headers.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: CURRENT_API_VERSION,
  });

  // API VERSION HEADER MIDDLEWARE
  app.use(new ApiVersionMiddleware().use);

  // GLOBAL PREFIX — must be set AFTER enableVersioning so NestJS
  // places the version segment between /api and the controller route.
  app.setGlobalPrefix('/api');

  // SWAGGER SETUP (BE-09 acceptance)
  //
  // The CLI plugin (configured in nest-cli.json) augments every
  // controller with @ApiTags + tags from class names so the docs are
  // always in sync with the code. The DocumentBuilder below adds the
  // operator-facing metadata: title, description, contact, servers,
  // auth schemes. The customOptions keep the UI tidy (top-bar collapse,
  // and a banner explaining the bearer-auth requirement).
  const config = new DocumentBuilder()
    .setTitle('Oraculum API')
    .setDescription(
      `REST API for the Oraculum platform.

## API Versioning (BE-25)
All endpoints are versioned via URI prefix: \`/api/v1/\`, \`/api/v2/\`, etc.
The current stable version is **v1**. Always use the versioned URL.

### Response Headers
Every response includes:
- \`X-API-Version\`: the version that served the request.
- \`X-API-Versions-Supported\`: list of active versions.

### Deprecation
Deprecated versions emit \`Deprecation: true\` and \`Sunset\` headers.
Migrate to the latest version before the sunset date.

## Authentication
Most endpoints require a JWT bearer token. Obtain one via \`POST /api/v1/auth/login\` and pass it as \`Authorization: Bearer <token>\`.

## Rate limiting (BE-07)
Every endpoint is rate-limited. Authenticated requests are tracked per user; anonymous requests are tracked per IP. The default limits are 60 requests/minute (anonymous) and 100 requests/minute (authenticated). Look for the \`Retry-After\` header on 429 responses.

## Correlation IDs (BE-08)
Every request is assigned a correlation ID, returned in the \`x-correlation-id\` response header and embedded in every error body. Pass it back to support so they can locate the corresponding server log line.

## Pagination (BE-15)
List endpoints accept \`page\` (default 1) and \`limit\` (default 20, max 100). The response always includes a \`meta\` object with \`currentPage\`, \`itemsPerPage\`, \`totalItems\`, \`totalPages\`, \`hasPreviousPage\`, and \`hasNextPage\`.`,
    )
    .setVersion(process.env.npm_package_version ?? '1.0.0')
    .setContact(
      'Oraculum Engineering',
      'https://Oraculum.vercel.app',
      'engineering@oraculum.app',
    )
    .setLicense('UNLICENSED', undefined)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token issued by /api/v1/auth/login',
        name: 'Authorization',
        in: 'header',
      },
      'bearer',
    )
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://api.Oraculum.app', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app as any, config);

  const ui: SwaggerCustomOptions = {
    customSiteTitle: 'Oraculum API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
    },
  };

  SwaggerModule.setup('swagger', app as any, document, ui);

  app.setGlobalPrefix('/api');

  const server = await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  const shutdownService = app.get(GracefulShutdownService);
  shutdownService.setHttpServer(server);
  shutdownService.registerSignalHandlers();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  console.log(`Server is listening at: ${await app.getUrl()}`);
  console.log(
    `Swagger UI: ${await app.getUrl()}/swagger — JSON spec: ${await app.getUrl()}/swagger-json`,
  );
}
bootstrap();
