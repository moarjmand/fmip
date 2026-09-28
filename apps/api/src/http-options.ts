import type { NestApplicationOptions } from '@nestjs/common';

/**
 * How the API's HTTP application is created: by `main.ts`, and by the
 * security spec that has to test the same server (T-813).
 *
 * `bodyParser: false` turns off the one parser Nest adds to Fastify's own:
 * `application/x-www-form-urlencoded`. The API speaks JSON only -- the web app
 * sends nothing else (`apps/web/src/lib/api.ts`) -- and a url-encoded body is
 * exactly what a cross-site HTML form can send without a CORS preflight. The
 * session cookie's `SameSite=Lax` already keeps such a request from carrying a
 * session; refusing the body as well (415, before any handler runs) means a
 * form on any page, same-site or not, can never drive a write. JSON is still
 * parsed, by Fastify's own parser, with the same prototype-poisoning guard
 * Nest configured.
 */
export const HTTP_APP_OPTIONS: NestApplicationOptions = { bodyParser: false };
