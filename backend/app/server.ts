import express, { type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Repositories } from './db/repositories.js';
import type { PersonalizationService } from './services/personalization_service.js';
import { AnalyticsService } from './services/analytics_service.js';
import { usersRouter } from './api/users.js';
import { analyticsRouter } from './api/analytics.js';
import { sessionsRouter } from './api/campaigns.js';
import { requireAuthentication } from './core/security.js';
import { AppError,errorHandler } from './core/errors.js';

export function createApp(options:{repo:Repositories;personalization:PersonalizationService;authenticate?:RequestHandler;corsOrigin?:string}) {
  const app=express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({origin:options.corsOrigin??'http://localhost:5173',credentials:true}));
  app.use(express.json({limit:'100kb'}));
  app.get('/health',(_req,res) => {res.json({status:'ok',service:'scam-training-data-api'});});
  const api=express.Router();
  if (options.authenticate) api.use(options.authenticate);
  api.use(requireAuthentication);
  api.use('/users',usersRouter(options.repo));
  api.use('/analytics',analyticsRouter(options.repo,new AnalyticsService(options.repo,options.personalization)));
  api.use('/game-sessions',sessionsRouter(options.repo));
  app.use('/api/v1',api);
  app.use((_req,_res,next) => next(new AppError(404,'NOT_FOUND','Route not found.')));
  app.use(errorHandler);
  return app;
}
