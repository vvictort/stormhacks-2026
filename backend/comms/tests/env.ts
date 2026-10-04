// Imported before anything loads src/config.ts: tests never read .env and never reach real services.
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'tellio-test';
process.env.ELEVENLABS_API_KEY = 'test-key';
process.env.ELEVENLABS_AGENT_ID = 'agent_test';
for (const key of ['COMMS_ALLOW_DEV_USER', 'BACKEND_INTERNAL_URL', 'INTERNAL_API_TOKEN']) delete process.env[key];
