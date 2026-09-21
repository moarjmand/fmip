/**
 * What the API says about itself, in lines a shell can read (T-075).
 *
 * Run inside the `api` container, where both the service's own environment and
 * its health endpoints are reachable:
 *
 *     docker compose exec -T api node - < deploy/report-capabilities.mjs
 *
 * Prints `key=value`, one per line, and nothing else, so `check-setup.sh` can
 * read it without jq and without node on the host.
 *
 * It never prints the value of a secret. A key, a password or a connection
 * string is reported only as `set` or `empty` -- so this output can be pasted
 * into a message, a ticket or a chat window safely, which is the point: the
 * person who needs help with a deployment is rarely the person who should be
 * handling its credentials.
 */

const BASE = process.env.SELF_BASE_URL ?? 'http://127.0.0.1:3001';
const TIMEOUT_MS = 10_000;

/** A health endpoint's body, or null if this deployment could not answer. */
async function read(path) {
  try {
    const response = await fetch(BASE + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const lines = [];
const say = (key, value) =>
  lines.push(`${key}=${value === null || value === undefined ? '' : value}`);

/** A channel is `absent`, or `configured` with the provider that was chosen. */
function channel(name, state) {
  say(name, state?.state ?? 'unknown');
  say(`${name}_provider`, state?.state === 'configured' ? state.provider : '');
}

/**
 * Whether an environment variable holds anything -- never what. A variable
 * that is present but empty is the same as unset here, because that is how
 * every reader in the API treats it.
 */
function present(name) {
  const value = process.env[name];
  say(`env_${name}`, value === undefined || value.trim() === '' ? 'empty' : 'set');
}

const [health, delivery, intelligence, chat, ingestion] = await Promise.all([
  read('/health'),
  read('/health/delivery'),
  read('/health/intelligence'),
  read('/health/chat'),
  read('/health/ingestion'),
]);

say('api', health === null ? 'unreachable' : (health.status ?? 'unknown'));
say('api_uptime_seconds', health === null ? '' : Math.round(health.uptime_seconds ?? 0));

channel('email', delivery?.email);
channel('push', delivery?.push);
say('in_product_only', delivery === null ? 'unknown' : String(delivery.in_product_only));

const model = intelligence?.language_model;
say('language_model', model?.state ?? 'unknown');
say('language_model_provider', model?.state === 'configured' ? model.provider : '');
say('language_model_name', model?.state === 'configured' ? model.model : '');

say('chat_bus', chat === null ? 'unknown' : chat.bus);

// What the fixtures job can ask for. A switched-on schedule with nothing
// mapped fetches nothing, and that is the ordinary state of a deployment that
// has just been migrated -- no competition exists until someone creates one.
// Reported as `unknown` rather than 0 when the endpoint did not answer, so the
// check never accuses a healthy deployment of an empty catalogue.
say('pollable_provider', ingestion?.pollable?.provider ?? '');
say('pollable_reason', ingestion?.pollable?.reason ?? '');
say('pollable_competitions', ingestion?.pollable?.competitions ?? 'unknown');
say('pollable_current_seasons', ingestion?.pollable?.with_current_season ?? 'unknown');

// The switches, and the values each switch needs beside it. A switch left at
// its default is the ordinary state of a new deployment, not a fault; the
// report exists to tell the two apart -- above all the case where the secret
// was filled in and the switch was forgotten, which looks from the outside
// exactly like having done nothing at all.
say('delivery_email_provider', process.env.DELIVERY_EMAIL_PROVIDER ?? '');
say('delivery_push_provider', process.env.DELIVERY_PUSH_PROVIDER ?? '');
say('intelligence_provider', process.env.INTELLIGENCE_PROVIDER ?? '');
say('ingestion_source', process.env.INGESTION_SOURCE ?? '');
say('ingestion_schedule', process.env.INGESTION_SCHEDULE ?? '');
say('web_base_url', process.env.WEB_BASE_URL ?? '');
say('node_env', process.env.NODE_ENV ?? '');
say('demonstration_data', process.env.DEMONSTRATION_DATA ?? '');

for (const name of [
  'SMTP_URL',
  'DELIVERY_EMAIL_FROM',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'ANTHROPIC_API_KEY',
  'MISTRAL_API_KEY',
  'INTELLIGENCE_API_KEY',
  'INTELLIGENCE_BASE_URL',
  'INTELLIGENCE_MODEL',
  'API_FOOTBALL_KEY',
  'FOOTBALL_DATA_ORG_KEY',
  'HIGHLIGHTLY_KEY',
  'SESSION_SECRET',
]) {
  present(name);
}

process.stdout.write(`${lines.join('\n')}\n`);
