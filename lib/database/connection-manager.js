/**
 * Connection Manager - Unified database connection abstraction
 *
 * Supports two connection methods:
 * 1. Direct credentials - User provides connection string (Supabase or Neon)
 * 2. OAuth - Supabase Management API tokens (future, when partner approved)
 *
 * Both methods share the same interface for AI tools.
 */

import pg from 'pg';
import { decrypt } from '../services/token-encryption.js';

const { Pool } = pg;

// Cache pools per connection to avoid creating new ones each time
const connectionPools = new Map();

// Schema introspection query (works for any PostgreSQL)
const SCHEMA_INTROSPECTION_SQL = `
SELECT
  t.table_schema,
  t.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default,
  c.character_maximum_length,
  tc.constraint_type,
  kcu.constraint_name
FROM
  information_schema.tables t
LEFT JOIN
  information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
LEFT JOIN
  information_schema.key_column_usage kcu ON c.column_name = kcu.column_name AND c.table_name = kcu.table_name AND c.table_schema = kcu.table_schema
LEFT JOIN
  information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name AND tc.table_schema = kcu.table_schema
WHERE
  t.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND t.table_type = 'BASE TABLE'
ORDER BY
  t.table_schema, t.table_name, c.ordinal_position;
`;

// List tables query
const LIST_TABLES_SQL = `
SELECT
  table_schema,
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name AND table_schema = t.table_schema) as column_count
FROM
  information_schema.tables t
WHERE
  table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_type = 'BASE TABLE'
ORDER BY
  table_schema, table_name;
`;

/**
 * Connection Manager class
 * Provides unified interface for database operations regardless of connection method
 */
export class ConnectionManager {
  constructor(connectionRecord, userId) {
    this.record = connectionRecord;
    this.userId = userId;
    this.pool = null;
    this.connected = false;
  }

  /**
   * Get or create a connection pool
   */
  async connect() {
    if (this.connected && this.pool) {
      return this;
    }

    const cacheKey = `${this.userId}:${this.record.id}`;

    // Check cache first
    if (connectionPools.has(cacheKey)) {
      this.pool = connectionPools.get(cacheKey);
      this.connected = true;
      return this;
    }

    if (this.record.connection_method === 'direct') {
      await this.connectDirect();
    } else if (this.record.connection_method === 'oauth') {
      await this.connectOAuth();
    } else {
      throw new Error(`Unknown connection method: ${this.record.connection_method}`);
    }

    // Cache the pool
    connectionPools.set(cacheKey, this.pool);
    this.connected = true;

    return this;
  }

  /**
   * Connect using direct connection string
   */
  async connectDirect() {
    // Decrypt connection string
    const connectionString = await decrypt(
      this.record.connection_string_encrypted,
      this.userId,
      this.record.encryption_iv,
      this.record.encryption_salt
    );

    // Create pool with SSL for cloud databases
    this.pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false // Required for Supabase/Neon poolers
      },
      // Connection pool settings
      max: 5,                    // Max connections in pool
      idleTimeoutMillis: 30000,  // Close idle connections after 30s
      connectionTimeoutMillis: 10000 // Timeout connecting
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  /**
   * Connect using OAuth tokens (future - Supabase Management API)
   */
  async connectOAuth() {
    // Future implementation when Supabase partner approval is granted
    // Will use Supabase Management API with OAuth tokens

    // For now, check if tokens need refresh
    if (this.record.oauth_expires_at) {
      const expiresAt = new Date(this.record.oauth_expires_at);
      const now = new Date();
      const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

      if (expiresAt < fifteenMinutesFromNow) {
        await this.refreshOAuthToken();
      }
    }

    throw new Error('OAuth connection method not yet implemented. Use direct connection string.');
  }

  /**
   * Refresh OAuth token (future)
   */
  async refreshOAuthToken() {
    // TODO: Implement when Supabase partner approval is granted
    // Will call Supabase token refresh endpoint
  }

  /**
   * Execute a SQL query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<object>} Query result
   */
  async query(sql, params = []) {
    if (!this.connected) {
      await this.connect();
    }

    const client = await this.pool.connect();
    try {
      const start = Date.now();
      const result = await client.query(sql, params);
      const duration = Date.now() - start;

      return {
        success: true,
        rows: result.rows,
        rowCount: result.rowCount,
        command: result.command,
        fields: result.fields?.map(f => ({
          name: f.name,
          dataType: f.dataTypeID
        })),
        duration
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint
      };
    } finally {
      client.release();
    }
  }

  /**
   * Execute SQL with transaction support
   */
  async executeInTransaction(sqlStatements) {
    if (!this.connected) {
      await this.connect();
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const results = [];
      for (const sql of sqlStatements) {
        const result = await client.query(sql);
        results.push({
          command: result.command,
          rowCount: result.rowCount
        });
      }

      await client.query('COMMIT');
      return { success: true, results };
    } catch (error) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get database schema
   */
  async getSchema() {
    const result = await this.query(SCHEMA_INTROSPECTION_SQL);

    if (!result.success) {
      return result;
    }

    // Organize into tables with columns
    const tables = {};
    for (const row of result.rows) {
      const tableKey = `${row.table_schema}.${row.table_name}`;
      if (!tables[tableKey]) {
        tables[tableKey] = {
          schema: row.table_schema,
          name: row.table_name,
          columns: []
        };
      }
      if (row.column_name) {
        tables[tableKey].columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
          maxLength: row.character_maximum_length,
          constraint: row.constraint_type,
          constraintName: row.constraint_name
        });
      }
    }

    return {
      success: true,
      tables: Object.values(tables),
      rawRows: result.rows
    };
  }

  /**
   * List all tables
   */
  async listTables() {
    return await this.query(LIST_TABLES_SQL);
  }

  /**
   * Test connection health
   */
  async verify() {
    try {
      await this.connect();
      const result = await this.query('SELECT current_database(), current_user, version()');

      if (result.success && result.rows.length > 0) {
        return {
          success: true,
          database: result.rows[0].current_database,
          user: result.rows[0].current_user,
          version: result.rows[0].version,
          provider: this.record.provider
        };
      }

      return { success: false, error: 'No response from database' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Close connection pool
   */
  async disconnect() {
    if (this.pool) {
      const cacheKey = `${this.userId}:${this.record.id}`;
      connectionPools.delete(cacheKey);
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  /**
   * Get connection info (safe to display)
   */
  getInfo() {
    return {
      id: this.record.id,
      provider: this.record.provider,
      method: this.record.connection_method,
      name: this.record.connection_name,
      host: this.record.host,
      database: this.record.database_name,
      status: this.record.status,
      lastVerified: this.record.last_verified_at,
      lastUsed: this.record.last_used_at
    };
  }
}

/**
 * Parse connection string to extract metadata
 * @param {string} connectionString - PostgreSQL connection string
 * @returns {object} Parsed metadata
 */
export function parseConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);

    // Determine provider from host
    let provider = 'unknown';
    if (url.host.includes('supabase.co') || url.host.includes('supabase.com')) {
      provider = 'supabase';
    } else if (url.host.includes('neon.tech')) {
      provider = 'neon';
    } else if (url.host.includes('railway.app')) {
      provider = 'railway';
    } else if (url.host.includes('render.com')) {
      provider = 'render';
    }

    // Extract project ref for Supabase
    let projectRef = null;
    if (provider === 'supabase') {
      // Format: postgres.[project-ref]:[pass]@...
      const userMatch = url.username.match(/^postgres\.(.+)$/);
      if (userMatch) {
        projectRef = userMatch[1];
      }
    }

    return {
      valid: true,
      provider,
      host: url.host,
      database: url.pathname.replace('/', '') || 'postgres',
      user: url.username,
      projectRef,
      ssl: url.searchParams.get('sslmode') || 'require'
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Validate connection string by attempting to connect
 * @param {string} connectionString - PostgreSQL connection string
 * @returns {Promise<object>} Validation result
 */
export async function validateConnectionString(connectionString) {
  const parsed = parseConnectionString(connectionString);
  if (!parsed.valid) {
    return { success: false, error: 'Invalid connection string format' };
  }

  // Try to connect
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT current_database(), current_user');
      return {
        success: true,
        ...parsed,
        database: result.rows[0].current_database,
        connectedAs: result.rows[0].current_user
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      success: false,
      ...parsed,
      error: error.message,
      code: error.code
    };
  } finally {
    await pool.end();
  }
}

/**
 * Create a ConnectionManager from a stored connection record
 * @param {object} connectionRecord - Database connection record
 * @param {string} userId - User ID for decryption
 * @returns {ConnectionManager} Manager instance
 */
export function createConnectionManager(connectionRecord, userId) {
  return new ConnectionManager(connectionRecord, userId);
}

export default {
  ConnectionManager,
  createConnectionManager,
  parseConnectionString,
  validateConnectionString
};
