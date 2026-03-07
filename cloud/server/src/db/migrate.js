const fs = require('fs');
const path = require('path');

function listMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedVersions(client) {
  const { rows } = await client.query(
    `SELECT version FROM schema_migrations ORDER BY version ASC`
  );
  return new Set(rows.map((r) => r.version));
}

async function applyMigration(client, { version, sql }) {
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await client.query(statement);
  }
  await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [version]);
}

async function migrateDatabase(pool, options = {}) {
  // In the container: __dirname is /app/src/db
  // Migrations are copied to /app/migrations
  const migrationsDir =
    options.migrationsDir || path.resolve(__dirname, '..', '..', 'migrations');

  const files = listMigrationFiles(migrationsDir);
  if (!files.length) {
    console.warn(`[db] No migration files found in ${migrationsDir}, skipping migrations`);
    return { applied: [], skipped: [] };
  }

  const client = await pool.connect();
  const applied = [];
  const skipped = [];

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);
    const appliedVersions = await readAppliedVersions(client);

    for (const filename of files) {
      if (appliedVersions.has(filename)) {
        skipped.push(filename);
        continue;
      }

      const fullPath = path.join(migrationsDir, filename);
      const sql = fs.readFileSync(fullPath, 'utf8');
      console.log(`[db] Applying migration ${filename}`);
      await applyMigration(client, { version: filename, sql });
      applied.push(filename);
    }

    await client.query('COMMIT');
    return { applied, skipped };
  } catch (error) {
    await client.query('ROLLBACK');
    error.message = `[db] Migration failed: ${error.message}`;
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  migrateDatabase,
};
