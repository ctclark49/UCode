/**
 * Database Connection API
 *
 * POST - Create a new database connection
 *
 * Body: {
 *   provider: 'supabase' | 'neon',
 *   connectionName: string,
 *   connectionString: string,
 *   projectId?: string (EzCoder project to link)
 * }
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { validateConnectionString, parseConnectionString } from '../../../lib/database/connection-manager.js';
import { encrypt } from '../../../lib/services/token-encryption.js';
import { getAdminClient } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = session.user.id;
  const { provider, connectionName, connectionString, projectId } = req.body;

  // Validate required fields
  if (!provider || !['supabase', 'neon'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Must be "supabase" or "neon".' });
  }

  if (!connectionName || connectionName.trim().length < 1) {
    return res.status(400).json({ error: 'Connection name is required' });
  }

  if (!connectionString || !connectionString.startsWith('postgresql://')) {
    return res.status(400).json({
      error: 'Invalid connection string format',
      hint: 'Connection string must start with postgresql://'
    });
  }

  try {
    // Parse connection string to extract metadata
    const parsed = parseConnectionString(connectionString);
    if (!parsed.valid) {
      return res.status(400).json({
        error: 'Failed to parse connection string',
        details: parsed.error
      });
    }

    // Validate by actually connecting
    const validation = await validateConnectionString(connectionString);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Failed to connect to database',
        details: validation.error,
        code: validation.code,
        hint: getConnectionHint(validation.code, provider)
      });
    }

    // Encrypt connection string
    const { encrypted, iv, salt } = await encrypt(connectionString, userId);

    // Store in database
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('database_connections')
      .insert({
        user_id: userId,
        provider,
        connection_method: 'direct',
        connection_name: connectionName.trim(),
        connection_string_encrypted: encrypted,
        encryption_iv: iv,
        encryption_salt: salt,
        host: parsed.host,
        database_name: parsed.database || validation.database,
        project_ref: parsed.projectRef,
        ezcoder_project_id: projectId || null,
        status: 'active',
        last_verified_at: new Date().toISOString()
      })
      .select('id, provider, connection_name, host, database_name, status, created_at')
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'A connection with this name already exists',
          code: 'DUPLICATE_NAME'
        });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      connection: data,
      validation: {
        database: validation.database,
        connectedAs: validation.connectedAs,
        provider: validation.provider
      }
    });

  } catch (error) {
    console.error('[database/connect] Error:', error);
    return res.status(500).json({
      error: 'Failed to save connection',
      details: error.message
    });
  }
}

/**
 * Get helpful hint for common connection errors
 */
function getConnectionHint(errorCode, provider) {
  const hints = {
    // PostgreSQL error codes
    '28P01': 'Invalid password. Check your connection string credentials.',
    '28000': 'Authentication failed. Verify username and password.',
    '3D000': 'Database does not exist. Check the database name in your connection string.',
    'ENOTFOUND': 'Could not resolve hostname. Check your connection string.',
    'ECONNREFUSED': 'Connection refused. The database may not be running or accessible.',
    'ETIMEDOUT': 'Connection timed out. Check your network and firewall settings.'
  };

  const providerHints = {
    supabase: 'For Supabase, use the connection string from Project Settings → Database → Connection String. Use the "Transaction pooler" option for best compatibility.',
    neon: 'For Neon, use the connection string from your Dashboard → Connection Details. Make sure to include sslmode=require.'
  };

  return hints[errorCode] || providerHints[provider] || 'Check your connection string and database settings.';
}
