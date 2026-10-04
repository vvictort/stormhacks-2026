// TigerData uses the shared PostgreSQL pool; do not create a second connection layer.
export { createDatabase } from '../db/database.js';
