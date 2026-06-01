type QueryResultRow = Record<string, unknown>;

type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: QueryResultRow[];
  }>;
};

declare const pool: PoolLike;

export async function getUserById(id: string) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0];
}

