type QueryResultRow = Record<string, unknown>;

// Minimal Pool-like type to avoid adding a real 'pg' dependency.
type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: QueryResultRow[];
  }>;
};

declare const pool: PoolLike;

export async function runHealthCheck(): Promise<QueryResultRow | undefined> {
  const result = await pool.query("SELECT 1", []);
  return result.rows[0];
}

