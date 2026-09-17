import 'dotenv/config';
import pg from 'pg';
import pino from 'pino';
import { loadNodes } from './config.js';
import { LlmClient } from './llm.js';
import { MemoryStore, PgStore, type Store } from './store.js';
import { StudyBot } from './bot.js';
import { discoverCurrentWeek } from './planner.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const nodes = loadNodes();
const store: Store = process.env.STORE_MODE === 'memory' ? new MemoryStore() : new PgStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));

async function main() {
  const refresh = async () => { for(const days of [0,7]) await discoverCurrentWeek(store,new Date(Date.now()+days*86400000)).catch(() => log.warn('Source discovery failed')); };
  if (process.env.STORE_MODE !== 'memory') { await refresh(); setInterval(refresh, 6 * 60 * 60 * 1000); setInterval(() => store.purgeExpired().catch((e) => log.warn({ err: e }, 'retention purge failed')), 60 * 60 * 1000); }
  if (!process.env.TELEGRAM_BOT_TOKEN) { log.info('Set TELEGRAM_BOT_TOKEN to start Telegram; node config validated.'); return; }
  const configuredUserId = process.env.TELEGRAM_ALLOWED_USER_ID ? Number(process.env.TELEGRAM_ALLOWED_USER_ID) : undefined;
  const bot = new StudyBot(process.env.TELEGRAM_BOT_TOKEN, store, new LlmClient(), configuredUserId, nodes);
  const reload=setInterval(()=>{try{const fresh=loadNodes();nodes.clear();for(const [id,n] of fresh)nodes.set(id,n);}catch{log.warn('Invalid node configuration; retaining last valid version');}},5000);
  const shutdown=async()=>{clearInterval(reload);await bot.stop();process.exit(0);};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  await bot.startPolling();
}
main().catch((e) => { log.error({ err: e }, 'fatal'); process.exitCode = 1; });
