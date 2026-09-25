import type { Runtime } from './runtime';

declare module 'fastify' {
  interface FastifyInstance {
    runtime: Runtime;
  }
}
