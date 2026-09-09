import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

const DEFAULT_PORT = 3001;

export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Falling back to the default here would start a server on a port nobody
    // is pointing at, which looks healthy and serves no one.
    throw new Error(`API_PORT must be an integer between 1 and 65535, received: ${raw}`);
  }

  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  // Lets Nest run its shutdown hooks on SIGTERM, which is how Docker stops a
  // container. Without this, in-flight requests are cut off.
  app.enableShutdownHooks();

  // 0.0.0.0 rather than the default loopback: inside a container, loopback is
  // not reachable from the host or from sibling services.
  await app.listen({ port: resolvePort(process.env.API_PORT), host: '0.0.0.0' });
}

// istanbul ignore next -- entry point, exercised by running the process
if (require.main === module) {
  void bootstrap();
}
