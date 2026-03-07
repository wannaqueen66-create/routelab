const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { migrateDatabase } = require('./migrate');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', (client) => {
    client
        .query(`SET client_encoding TO 'UTF8'`)
        .catch((error) => console.error('Failed to enforce UTF-8 client encoding', error));
});

// Legacy init.sql path (deprecated)
// In container: __dirname is /app/src/db, scripts would be /app/scripts
const INIT_SQL_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'init.sql');
const REQUIRED_SOCIAL_TABLES = [
    'route_likes',
    'route_comments',
];

let databaseReadyPromise = null;

function splitSqlStatements(sql) {
    return sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function applyInitSql() {
    // Deprecated: kept only for local/dev compatibility.
    if (!INIT_SQL_PATH) {
        return;
    }
    if (!fs.existsSync(INIT_SQL_PATH)) {
        return;
    }

    // Only run legacy init.sql when explicitly enabled.
    if (process.env.DB_BOOTSTRAP_LEGACY_INIT !== '1') {
        return;
    }

    let sql;
    try {
        sql = await fs.promises.readFile(INIT_SQL_PATH, 'utf8');
    } catch (error) {
        console.error('Unable to read database init script', error);
        throw error;
    }
    if (!sql || !sql.trim()) {
        return;
    }

    const statements = splitSqlStatements(sql);
    if (!statements.length) {
        return;
    }

    const client = await pool.connect();
    try {
        console.log('Applying legacy database init.sql (DB_BOOTSTRAP_LEGACY_INIT=1)');
        for (const statement of statements) {
            try {
                await client.query(statement);
            } catch (error) {
                const normalized = statement.trim().toUpperCase();
                if (normalized.startsWith('CREATE EXTENSION') && error.code === '42501') {
                    console.warn('Skipping CREATE EXTENSION due to insufficient privileges');
                    continue;
                }
                throw error;
            }
        }
        console.log('Legacy init.sql applied');
    } finally {
        client.release();
    }
}

async function verifyRequiredTables() {
    if (!REQUIRED_SOCIAL_TABLES.length) {
        return;
    }
    try {
        const { rows } = await pool.query(
            `SELECT tablename
       FROM pg_catalog.pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
            [REQUIRED_SOCIAL_TABLES]
        );
        const existing = new Set(rows.map((row) => row.tablename));
        const missing = REQUIRED_SOCIAL_TABLES.filter((name) => !existing.has(name));
        if (missing.length) {
            throw new Error(`Missing required database tables: ${missing.join(', ')}`);
        }
    } catch (error) {
        error.message = `Failed to verify required tables: ${error.message}`;
        throw error;
    }
}

async function verifyUtf8Encoding() {
    const client = await pool.connect();
    try {
        const serverResult = await client.query(`SHOW SERVER_ENCODING`);
        const clientResult = await client.query(`SHOW CLIENT_ENCODING`);
        const serverEncoding = serverResult?.rows?.[0]?.server_encoding || '';
        const clientEncoding = clientResult?.rows?.[0]?.client_encoding || '';
        if (typeof serverEncoding === 'string' && serverEncoding.toUpperCase() !== 'UTF8') {
            throw new Error(`PostgreSQL server_encoding must be UTF8 (current: ${serverEncoding})`);
        }
        if (typeof clientEncoding === 'string' && clientEncoding.toUpperCase() !== 'UTF8') {
            console.warn(
                `Adjusting PostgreSQL client_encoding to UTF8 (previous value: ${clientEncoding})`
            );
            await client.query(`SET client_encoding TO 'UTF8'`);
        }
        const { rows } = await client.query(
            `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'nickname'
        LIMIT 1`
        );
        const nicknameType = rows?.[0]?.data_type || '';
        if (nicknameType && nicknameType.toLowerCase() !== 'text') {
            throw new Error(`users.nickname column must be TEXT (current: ${nicknameType})`);
        }
    } finally {
        client.release();
    }
}

function ensureDatabaseReady() {
    if (!databaseReadyPromise) {
        databaseReadyPromise = (async () => {
            // New path: apply SQL migrations (idempotent, versioned)
            await migrateDatabase(pool, {
                migrationsDir: path.resolve(__dirname, '..', '..', 'migrations'),
            });

            // Legacy path (dev only)
            await applyInitSql();

            await verifyUtf8Encoding();
            await verifyRequiredTables();
        })().catch((error) => {
            databaseReadyPromise = null;
            throw error;
        });
    }
    return databaseReadyPromise;
}

async function assertDatabaseEncoding() {
    let client;
    try {
        client = await pool.connect();
        const serverEncodingResult = await client.query(`SHOW SERVER_ENCODING`);
        const clientEncodingResult = await client.query(`SHOW CLIENT_ENCODING`);
        const serverEncoding = serverEncodingResult.rows?.[0]?.server_encoding;
        const clientEncoding = clientEncodingResult.rows?.[0]?.client_encoding;
        if (serverEncoding && serverEncoding.toUpperCase() !== 'UTF8') {
            console.warn(
                `[db] Unexpected server encoding "${serverEncoding}". Expected UTF8 to avoid mojibake issues.`
            );
        }
        if (clientEncoding && clientEncoding.toUpperCase() !== 'UTF8') {
            console.warn(
                `[db] Unexpected client encoding "${clientEncoding}". Expected UTF8 to avoid mojibake issues.`
            );
        }
    } catch (error) {
        console.error('[db] Failed to verify database encoding', error);
    } finally {
        if (client) {
            client.release();
        }
    }
}

// Perform initial check (skip during tests)
if (process.env.NODE_ENV !== 'test') {
    assertDatabaseEncoding();
}

module.exports = {
    pool,
    ensureDatabaseReady
};
