/**
 * Database Connections List API
 *
 * GET - List all database connections for the authenticated user
 *
 * Query params:
 *   projectId?: Filter by EzCoder project ID
 *   status?: Filter by status ('active', 'failed', 'disconnected')
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getAdminClient } from '../../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = session.user.id;
  const { projectId, status } = req.query;

  try {
    const supabase = getAdminClient();

    let query = supabase
      .from('database_connections')
      .select(`
        id,
        provider,
        connection_method,
        connection_name,
        host,
        database_name,
        project_ref,
        ezcoder_project_id,
        status,
        last_verified_at,
        last_used_at,
        created_at,
        updated_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (projectId) {
      query = query.eq('ezcoder_project_id', projectId);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Format response
    const connections = data.map(conn => ({
      id: conn.id,
      provider: conn.provider,
      connectionMethod: conn.connection_method,
      name: conn.connection_name,
      host: conn.host,
      database: conn.database_name,
      projectRef: conn.project_ref,
      ezcoderProjectId: conn.ezcoder_project_id,
      status: conn.status,
      lastVerified: conn.last_verified_at,
      lastUsed: conn.last_used_at,
      createdAt: conn.created_at,
      updatedAt: conn.updated_at
    }));

    return res.status(200).json({
      connections,
      count: connections.length
    });

  } catch (error) {
    console.error('[database/connections] Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch connections',
      details: error.message
    });
  }
}
