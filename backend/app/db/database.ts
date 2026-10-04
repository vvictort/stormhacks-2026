import pg from 'pg';

export function createDatabase(connectionString: string) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'no-verify' || url.searchParams.get('uselibpqcompat') === 'true') {
    throw new Error('Database TLS configuration must verify server certificates.');
  }
  if (mode && mode !== 'disable') url.searchParams.set('sslmode', 'verify-full');
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
