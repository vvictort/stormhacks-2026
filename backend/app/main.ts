import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RequestHandler } from 'express';
import { loadConfig } from './core/config.js';
import { createDatabase } from './db/database.js';
import { Repositories } from './db/repositories.js';
import { PersonalizationService } from './services/personalization_service.js';
import { createApp } from './server.js';

const config=loadConfig();
const db=createDatabase(config.DATABASE_URL);
let authenticate:RequestHandler|undefined;
if (config.AUTH_MIDDLEWARE_MODULE) {
  const module=await import(pathToFileURL(resolve(config.AUTH_MIDDLEWARE_MODULE)).href);
  if (typeof module.authenticate!=='function') throw new Error('Auth module must export authenticate');
  authenticate=module.authenticate;
} else {
  console.info('No team auth module configured: protected endpoints will return 401.');
}
const app=createApp({repo:new Repositories(db),personalization:new PersonalizationService(config.PERSONALIZATION_URL,config.PERSONALIZATION_SERVICE_KEY),authenticate,corsOrigin:config.CORS_ORIGIN});
const server=app.listen(config.PORT,config.HOST,() => console.info(`Data API listening on http://${config.HOST}:${config.PORT}`));
server.on('error',async (error) => {console.error('API could not start:',error.message);await db.end();process.exitCode=1;});
let closing=false;
function shutdown() {
  if (closing) return;
  closing=true;
  const deadline=setTimeout(() => {server.closeAllConnections();process.exit(1);},10000);
  deadline.unref();
  server.close(async () => {await db.end();clearTimeout(deadline);});
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
