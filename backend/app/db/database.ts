import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const backendDir = fileURLToPath(new URL('../../', import.meta.url));

export function createDatabase(connectionString: string) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'no-verify' || url.searchParams.get('uselibpqcompat') === 'true') {
    throw new Error('Database TLS configuration must verify server certificates.');
  }
  if (mode && mode !== 'disable') url.searchParams.set('sslmode', 'verify-full');
  // A relative CA path (e.g. certs/tigerdata-ca.pem) is relative to backend/, so the same URL works on every machine.
  const rootCert = url.searchParams.get('sslrootcert');
  if (rootCert && !isAbsolute(rootCert)) url.searchParams.set('sslrootcert', backendDir + rootCert);
  // Preserve CA/cert parameters while making certificate verification explicit.
  return new pg.Pool({ connectionString: url.toString(), max: 10, connectionTimeoutMillis: 5000 });
}
export type Database = pg.Pool;

export async function transaction<T>(db: Database, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
