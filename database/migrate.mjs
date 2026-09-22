#!/usr/bin/env node
/**
 * Database migration runner.
 * Applies SQL migration files in order, tracking state in schema_migrations.
 * Usage:
 *   node database/migrate.mjs          -- apply all pending migrations
 *   node database/migrate.mjs rollback -- (not implemented — migrations are forward-only)
 */

import { createReadStream } from 'fs';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    database: process.env.DATABASE_NAME ?? 'platform_mgmt',
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres',
  });

  const client = await pool.connect();

  try {
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Load applied migrations
    const { rows: applied } = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedVersions = new Set(applied.map((r) => r.version));

    // Read migration files
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      const version = file.replace('.sql', '');
      if (appliedVersions.has(version)) {
        console.log(`  ✓ ${version} (already applied)`);
        continue;
      }

      console.log(`  → Applying ${version}...`);
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [version],
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${version} applied`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${version} failed: ${err.message}`);
      }
    }

    if (appliedCount === 0) {
      console.log('Database is up to date. No migrations to apply.');
    } else {
      console.log(`\nApplied ${appliedCount} migration(s) successfully.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
