import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  DocumentBuilder,
  SwaggerModule,
  SwaggerCustomOptions,
} from '@nestjs/swagger';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpLogger } from './common/middlewares/httpLogger.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(new HttpLogger().use);

  // GLOBAL VALIDATION
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // GLOBAL SERIALIZATION
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

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

## Authentication
Most endpoints require a JWT bearer token. Obtain one via \`POST /api/auth/login\` and pass it as \`Authorization: Bearer <token>\`.

## Rate limiting (BE-07)
Every endpoint is rate-limited. Authenticated requests are tracked per user; anonymous requests are tracked per IP. The default limits are 60 requests/minute (anonymous) and 100 requests/minute (authenticated). Look for the \`Retry-After\` header on 429 responses.

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
        description: 'JWT access token issued by /api/auth/login',
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

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  console.log(`Server is listening at: ${await app.getUrl()}`);
  console.log(
    `Swagger UI: ${await app.getUrl()}/swagger — JSON spec: ${await app.getUrl()}/swagger-json`,
  );
}
bootstrap();
