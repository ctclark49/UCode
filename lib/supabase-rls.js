/**
 * Supabase RLS-Enforced Database Operations
 *
 * This module provides database operations that respect Row Level Security.
 * It wraps the common database operations and uses user-scoped clients
 * instead of the admin (service_role) client.
 *
 * MIGRATION STRATEGY:
 * - User-facing operations use getUserSupabaseClient() → RLS enforced
 * - System operations use getSupabaseAdmin() → RLS bypassed (intentional)
 *
 * USAGE:
 * ```javascript
 * // In API routes - RLS enforced
 * import { getUserProjects, getProject } from '@/lib/supabase-rls';
 *
 * const session = await getServerSession(req, res, authOptions);
 * const projects = await getUserProjects(session.user.id);
 * ```
 *
 * @module lib/supabase-rls
 */

import { getUserSupabaseClient, isUserAuthAvailable } from './supabase-user-auth';
import { getSupabaseAdmin } from './supabase';
import { v4 as uuidv4 } from 'uuid';

// Helper function to ensure proper date formatting
function formatDate(date) {
  if (!date) return new Date().toISOString();
  if (date instanceof Date) return date.toISOString();
  if (typeof date === 'string') {
    try {
      return new Date(date).toISOString();
    } catch (e) {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Get the appropriate Supabase client based on context
 *
 * @param {string} userId - User ID for user-scoped operations
 * @param {object} options - Options
 * @param {boolean} options.requireAdmin - Force admin client (for system operations)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getClient(userId, options = {}) {
  const { requireAdmin = false } = options;

  // Use admin client if explicitly required or if user auth is not available
  if (requireAdmin || !isUserAuthAvailable()) {
    return getSupabaseAdmin();
  }

  // Use user-scoped client for RLS enforcement
  if (userId) {
    return getUserSupabaseClient(userId);
  }

  // Fallback to admin (should not happen in normal flow)
  console.warn('[supabase-rls] No userId provided, falling back to admin client');
  return getSupabaseAdmin();
}

// ============================================================================
// USER OPERATIONS (Read-only for own data - RLS enforced)
// ============================================================================

/**
 * Get user by ID - RLS enforced
 * User can only read their own record.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<object|null>} - User data or null
 */
export async function getUserById(userId) {
  try {
    const supabase = getClient(userId);
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getUserById] Error:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('[getUserById] Error getting user by ID:', error);
    return null;
  }
}

/**
 * Get user usage stats - RLS enforced
 * User can only read their own stats.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<object>} - Usage stats
 */
export async function getUserUsageStats(userId) {
  try {
    const supabase = getClient(userId);

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        subscription_tier,
        subscription_status,
        usage_limit,
        daily_usage_count,
        daily_usage_reset_at,
        project_count,
        total_generations,
        credit_balance,
        free_credits_monthly,
        free_credits_used
      `)
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getUserUsageStats] Error:', error);
      throw error;
    }

    if (!user) {
      throw new Error('User not found');
    }

    // Get token information using tokens-v2 for consistency
    let tokensInfo = null;
    let creditsInfo = null;
    try {
      const { tokenManagerV2 } = await import('./tokens-v2.js');
      tokensInfo = await tokenManagerV2.getUserTokens(userId);
      const tokenPrice = 0.10; // $0.10 per 1K tokens
      creditsInfo = {
        balance: (tokensInfo.additionalTokens / 1000) * tokenPrice,
        freeCredits: (tokensInfo.monthlyTokens / 1000) * tokenPrice,
        totalAvailable: (tokensInfo.totalAvailable / 1000) * tokenPrice,
        subscription: tokensInfo.subscription
      };
    } catch (tokenError) {
      console.warn('[getUserUsageStats] Could not get token info:', tokenError);
      creditsInfo = {
        balance: user.credit_balance || 0,
        freeCredits: Math.max(0, (user.free_credits_monthly || 10) - (user.free_credits_used || 0)),
        totalAvailable: (user.credit_balance || 0) + Math.max(0, (user.free_credits_monthly || 10) - (user.free_credits_used || 0)),
        subscription: user.subscription_tier
      };
      tokensInfo = {
        monthlyTokens: Math.round((creditsInfo.freeCredits / 0.10) * 1000),
        additionalTokens: Math.round((creditsInfo.balance / 0.10) * 1000),
        totalAvailable: Math.round((creditsInfo.totalAvailable / 0.10) * 1000),
        subscription: creditsInfo.subscription,
        monthlyTokensLimit: user.subscription_tier === 'starter' ? 100000 :
          user.subscription_tier === 'creator' ? 500000 :
            user.subscription_tier === 'business' ? 2000000 : 100000,
        hasDailyLimit: user.subscription_tier === 'starter' || user.subscription_tier === 'free',
        dailyTokensLimit: 7500,
        dailyTokensRemaining: 7500
      };
    }

    const skip_usage_check = user.subscription_tier === 'business';

    return {
      ...user,
      is_daily: false,
      skip_usage_check,
      usage_count: user.daily_usage_count || 0,
      remaining: user.usage_limit === -1 ? 'unlimited' : Math.max(0, user.usage_limit - (user.daily_usage_count || 0)),
      credits: creditsInfo,
      creditsAvailable: creditsInfo.totalAvailable,
      creditBalance: creditsInfo.balance,
      freeCredits: creditsInfo.freeCredits,
      tokens: tokensInfo
    };
  } catch (error) {
    console.error('[getUserUsageStats] Error getting user usage stats:', error);
    throw error;
  }
}

// ============================================================================
// PROJECT OPERATIONS (RLS enforced - users can only access their own projects)
// ============================================================================

/**
 * Get all projects for a user - RLS enforced
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} - Array of projects
 */
export async function getUserProjects(userId) {
  try {
    const supabase = getClient(userId);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    // Map to expected structure
    const projects = (data || []).map(project => ({
      ...project,
      userId: project.user_id,
      createdAt: formatDate(project.created_at),
      updatedAt: formatDate(project.updated_at),
      created_at: formatDate(project.created_at),
      updated_at: formatDate(project.updated_at)
    }));

    return projects;
  } catch (error) {
    console.error('[getUserProjects] Error:', error);
    throw error;
  }
}

/**
 * Get a single project - RLS enforced
 * RLS ensures user can only access their own projects.
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @returns {Promise<object|null>} - Project data or null
 */
export async function getProject(projectId, userId) {
  try {
    const supabase = getClient(userId);

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getProject] Error:', error);
      throw error;
    }

    if (data) {
      return {
        ...data,
        userId: data.user_id,
        createdAt: formatDate(data.created_at),
        updatedAt: formatDate(data.updated_at),
        created_at: formatDate(data.created_at),
        updated_at: formatDate(data.updated_at)
      };
    }

    return null;
  } catch (error) {
    console.error('[getProject] Error:', error);
    throw error;
  }
}

/**
 * Create a new project - RLS enforced
 *
 * @param {string} userId - The user's ID
 * @param {object} projectData - Project data
 * @returns {Promise<object>} - Created project
 */
export async function createProject(userId, projectData) {
  try {
    const supabase = getClient(userId);

    // Check project limit (uses admin to read limits)
    const adminClient = getSupabaseAdmin();
    const { data: user, error: userError } = await adminClient
      .from('users')
      .select('subscription_tier, project_count')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get actual project count
    const { count, error: countError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    const projectLimit = user.subscription_tier === 'starter' ? 3 : -1;

    if (projectLimit !== -1 && count >= projectLimit) {
      throw new Error('Project limit reached. Upgrade to create more projects.');
    }

    // Create the project
    const projectId = uuidv4();
    const now = new Date().toISOString();
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        id: projectId,
        user_id: userId,
        name: projectData.name,
        description: projectData.description || '',
        files: projectData.files || {},
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Update user's project count (admin operation)
    await adminClient
      .from('users')
      .update({ project_count: (count || 0) + 1 })
      .eq('id', userId);

    return {
      ...project,
      userId: project.user_id,
      createdAt: formatDate(project.created_at),
      updatedAt: formatDate(project.updated_at),
      created_at: formatDate(project.created_at),
      updated_at: formatDate(project.updated_at)
    };
  } catch (error) {
    console.error('[createProject] Error:', error);
    throw error;
  }
}

/**
 * Update a project - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @param {object} projectData - Update data
 * @returns {Promise<object>} - Updated project
 */
export async function updateProject(projectId, userId, projectData) {
  try {
    const supabase = getClient(userId);

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (projectData.name !== undefined) updateData.name = projectData.name;
    if (projectData.description !== undefined) updateData.description = projectData.description;
    if (projectData.files !== undefined) updateData.files = projectData.files;
    if (projectData.deployment_status !== undefined) updateData.deployment_status = projectData.deployment_status;
    if (projectData.deployed_url !== undefined) updateData.deployed_url = projectData.deployed_url;
    if (projectData.subdomain !== undefined) updateData.subdomain = projectData.subdomain;

    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select()
      .single();

    if (error) throw error;

    return {
      ...data,
      userId: data.user_id,
      createdAt: formatDate(data.created_at),
      updatedAt: formatDate(data.updated_at),
      created_at: formatDate(data.created_at),
      updated_at: formatDate(data.updated_at)
    };
  } catch (error) {
    console.error('[updateProject] Error:', error);
    throw error;
  }
}

/**
 * Delete a project - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @returns {Promise<object|null>} - Deleted project or null
 */
export async function deleteProject(projectId, userId) {
  try {
    const supabase = getClient(userId);

    // First get the project to return it
    const { data: project, error: getError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();

    if (getError || !project) {
      return null;
    }

    // Delete the project
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (deleteError) throw deleteError;

    // Update user's project count (admin operation)
    const adminClient = getSupabaseAdmin();
    const { count } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true });

    await adminClient
      .from('users')
      .update({ project_count: count || 0 })
      .eq('id', userId);

    return project;
  } catch (error) {
    console.error('[deleteProject] Error:', error);
    throw error;
  }
}

// ============================================================================
// CHAT HISTORY OPERATIONS (RLS enforced)
// ============================================================================

/**
 * Get chat history for a project - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} - Chat messages
 */
export async function getChatHistory(projectId, userId) {
  try {
    const supabase = getClient(userId);

    const { data, error } = await supabase
      .from('project_chat_history')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at,
      created_at: row.created_at,
      codeGenerated: row.code_generated,
      modifiedFiles: row.modified_files,
      attachments: row.attachments,
      tool_calls: row.tool_calls,
      tool_results: row.tool_results
    }));
  } catch (error) {
    console.error('[getChatHistory] Error:', error);
    throw error;
  }
}

/**
 * Save chat history - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @param {Array|object} messages - Messages to save
 * @returns {Promise<boolean>} - Success status
 */
export async function saveChatHistory(projectId, userId, messages) {
  try {
    const supabase = getClient(userId);
    const messagesToSave = Array.isArray(messages) ? messages : [messages];

    // Get existing messages to avoid duplicates
    const { data: existingMessages } = await supabase
      .from('project_chat_history')
      .select('created_at, role, content')
      .eq('project_id', projectId);

    const existingSet = new Set(
      (existingMessages || []).map(msg =>
        `${new Date(msg.created_at).toISOString()}-${msg.role}-${(msg.content || '').substring(0, 50)}`
      )
    );

    const records = messagesToSave
      .filter(message => {
        const messageKey = `${message.timestamp ? formatDate(message.timestamp) : new Date().toISOString()}-${message.role}-${(message.content || '').substring(0, 50)}`;
        return !existingSet.has(messageKey);
      })
      .map(message => ({
        id: uuidv4(),
        project_id: projectId,
        user_id: userId,
        role: message.role || 'assistant',
        content: typeof message === 'string' ? message : message.content,
        code_generated: message.codeGenerated || false,
        modified_files: message.modifiedFiles || [],
        attachments: message.attachments || [],
        tool_calls: message.tool_calls || null,
        tool_results: message.tool_results || null,
        created_at: message.timestamp ? formatDate(message.timestamp) : new Date().toISOString()
      }));

    if (records.length > 0) {
      const { error } = await supabase
        .from('project_chat_history')
        .insert(records);

      if (error) throw error;
    }

    return true;
  } catch (error) {
    console.error('[saveChatHistory] Error:', error);
    throw error;
  }
}

/**
 * Delete chat history - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteChatHistory(projectId, userId) {
  try {
    const supabase = getClient(userId);

    const { error } = await supabase
      .from('project_chat_history')
      .delete()
      .eq('project_id', projectId);

    if (error) throw error;

    return true;
  } catch (error) {
    console.error('[deleteChatHistory] Error:', error);
    throw error;
  }
}

// ============================================================================
// PROJECT VERSIONS (RLS enforced)
// ============================================================================

/**
 * Get project versions - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @param {number} limit - Maximum versions to return
 * @returns {Promise<Array>} - Versions
 */
export async function getProjectVersions(projectId, userId, limit = 20) {
  try {
    const supabase = getClient(userId);

    const { data, error } = await supabase
      .from('project_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getProjectVersions] Error:', error);
    return [];
  }
}

/**
 * Save project version - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @param {object} files - Files snapshot
 * @param {string} changeType - Type of change
 * @returns {Promise<object|null>} - Created version
 */
export async function saveProjectVersion(projectId, userId, files, changeType = 'manual_save') {
  try {
    const supabase = getClient(userId);

    const versionId = uuidv4();
    const { data, error } = await supabase
      .from('project_versions')
      .insert({
        id: versionId,
        project_id: projectId,
        user_id: userId,
        files: files,
        change_type: changeType,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Clean up old versions (keep last 50)
    const { data: versions } = await supabase
      .from('project_versions')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(50, 999);

    if (versions && versions.length > 0) {
      const idsToDelete = versions.map(v => v.id);
      await supabase
        .from('project_versions')
        .delete()
        .in('id', idsToDelete);
    }

    return data;
  } catch (error) {
    console.error('[saveProjectVersion] Error:', error);
    return null;
  }
}

// ============================================================================
// DEPLOYMENTS (RLS enforced)
// ============================================================================

/**
 * Get project deployments - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} - Deployments
 */
export async function getProjectDeployments(projectId, userId) {
  try {
    const supabase = getClient(userId);
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getProjectDeployments] Error:', error);
    return [];
  }
}

/**
 * Save deployment - RLS enforced
 *
 * @param {string} projectId - The project ID
 * @param {string} userId - The user's ID
 * @param {object} deploymentData - Deployment data
 * @returns {Promise<object>} - Created deployment
 */
export async function saveDeployment(projectId, userId, deploymentData) {
  try {
    const supabase = getClient(userId);

    const deploymentId = uuidv4();
    const { data, error } = await supabase
      .from('deployments')
      .insert({
        id: deploymentId,
        project_id: projectId,
        user_id: userId,
        subdomain: deploymentData.subdomain,
        platform: deploymentData.platform || 'ezcoder',
        deployment_url: deploymentData.url,
        status: deploymentData.status || 'active',
        files: deploymentData.files || {},
        metadata: deploymentData.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[saveDeployment] Error:', error);
    throw error;
  }
}

// ============================================================================
// SYSTEM OPERATIONS (Admin only - RLS bypassed intentionally)
// These operations require service_role access
// ============================================================================

/**
 * Create or update user - ADMIN ONLY
 * Used during login/signup - must access all users
 *
 * @param {object} userData - User data
 * @returns {Promise<object>} - Created/updated user
 */
export async function createOrUpdateUser(userData) {
  // This operation requires admin access - users can't create themselves
  const { createOrUpdateUser: adminCreateOrUpdateUser } = await import('./supabase-database.js');
  return adminCreateOrUpdateUser(userData);
}

/**
 * Get user by email - ADMIN ONLY
 * Used during login - must search across all users
 *
 * @param {string} email - User email
 * @returns {Promise<object|null>} - User data
 */
export async function getUserByEmail(email) {
  // This operation requires admin access - for login flows
  const { getUserByEmail: adminGetUserByEmail } = await import('./supabase-database.js');
  return adminGetUserByEmail(email);
}

/**
 * Update user subscription - ADMIN ONLY
 * Called by Stripe webhooks - system operation
 *
 * @param {string} userId - User ID
 * @param {object} subscriptionData - Subscription data
 * @returns {Promise<object>} - Updated user
 */
export async function updateUserSubscription(userId, subscriptionData) {
  // This operation requires admin access - for Stripe webhook processing
  const { updateUserSubscription: adminUpdateSubscription } = await import('./supabase-database.js');
  return adminUpdateSubscription(userId, subscriptionData);
}

/**
 * Log AI usage - ADMIN ONLY
 * System operation for usage tracking
 *
 * @param {string} userId - User ID
 * @param {string} projectId - Project ID
 * @param {object} details - Usage details
 * @returns {Promise<boolean>} - Success status
 */
export async function logAIUsage(userId, projectId, details = {}) {
  // This operation requires admin access - for internal tracking
  const { logAIUsage: adminLogAIUsage } = await import('./supabase-database.js');
  return adminLogAIUsage(userId, projectId, details);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  getClient,
  formatDate
};
