import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { users } from './api/users.ts';
import { config } from './core/config.ts';
import { errorHandler } from './core/errors.ts';
import { requireAuth } from './core/security.ts';

// Verifying ID tokens only needs the project ID: Google's public signing keys are fetched on demand.
initializeApp({ projectId: config.FIREBASE_PROJECT_ID });

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Every /api route below needs a signed-in user. Public routes (e.g. provider webhooks) go above.
app.use('/api', requireAuth());
app.use('/api/users', users);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}/api`);
});
