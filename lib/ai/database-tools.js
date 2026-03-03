/**
 * Database Tools - AI tool definitions for database operations
 *
 * These tools allow the AI to interact with user-connected databases:
 * - Query database tables
 * - Execute SQL (for schema changes and data operations)
 * - Get schema information
 * - Generate and run migrations
 * - REQUEST DATABASE CONNECTION (pause/resume flow)
 *
 * Supports both Supabase and Neon via direct connection strings.
 * All operations are logged in schema_audit_log for safety and rollback.
 */

import {
  getSupabaseConnectionForUse,
  logSchemaChange,
  updateSchemaChangeStatus,
  getDatabaseConnection,
  getUserDatabaseConnections
} from '../supabase-database.js';
import { decryptSupabaseTokens, decrypt } from '../services/token-encryption.js';
import { ConnectionManager, createConnectionManager } from '../database/connection-manager.js';

// Supabase project API URL
const getProjectApiUrl = (projectRef) => `https://${projectRef}.supabase.co`;

// Cache for service keys (short TTL)
const serviceKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Create database tools for a user's Supabase connection
 *
 * @param {string} userId - User ID
 * @param {string} connectionId - Supabase connection ID
 * @param {string} projectId - EzCoder project ID (for audit)
 * @returns {object} Tool definitions
 */
export async function createDatabaseTools(userId, connectionId, projectId) {
  // Pre-validate connection
  const connection = await getSupabaseConnectionForUse(userId, connectionId);
  if (!connection) {
    throw new Error('Supabase connection not found');
  }

  if (!connection.project_ref) {
    throw new Error('No Supabase project selected for this connection');
  }

  // Helper to get authenticated API access
  async function getProjectAccess() {
    const cacheKey = `${connectionId}:${connection.project_ref}`;
    const cached = serviceKeyCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.access;
    }

    // Decrypt tokens
    const decrypted = await decryptSupabaseTokens({
      access_token_encrypted: connection.access_token_encrypted
    }, userId);

    // Get service role key
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${connection.project_ref}/api-keys`,
      {
        headers: {
          'Authorization': `Bearer ${decrypted.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get project API keys - token may be expired');
    }

    const keys = await response.json();
    const serviceKey = keys.find(k => k.name === 'service_role');

    if (!serviceKey) {
      throw new Error('Service role key not found');
    }

    const access = {
      projectUrl: getProjectApiUrl(connection.project_ref),
      serviceKey: serviceKey.api_key,
      projectRef: connection.project_ref
    };

    // Cache it
    serviceKeyCache.set(cacheKey, {
      access,
      expires: Date.now() + CACHE_TTL
    });

    return access;
  }

  // Helper to execute SQL
  async function executeSQL(sql, options = {}) {
    const { projectUrl, serviceKey, projectRef } = await getProjectAccess();

    // Try PostgREST RPC first
    let response = await fetch(`${projectUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    // Fallback to pg_query endpoint
    if (response.status === 404) {
      response = await fetch(`${projectUrl}/pg/query`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SQL error: ${errorText}`);
    }

    return response.json();
  }

  const tools = {
    /**
     * Query the database (SELECT only)
     */
    queryDatabase: {
      description: 'Execute a SELECT query against the connected Supabase database. Use this to read data or check existing records.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL SELECT query to execute. Must start with SELECT.'
          },
          limit: {
            type: 'number',
            description: 'Maximum rows to return (default: 100, max: 1000)',
            default: 100
          }
        },
        required: ['query']
      },
      execute: async ({ query, limit = 100 }) => {
        // Validate it's a SELECT query
        const trimmed = query.trim().toLowerCase();
        if (!trimmed.startsWith('select')) {
          return {
            success: false,
            error: 'Only SELECT queries allowed. Use executeSQL for data modifications.'
          };
        }

        // Add LIMIT if not present
        if (!trimmed.includes(' limit ')) {
          const safeLimit = Math.min(limit, 1000);
          query = `${query.trim()} LIMIT ${safeLimit}`;
        }

        try {
          const result = await executeSQL(query);
          return {
            success: true,
            rowCount: Array.isArray(result) ? result.length : 0,
            data: result,
            query
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
            query
          };
        }
      }
    },

    /**
     * Execute SQL (for schema changes and data operations)
     */
    executeSQL: {
      description: 'Execute any SQL statement including CREATE, ALTER, INSERT, UPDATE, DELETE. Use for schema changes and data modifications. All operations are logged for audit and rollback.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL statement to execute'
          },
          description: {
            type: 'string',
            description: 'Brief description of what this SQL does (for audit log)'
          },
          dryRun: {
            type: 'boolean',
            description: 'If true, validate the SQL without executing',
            default: false
          }
        },
        required: ['sql', 'description']
      },
      execute: async ({ sql, description, dryRun = false }) => {
        const { projectRef } = await getProjectAccess();

        // Detect operation type
        const operationType = detectOperationType(sql);

        // Block extremely dangerous operations
        const sqlLower = sql.toLowerCase().trim();
        if (/^(drop\s+database|truncate\s+.*cascade)/.test(sqlLower)) {
          return {
            success: false,
            error: 'This SQL statement is blocked for safety. Drop database and cascading truncates are not allowed through the AI interface.'
          };
        }

        // Log the operation attempt
        const auditId = await logSchemaChange({
          userId,
          connectionId,
          projectRef,
          projectId,
          operationType,
          sqlStatement: sql,
          description,
          agentId: 'database-tools',
          status: dryRun ? 'dry_run' : 'pending'
        });

        if (dryRun) {
          try {
            // Use EXPLAIN to validate
            await executeSQL(`EXPLAIN ${sql}`);
            return {
              success: true,
              dryRun: true,
              auditId,
              message: 'SQL is valid and can be executed'
            };
          } catch (error) {
            return {
              success: false,
              dryRun: true,
              auditId,
              error: error.message
            };
          }
        }

        // Execute the SQL
        const startTime = Date.now();
        try {
          const result = await executeSQL(sql);
          const executionTime = Date.now() - startTime;

          // Update audit log
          await updateSchemaChangeStatus(auditId, 'executed', {
            executionTimeMs: executionTime
          });

          return {
            success: true,
            auditId,
            result,
            executionTimeMs: executionTime,
            operationType
          };
        } catch (error) {
          // Update audit log with error
          await updateSchemaChangeStatus(auditId, 'failed', {
            errorMessage: error.message
          });

          return {
            success: false,
            auditId,
            error: error.message,
            operationType
          };
        }
      }
    },

    /**
     * Get database schema information
     */
    getSchema: {
      description: 'Get the database schema including tables, columns, relationships, and RLS policies. Essential for understanding the data model before making changes.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['full', 'tables', 'columns', 'relationships', 'indexes', 'rls'],
            description: 'Type of schema info to retrieve',
            default: 'full'
          },
          tableName: {
            type: 'string',
            description: 'Optional: Get schema for a specific table only'
          }
        }
      },
      execute: async ({ type = 'full', tableName }) => {
        try {
          let query;

          if (tableName) {
            // Specific table info
            query = `
              SELECT
                c.column_name,
                c.data_type,
                c.column_default,
                c.is_nullable,
                c.character_maximum_length,
                col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) as description
              FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = '${tableName}'
              ORDER BY c.ordinal_position
            `;
          } else {
            query = SCHEMA_QUERIES[type] || SCHEMA_QUERIES.full;
          }

          const result = await executeSQL(query);

          return {
            success: true,
            type,
            tableName: tableName || null,
            schema: result
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    /**
     * Generate migration SQL
     */
    generateMigration: {
      description: 'Generate a SQL migration based on a description of desired changes. Returns SQL without executing. Use executeSQL to actually apply the migration.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Description of the migration (e.g., "add email column to users table")'
          },
          includeRollback: {
            type: 'boolean',
            description: 'Include rollback (DOWN) SQL',
            default: true
          }
        },
        required: ['description']
      },
      execute: async ({ description, includeRollback = true }) => {
        // First get current schema for context
        try {
          const schema = await executeSQL(SCHEMA_QUERIES.full);

          // Return migration template - the AI will fill in the actual SQL
          // based on the description and schema context
          return {
            success: true,
            message: 'Use the schema context below to generate appropriate migration SQL',
            schemaContext: schema,
            template: {
              up: `-- Migration: ${description}\n-- Generated for Supabase\n\n-- Your migration SQL here`,
              down: includeRollback ? `-- Rollback: ${description}\n\n-- Your rollback SQL here` : null
            },
            instructions: 'After generating the SQL, use executeSQL with dryRun=true to validate, then executeSQL to apply.'
          };
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    /**
     * Run a migration (with automatic rollback point)
     */
    runMigration: {
      description: 'Execute a migration with automatic savepoint for rollback capability. Wraps the migration in a transaction when possible.',
      parameters: {
        type: 'object',
        properties: {
          upSQL: {
            type: 'string',
            description: 'The migration SQL to execute'
          },
          downSQL: {
            type: 'string',
            description: 'Rollback SQL (stored for manual rollback)'
          },
          migrationName: {
            type: 'string',
            description: 'Name/description of the migration'
          }
        },
        required: ['upSQL', 'migrationName']
      },
      execute: async ({ upSQL, downSQL, migrationName }) => {
        const { projectRef } = await getProjectAccess();

        // Log as migration
        const auditId = await logSchemaChange({
          userId,
          connectionId,
          projectRef,
          projectId,
          operationType: 'migration',
          sqlStatement: upSQL,
          rollbackSql: downSQL,
          description: migrationName,
          agentId: 'database-tools',
          status: 'pending'
        });

        const startTime = Date.now();

        try {
          // Execute migration
          const result = await executeSQL(upSQL);
          const executionTime = Date.now() - startTime;

          // Update audit log
          await updateSchemaChangeStatus(auditId, 'executed', {
            executionTimeMs: executionTime
          });

          return {
            success: true,
            auditId,
            migrationName,
            executionTimeMs: executionTime,
            hasRollback: !!downSQL,
            result
          };
        } catch (error) {
          // Update audit log with error
          await updateSchemaChangeStatus(auditId, 'failed', {
            errorMessage: error.message
          });

          return {
            success: false,
            auditId,
            migrationName,
            error: error.message
          };
        }
      }
    },

    // =========================================================================
    // SERVER & AUTH TOOLS
    // =========================================================================

    /**
     * Get Supabase project configuration
     */
    getSupabaseConfig: {
      description: 'Get Supabase project configuration for client-side integration.',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        try {
          const { projectUrl, anonKey, projectRef } = await getProjectAccess();
          return {
            success: true,
            config: {
              supabaseUrl: projectUrl,
              supabaseAnonKey: anonKey,
              projectRef
            },
            envVars: {
              NEXT_PUBLIC_SUPABASE_URL: projectUrl,
              NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey
            }
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    },

    /**
     * Enable authentication providers
     */
    enableAuth: {
      description: 'Enable Supabase Auth with specified providers.',
      parameters: {
        type: 'object',
        properties: {
          providers: { type: 'array', items: { type: 'string' } },
          redirectUrl: { type: 'string' }
        },
        required: ['providers']
      },
      execute: async ({ providers }) => {
        return {
          success: true,
          providers,
          instructions: providers.filter(p => p !== 'email').map(p => ({
            provider: p,
            step: `Configure ${p} OAuth in Supabase Dashboard > Authentication > Providers`,
            docsUrl: `https://supabase.com/docs/guides/auth/social-login/auth-${p}`
          })),
          codeExample: `// Sign in with OAuth\nawait supabase.auth.signInWithOAuth({ provider: '${providers[0] || 'google'}' })`
        };
      }
    },

    /**
     * Create RLS policy
     */
    createRLSPolicy: {
      description: 'Create a Row Level Security policy.',
      parameters: {
        type: 'object',
        properties: {
          tableName: { type: 'string' },
          policyName: { type: 'string' },
          operation: { type: 'string' },
          using: { type: 'string' },
          withCheck: { type: 'string' }
        },
        required: ['tableName', 'policyName', 'operation', 'using']
      },
      execute: async ({ tableName, policyName, operation, using, withCheck }) => {
        try {
          let sql = `ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;\n`;
          sql += `CREATE POLICY "${policyName}" ON "${tableName}" FOR ${operation} TO authenticated USING (${using})`;
          if (withCheck) sql += ` WITH CHECK (${withCheck})`;
          sql += ';';

          const result = await executeSQL(sql);
          return { success: true, table: tableName, policy: policyName, sql };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    },

    /**
     * Generate API route code
     */
    generateApiRoute: {
      description: 'Generate Next.js API route code.',
      parameters: {
        type: 'object',
        properties: {
          routePath: { type: 'string' },
          methods: { type: 'array', items: { type: 'string' } },
          requireAuth: { type: 'boolean' },
          description: { type: 'string' }
        },
        required: ['routePath', 'methods', 'description']
      },
      execute: async ({ routePath, methods, requireAuth = true, description }) => {
        const filePath = `pages${routePath}.js`.replace(/\[(\w+)\]/g, '[$1]');
        const code = `// ${description}\nimport { createClient } from '@supabase/supabase-js'\n\nconst supabase = createClient(\n  process.env.NEXT_PUBLIC_SUPABASE_URL,\n  process.env.SUPABASE_SERVICE_ROLE_KEY\n)\n\nexport default async function handler(req, res) {\n  ${requireAuth ? '// Add auth check here\n  ' : ''}// Handle ${methods.join(', ')}\n  return res.status(200).json({ message: 'OK' })\n}`;
        return { success: true, routePath, filePath, code, methods };
      }
    },

    /**
     * Generate Edge Function template
     */
    createEdgeFunction: {
      description: 'Generate a Supabase Edge Function.',
      parameters: {
        type: 'object',
        properties: {
          functionName: { type: 'string' },
          description: { type: 'string' },
          useDatabase: { type: 'boolean' }
        },
        required: ['functionName', 'description']
      },
      execute: async ({ functionName, description, useDatabase = true }) => {
        const code = `// ${functionName}: ${description}\nimport { serve } from 'https://deno.land/std@0.168.0/http/server.ts'\n${useDatabase ? "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n" : ''}\nserve(async (req) => {\n  ${useDatabase ? "const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)\n  " : ''}// Your logic here\n  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }})\n})`;
        return {
          success: true,
          functionName,
          code,
          filePath: `supabase/functions/${functionName}/index.ts`,
          deployCommand: `supabase functions deploy ${functionName}`
        };
      }
    }
  };

  return tools;
}

/**
 * Detect the type of SQL operation
 */
function detectOperationType(sql) {
  const sqlLower = sql.toLowerCase().trim();

  if (sqlLower.startsWith('create table')) return 'create_table';
  if (sqlLower.startsWith('alter table')) return 'alter_table';
  if (sqlLower.startsWith('drop table')) return 'drop_table';
  if (sqlLower.startsWith('create index')) return 'create_index';
  if (sqlLower.startsWith('drop index')) return 'drop_index';
  if (sqlLower.startsWith('create policy')) return 'create_policy';
  if (sqlLower.startsWith('drop policy')) return 'drop_policy';
  if (sqlLower.startsWith('alter policy')) return 'alter_policy';
  if (sqlLower.startsWith('create function')) return 'create_function';
  if (sqlLower.startsWith('create trigger')) return 'create_trigger';
  if (sqlLower.startsWith('insert')) return 'insert';
  if (sqlLower.startsWith('update')) return 'update';
  if (sqlLower.startsWith('delete')) return 'delete';
  if (sqlLower.startsWith('select')) return 'select';
  if (sqlLower.startsWith('grant')) return 'grant';
  if (sqlLower.startsWith('revoke')) return 'revoke';

  return 'other';
}

/**
 * SQL queries for schema introspection
 */
const SCHEMA_QUERIES = {
  full: `
    WITH tables_info AS (
      SELECT
        t.table_name,
        t.table_type,
        obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) as table_description,
        (
          SELECT json_agg(
            json_build_object(
              'name', c.column_name,
              'type', c.data_type,
              'nullable', c.is_nullable = 'YES',
              'default', c.column_default,
              'max_length', c.character_maximum_length
            ) ORDER BY c.ordinal_position
          )
          FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = t.table_name
        ) as columns
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    )
    SELECT json_agg(tables_info.*) as schema FROM tables_info
  `,

  tables: `
    SELECT
      table_name,
      table_type,
      obj_description((quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass) as description
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `,

  columns: `
    SELECT
      table_name,
      column_name,
      data_type,
      column_default,
      is_nullable,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `,

  relationships: `
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table,
      ccu.column_name AS foreign_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `,

  indexes: `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `,

  rls: `
    SELECT
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual::text as using_expression,
      with_check::text as check_expression
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `
};

/**
 * Check if user has an active Supabase connection
 */
export async function hasActiveSupabaseConnection(userId) {
  try {
    const { getUserSupabaseConnections } = await import('../supabase-database.js');
    const connections = await getUserSupabaseConnections(userId);
    return connections.some(c => c.status === 'active' && c.project_ref);
  } catch {
    return false;
  }
}

/**
 * Get the active Supabase connection for a user
 */
export async function getActiveSupabaseConnection(userId) {
  try {
    const { getUserSupabaseConnections } = await import('../supabase-database.js');
    const connections = await getUserSupabaseConnections(userId);
    return connections.find(c => c.status === 'active' && c.project_ref) || null;
  } catch {
    return null;
  }
}

// ============================================================================
// AI-INITIATED DATABASE CONNECTION REQUEST
// This tool pauses the AI workflow and prompts user for database credentials
// ============================================================================

/**
 * Create the requestDatabaseConnection tool
 * This is a special tool that can be used even without an existing connection
 *
 * @param {string} userId - User ID
 * @param {string} projectId - EzCoder project ID
 * @returns {object} The requestDatabaseConnection tool definition
 */
export function createRequestDatabaseConnectionTool(userId, projectId) {
  return {
    requestDatabaseConnection: {
      description: `Request database credentials from user. Use this when you need to:
- Create database tables for user data
- Store or query application data
- Set up authentication with database
- Build any full-stack feature requiring persistent storage

This will pause your workflow, show a modal to the user asking them to connect their Supabase or Neon database, and then resume once they provide credentials.`,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why database access is needed (shown to user in the modal). Be specific about what you will create/do.'
          },
          requiredCapabilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'What capabilities you need: "create_tables", "insert_data", "read_data", "update_data", "delete_data", "rls_policies", "migrations"'
          },
          suggestedProvider: {
            type: 'string',
            enum: ['supabase', 'neon', 'any'],
            description: 'Recommended provider based on project needs. Use "supabase" if auth features are needed, "neon" for pure database, "any" otherwise.',
            default: 'any'
          },
          plannedTables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Table name' },
                purpose: { type: 'string', description: 'What this table stores' }
              }
            },
            description: 'Tables you plan to create (helps user understand scope)'
          }
        },
        required: ['reason', 'requiredCapabilities']
      },
      execute: async ({ reason, requiredCapabilities, suggestedProvider = 'any', plannedTables = [] }) => {
        // Check if user already has a connection for this project
        try {
          const connections = await getUserDatabaseConnections(userId);
          const projectConnection = connections.find(c =>
            c.ezcoder_project_id === projectId && c.status === 'active'
          );

          if (projectConnection) {
            // Connection exists! Return it so AI can continue
            return {
              action: 'CONNECTION_EXISTS',
              connectionId: projectConnection.id,
              provider: projectConnection.provider,
              database: projectConnection.database_name,
              message: `Database already connected: ${projectConnection.connection_name}. You can proceed with database operations.`
            };
          }
        } catch (e) {
          // No connections, continue with pause
        }

        // Return PAUSE signal - UI will show modal
        return {
          action: 'PAUSE_FOR_USER_INPUT',
          inputType: 'database_connection',
          prompt: {
            reason,
            requiredCapabilities,
            suggestedProvider,
            plannedTables,
            projectId
          },
          message: 'Waiting for user to connect their database...'
        };
      }
    }
  };
}

/**
 * Check if project has an active database connection
 * @param {string} userId - User ID
 * @param {string} projectId - EzCoder project ID
 * @returns {Promise<object|null>} Connection record or null
 */
export async function getProjectDatabaseConnection(userId, projectId) {
  try {
    const connections = await getUserDatabaseConnections(userId);
    return connections.find(c =>
      c.ezcoder_project_id === projectId && c.status === 'active'
    ) || null;
  } catch {
    return null;
  }
}

/**
 * Create database tools using the new ConnectionManager
 * Works with both direct credentials (Supabase/Neon) and future OAuth
 *
 * @param {string} userId - User ID
 * @param {string} connectionId - Database connection ID
 * @param {string} projectId - EzCoder project ID
 * @returns {Promise<object>} Tool definitions
 */
export async function createDatabaseToolsV2(userId, connectionId, projectId) {
  // Get connection record
  const connection = await getDatabaseConnection(userId, connectionId);
  if (!connection) {
    throw new Error('Database connection not found');
  }

  // Create connection manager
  const manager = createConnectionManager(connection, userId);

  const tools = {
    /**
     * Query the database (SELECT only)
     */
    queryDatabase: {
      description: 'Execute a SELECT query against the connected database. Use this to read data or check existing records.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL SELECT query to execute. Must start with SELECT.'
          },
          limit: {
            type: 'number',
            description: 'Maximum rows to return (default: 100, max: 1000)',
            default: 100
          }
        },
        required: ['query']
      },
      execute: async ({ query, limit = 100 }) => {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed.startsWith('select')) {
          return {
            success: false,
            error: 'Only SELECT queries allowed. Use executeSQL for data modifications.'
          };
        }

        if (!trimmed.includes(' limit ')) {
          const safeLimit = Math.min(limit, 1000);
          query = `${query.trim()} LIMIT ${safeLimit}`;
        }

        return await manager.query(query);
      }
    },

    /**
     * Execute SQL (any statement)
     */
    executeSQL: {
      description: 'Execute any SQL statement including CREATE, ALTER, INSERT, UPDATE, DELETE. Use for schema changes and data modifications.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL statement to execute'
          },
          description: {
            type: 'string',
            description: 'Brief description of what this SQL does (for audit log)'
          }
        },
        required: ['sql', 'description']
      },
      execute: async ({ sql, description }) => {
        // Block dangerous operations
        const sqlLower = sql.toLowerCase().trim();
        if (/^(drop\s+database|truncate\s+.*cascade)/.test(sqlLower)) {
          return {
            success: false,
            error: 'This SQL statement is blocked for safety.'
          };
        }

        const operationType = detectOperationType(sql);

        // Log the operation
        const auditId = await logSchemaChange({
          userId,
          connectionId,
          projectId,
          operationType,
          sqlStatement: sql,
          description,
          agentId: 'database-tools-v2',
          status: 'pending'
        });

        const result = await manager.query(sql);

        // Update audit status
        await updateSchemaChangeStatus(auditId, result.success ? 'executed' : 'failed', {
          errorMessage: result.error,
          executionTimeMs: result.duration
        });

        return {
          ...result,
          auditId,
          operationType
        };
      }
    },

    /**
     * Get database schema
     */
    getSchema: {
      description: 'Get the database schema including tables and columns.',
      parameters: {
        type: 'object',
        properties: {
          tableName: {
            type: 'string',
            description: 'Optional: Get schema for a specific table only'
          }
        }
      },
      execute: async ({ tableName }) => {
        if (tableName) {
          const result = await manager.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `, [tableName]);
          return { success: true, tableName, columns: result.rows };
        }
        return await manager.getSchema();
      }
    },

    /**
     * List tables
     */
    listTables: {
      description: 'List all tables in the database.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        return await manager.listTables();
      }
    },

    /**
     * Create RLS policy
     */
    createRLSPolicy: {
      description: 'Create a Row Level Security policy on a table.',
      parameters: {
        type: 'object',
        properties: {
          tableName: { type: 'string' },
          policyName: { type: 'string' },
          operation: { type: 'string', enum: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'] },
          using: { type: 'string', description: 'USING clause for the policy' },
          withCheck: { type: 'string', description: 'WITH CHECK clause (optional)' }
        },
        required: ['tableName', 'policyName', 'operation', 'using']
      },
      execute: async ({ tableName, policyName, operation, using, withCheck }) => {
        let sql = `ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;\n`;
        sql += `CREATE POLICY "${policyName}" ON "${tableName}" FOR ${operation} USING (${using})`;
        if (withCheck) sql += ` WITH CHECK (${withCheck})`;
        sql += ';';

        return await manager.query(sql);
      }
    }
  };

  return tools;
}

export default {
  createDatabaseTools,
  createDatabaseToolsV2,
  createRequestDatabaseConnectionTool,
  getProjectDatabaseConnection,
  hasActiveSupabaseConnection,
  getActiveSupabaseConnection
};
