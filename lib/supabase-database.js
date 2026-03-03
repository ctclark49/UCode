// lib/supabase-database.js
import { getSupabaseAdmin } from './supabase.js';
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

// User functions
export async function createOrUpdateUser(userData) {
  try {
    const supabase = getSupabaseAdmin();
    const { email, name, provider = 'email' } = userData;

    // Check if user exists
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser && !selectError) {
      // Update existing user
      const { data, error } = await supabase
        .from('users')
        .update({
          name,
          provider,
          last_login_at: new Date().toISOString()
        })
        .eq('email', email.toLowerCase())
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      // Create new user with VARCHAR ID
      const userId = uuidv4();
      const { data, error } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: email.toLowerCase(),
          name,
          provider,
          subscription_tier: 'starter',
          subscription_status: 'active',
          usage_limit: 3,
          daily_usage_count: 0,
          project_count: 0,
          total_generations: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error('Error creating/updating user:', error);
    throw error;
  }
}

export async function getUserByEmail(email) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getUserByEmail] Error:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('[getUserByEmail] Error getting user by email:', error);
    return null;
  }
}

export async function getUserById(userId) {
  try {
    const supabase = getSupabaseAdmin();
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

export async function getUserUsageStats(userId) {
  try {
    const supabase = getSupabaseAdmin();

    // Import token manager V2 (the current production token system)
    const { tokenManagerV2 } = await import('./tokens-v2.js');

    // Get both old stats and new credit info
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
      console.log('[getUserUsageStats] User not found');
      throw new Error('User not found');
    }

    // Get token information using tokens-v2 for consistency
    let tokensInfo = null;
    let creditsInfo = null;
    try {
      tokensInfo = await tokenManagerV2.getUserTokens(userId);
      // Convert tokens to credits format for backward compatibility
      const tokenPrice = 0.10; // $0.10 per 1K tokens
      creditsInfo = {
        balance: (tokensInfo.additionalTokens / 1000) * tokenPrice,
        freeCredits: (tokensInfo.monthlyTokens / 1000) * tokenPrice,
        totalAvailable: (tokensInfo.totalAvailable / 1000) * tokenPrice,
        subscription: tokensInfo.subscription
      };
    } catch (tokenError) {
      console.warn('[getUserUsageStats] Could not get token info:', tokenError);
      // Fall back to basic credit info from user record for backward compatibility
      creditsInfo = {
        balance: user.credit_balance || 0,
        freeCredits: Math.max(0, (user.free_credits_monthly || 10) - (user.free_credits_used || 0)),
        totalAvailable: (user.credit_balance || 0) + Math.max(0, (user.free_credits_monthly || 10) - (user.free_credits_used || 0)),
        subscription: user.subscription_tier
      };
      // Create tokensInfo from creditsInfo fallback
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

    // Return both old format (for compatibility) and new credit info
    return {
      ...user,
      is_daily: false, // Changed to false since we're using credits now
      skip_usage_check,
      usage_count: user.daily_usage_count || 0,
      remaining: user.usage_limit === -1 ? 'unlimited' : Math.max(0, user.usage_limit - (user.daily_usage_count || 0)),
      // Add credit information for backward compatibility
      credits: creditsInfo,
      creditsAvailable: creditsInfo.totalAvailable,
      creditBalance: creditsInfo.balance,
      freeCredits: creditsInfo.freeCredits,
      // Add token information - pass through directly from tokenManager
      tokens: tokensInfo
    };
  } catch (error) {
    console.error('[getUserUsageStats] Error getting user usage stats:', error);
    throw error;
  }
}

// Project functions
export async function getUserProjects(userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    // Ensure dates are properly formatted and map to expected structure
    const projects = (data || []).map(project => ({
      ...project,
      // Map snake_case to camelCase for compatibility
      userId: project.user_id,
      createdAt: formatDate(project.created_at),
      updatedAt: formatDate(project.updated_at),
      // Keep snake_case versions too
      created_at: formatDate(project.created_at),
      updated_at: formatDate(project.updated_at)
    }));

    return projects;
  } catch (error) {
    console.error('Error getting user projects:', error);
    throw error;
  }
}

export async function getProject(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    console.log(`[getProject] Looking for project ${projectId} owned by user ${userId}`);

    // Normalize the IDs to ensure proper comparison
    const normalizedProjectId = projectId.toString().trim();
    const normalizedUserId = userId.toString().trim();

    // First, try exact match
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', normalizedProjectId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[getProject] Error:', error);
      throw error;
    }

    if (data) {
      console.log('[getProject] Found project:', data.name);
      // Map to expected structure
      return {
        ...data,
        userId: data.user_id,
        createdAt: formatDate(data.created_at),
        updatedAt: formatDate(data.updated_at),
        created_at: formatDate(data.created_at),
        updated_at: formatDate(data.updated_at)
      };
    }

    // If not found, try with case-insensitive search as a fallback
    console.log('[getProject] No exact match found, trying case-insensitive search...');

    const { data: allProjects, error: listError } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', normalizedUserId);

    if (listError) {
      console.error('[getProject] Error listing projects:', listError);
      throw listError;
    }

    // Find project with matching ID (case-insensitive)
    const foundProject = allProjects?.find(p =>
      p.id.toString().toLowerCase() === normalizedProjectId.toLowerCase()
    );

    if (foundProject) {
      console.log('[getProject] Found project via case-insensitive match:', foundProject.name);
      return {
        ...foundProject,
        userId: foundProject.user_id,
        createdAt: formatDate(foundProject.created_at),
        updatedAt: formatDate(foundProject.updated_at),
        created_at: formatDate(foundProject.created_at),
        updated_at: formatDate(foundProject.updated_at)
      };
    }

    console.log('[getProject] No project found');
    return null;
  } catch (error) {
    console.error('[getProject] Error getting project:', error);
    throw error;
  }
}

export async function createProject(userId, projectData) {
  try {
    const supabase = getSupabaseAdmin();

    // Check user's project limit
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('subscription_tier, project_count')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get actual project count
    const { count, error: countError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) throw countError;

    const projectLimit = user.subscription_tier === 'starter' ? 3 : -1;

    if (projectLimit !== -1 && count >= projectLimit) {
      throw new Error('Project limit reached. Upgrade to create more projects.');
    }

    // Create the project with VARCHAR ID and proper timestamps
    // Two-Phase Initialization: scaffolds_initialized defaults to false
    // unless project was created with a prompt that triggered scaffold detection
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
        updated_at: now,
        // Two-Phase Scaffold Initialization fields
        scaffolds_initialized: projectData.scaffolds_initialized ?? false,
        scaffold_metadata: projectData.scaffold_metadata ?? null
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Update user's project count
    await supabase
      .from('users')
      .update({ project_count: count + 1 })
      .eq('id', userId);

    // Auto-provision platform token for API integrations
    let platformToken = null;
    try {
      const { createProjectToken } = await import('./project-auth.js');
      const tokenResult = await createProjectToken(projectId);
      platformToken = tokenResult.token;
    } catch (tokenError) {
      // Don't fail project creation if token provisioning fails
      console.warn('[createProject] Failed to provision platform token:', tokenError.message);
    }

    // Return with mapped fields
    return {
      ...project,
      userId: project.user_id,
      createdAt: formatDate(project.created_at),
      updatedAt: formatDate(project.updated_at),
      created_at: formatDate(project.created_at),
      updated_at: formatDate(project.updated_at),
      platformToken  // Only present on initial creation
    };
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
}

export async function duplicateProject(projectId, userId, newName) {
  try {
    const supabase = getSupabaseAdmin();

    // First, get the original project
    const { data: originalProject, error: fetchError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (fetchError || !originalProject) {
      throw new Error('Project not found');
    }

    // Verify user owns the project or has access
    if (originalProject.user_id !== userId) {
      throw new Error('Project not found');
    }

    // Check user's project limit
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('subscription_tier, project_count')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get actual project count
    const { count, error: countError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) throw countError;

    const projectLimit = user.subscription_tier === 'starter' ? 3 : -1;

    if (projectLimit !== -1 && count >= projectLimit) {
      throw new Error('Project limit reached. Upgrade to create more projects.');
    }

    // Create the duplicate project
    const newProjectId = uuidv4();
    const now = new Date().toISOString();
    const duplicateName = newName || `${originalProject.name} (Copy)`;

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        id: newProjectId,
        user_id: userId,
        name: duplicateName,
        description: originalProject.description || '',
        files: originalProject.files || {},
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Update user's project count
    await supabase
      .from('users')
      .update({ project_count: count + 1 })
      .eq('id', userId);

    console.log(`[duplicateProject] Duplicated project ${projectId} as ${newProjectId}`);

    return {
      ...project,
      userId: project.user_id,
      createdAt: formatDate(project.created_at),
      updatedAt: formatDate(project.updated_at),
      created_at: formatDate(project.created_at),
      updated_at: formatDate(project.updated_at)
    };
  } catch (error) {
    console.error('Error duplicating project:', error);
    throw error;
  }
}

export async function updateProject(projectId, userId, projectData) {
  try {
    const supabase = getSupabaseAdmin();

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (projectData.name !== undefined) updateData.name = projectData.name;
    if (projectData.description !== undefined) updateData.description = projectData.description;
    if (projectData.files !== undefined) updateData.files = projectData.files;
    if (projectData.deployment_status !== undefined) updateData.deployment_status = projectData.deployment_status;
    if (projectData.deployed_url !== undefined) updateData.deployed_url = projectData.deployed_url;
    if (projectData.subdomain !== undefined) updateData.subdomain = projectData.subdomain;
    // Session context for persistent session resumability
    if (projectData.session_context !== undefined) updateData.session_context = projectData.session_context;
    // Thumbnail URL for project screenshots
    if (projectData.thumbnail_url !== undefined) {
      updateData.thumbnail_url = projectData.thumbnail_url;
      updateData.thumbnail_updated_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      // PGRST116 = no rows returned (project not found or not owned by user)
      if (error.code === 'PGRST116') {
        console.error(`[updateProject] Project not found or not owned by user - projectId: ${projectId}, userId: ${userId}`);
        throw new Error(`Project ${projectId} not found or access denied`);
      }
      throw error;
    }

    // Explicit check for null/undefined data (should not happen if no error, but defensive)
    if (!data) {
      console.error(`[updateProject] Update returned no data - projectId: ${projectId}, userId: ${userId}`);
      throw new Error(`Failed to update project ${projectId}: no data returned`);
    }

    // Return with mapped fields
    return {
      ...data,
      userId: data.user_id,
      createdAt: formatDate(data.created_at),
      updatedAt: formatDate(data.updated_at),
      created_at: formatDate(data.created_at),
      updated_at: formatDate(data.updated_at)
    };
  } catch (error) {
    console.error('[updateProject] Error:', error.message, { projectId, userId });
    throw error;
  }
}

export async function deleteProject(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();

    console.log(`[deleteProject] Attempting to delete project ${projectId} for user ${userId}`);

    // Try using the SQL function first
    try {
      const { data, error } = await supabase
        .rpc('delete_project_safe', {
          p_project_id: projectId,
          p_user_id: userId
        });

      if (!error && data && data.success) {
        console.log('[deleteProject] Successfully deleted using SQL function');
        return data.project;
      }
    } catch (funcError) {
      console.log('[deleteProject] SQL function not available, using direct method');
    }

    // Fallback to direct deletion
    // First verify the project exists and user owns it
    const { data: projects, error: checkError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId);

    if (checkError) {
      console.error('[deleteProject] Error checking project:', checkError);
      throw checkError;
    }

    if (!projects || projects.length === 0) {
      console.log('[deleteProject] Project not found or not authorized');
      return null;
    }

    const project = projects[0];
    console.log('[deleteProject] Found project:', project.name);

    // Delete the project
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[deleteProject] Error deleting project:', deleteError);
      throw deleteError;
    }

    console.log('[deleteProject] Project deleted successfully');

    // Update user's project count
    const { count } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    await supabase
      .from('users')
      .update({ project_count: count || 0 })
      .eq('id', userId);

    return project;
  } catch (error) {
    console.error('[deleteProject] Error:', error);
    throw error;
  }
}

// Version control functions
export async function saveProjectVersion(projectId, userId, files, changeType = 'manual_save') {
  try {
    const supabase = getSupabaseAdmin();

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
    console.error('Error saving project version:', error);
    return null;
  }
}

export async function getProjectVersions(projectId, userId, limit = 20) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('project_versions')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting project versions:', error);
    return [];
  }
}

// Chat history functions
// Industry best practice: Persist complete AI context for seamless session resumption
export async function saveChatHistory(projectId, userId, messages) {
  try {
    const supabase = getSupabaseAdmin();
    const messagesToSave = Array.isArray(messages) ? messages : [messages];

    // Get existing messages for deduplication using message_id (preferred) or content signature
    const { data: existingMessages } = await supabase
      .from('project_chat_history')
      .select('id, message_id, role, content, sequence_num')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('sequence_num', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(200);

    // Track existing message_ids for idempotent saves
    const existingMessageIds = new Set(
      (existingMessages || [])
        .filter(msg => msg.message_id)
        .map(msg => msg.message_id)
    );

    // Fallback: content signatures for messages without message_id
    const existingSignatures = new Set(
      (existingMessages || []).map(msg =>
        `${msg.role}:${(msg.content || '').substring(0, 100)}`
      )
    );

    // Get the current max sequence number
    const maxSequence = existingMessages?.[0]?.sequence_num || 0;
    let nextSequence = maxSequence + 1;

    // Filter out duplicates and prepare records with full context
    const records = messagesToSave
      .filter(message => {
        // Primary dedup: by message_id (frontend-generated UUID)
        const msgId = message.id || message.message_id;
        if (msgId && existingMessageIds.has(msgId)) {
          return false; // Already saved
        }

        // Secondary dedup: by content signature (fallback for older messages)
        const content = typeof message === 'string' ? message : message.content;
        const role = message.role || 'assistant';
        const signature = `${role}:${(content || '').substring(0, 100)}`;
        if (existingSignatures.has(signature)) {
          return false;
        }

        // Track to prevent duplicates within batch
        if (msgId) existingMessageIds.add(msgId);
        existingSignatures.add(signature);
        return true;
      })
      .map((message, index) => {
        const content = typeof message === 'string' ? message : message.content;

        // Serialize tool data if present (critical for AI context)
        const toolCalls = message.toolCalls || message.tool_calls;
        const toolResults = message.toolResults || message.tool_results;
        const contentParts = message.contentParts || message.content_parts;

        return {
          // CRITICAL: Explicitly generate UUID for id column
          // Supabase tables often require UUID primary key, unlike SERIAL in original schema
          id: uuidv4(),
          project_id: projectId,
          user_id: userId,
          message_id: message.id || message.message_id || null,
          sequence_num: nextSequence + index,
          role: message.role || 'assistant',
          content: content,
          // Tool execution context - essential for AI to understand what was done
          tool_calls: typeof toolCalls === 'string' ? toolCalls : (toolCalls ? JSON.stringify(toolCalls) : null),
          tool_results: typeof toolResults === 'string' ? toolResults : (toolResults ? JSON.stringify(toolResults) : null),
          // Sequential content parts for proper rendering
          content_parts: typeof contentParts === 'string' ? contentParts : (contentParts ? JSON.stringify(contentParts) : null),
          // Other metadata
          code_generated: message.codeGenerated || message.code_generated || false,
          modified_files: message.modifiedFiles || message.modified_files || [],
          attachments: message.attachments || [],
          created_at: message.timestamp ? formatDate(message.timestamp) : new Date().toISOString()
        };
      });

    if (records.length > 0) {
      const { error } = await supabase
        .from('project_chat_history')
        .insert(records);

      if (error) {
        // Handle duplicate key gracefully
        if (error.code === '23505') {
          console.log('[ChatHistory] Some messages already existed, skipping duplicates');
        } else {
          throw error;
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error saving chat history:', error);
    throw error;
  }
}

export async function getChatHistory(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();

    // Load complete context including tool execution history
    // Order by sequence_num for guaranteed ordering, fallback to created_at/id
    const { data, error } = await supabase
      .from('project_chat_history')
      .select(`
        id, message_id, sequence_num, role, content,
        tool_calls, tool_results, content_parts,
        code_generated, modified_files, attachments, created_at
      `)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('sequence_num', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(500);

    if (error) throw error;

    return (data || []).map(row => ({
      // Use message_id if available, otherwise database id
      id: row.message_id || row.id,
      role: row.role,
      content: row.content,
      // Tool execution context - critical for AI continuity
      tool_calls: row.tool_calls,
      tool_results: row.tool_results,
      // Sequential content parts for proper rendering
      content_parts: row.content_parts,
      // Metadata
      timestamp: row.created_at,
      created_at: row.created_at,
      sequence_num: row.sequence_num,
      codeGenerated: row.code_generated,
      modifiedFiles: row.modified_files,
      attachments: row.attachments
    }));
  } catch (error) {
    console.error('Error getting chat history:', error);
    throw error;
  }
}

// Delete chat history
export async function deleteChatHistory(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('project_chat_history')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);

    if (error) throw error;

    return true;
  } catch (error) {
    console.error('Error deleting chat history:', error);
    throw error;
  }
}

// Usage tracking
export async function logAIUsage(userId, projectId, details = {}) {
  try {
    const supabase = getSupabaseAdmin();

    // Log the usage with VARCHAR ID
    const { error: logError } = await supabase
      .from('usage_log')
      .insert({
        id: uuidv4(),
        user_id: userId,
        project_id: projectId,
        action_type: 'ai_generation',
        details: details,
        created_at: new Date().toISOString()
      });

    if (logError) throw logError;

    // Update user's usage counts
    const { data: user } = await supabase
      .from('users')
      .select('subscription_tier')
      .eq('id', userId)
      .single();

    if (user && user.subscription_tier !== 'business') {
      await supabase.rpc('increment', {
        table_name: 'users',
        row_id: userId,
        column_name: 'daily_usage_count'
      });

      await supabase.rpc('increment', {
        table_name: 'users',
        row_id: userId,
        column_name: 'total_generations'
      });
    }

    return true;
  } catch (error) {
    console.error('Error logging AI usage:', error);
    throw error;
  }
}

// Subscription management
export async function updateUserSubscription(userId, subscriptionData) {
  try {
    const supabase = getSupabaseAdmin();
    const { tier, status, stripeCustomerId } = subscriptionData;

    const limits = {
      'starter': { usage_limit: 3 },
      'creator': { usage_limit: 50 },
      'business': { usage_limit: -1 }
    };

    const tierLimits = limits[tier] || limits['starter'];

    const updateData = {
      updated_at: new Date().toISOString()
    };
    if (tier !== undefined) {
      updateData.subscription_tier = tier;
      updateData.usage_limit = tierLimits.usage_limit;
    }
    if (status !== undefined) updateData.subscription_status = status;
    if (stripeCustomerId !== undefined) updateData.stripe_customer_id = stripeCustomerId;

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

// Deployment functions
export async function saveDeployment(projectId, userId, deploymentData) {
  try {
    const supabase = getSupabaseAdmin();

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
    console.error('Error saving deployment:', error);
    throw error;
  }
}

// ===========================================
// NEW ADS SUITE FUNCTIONS
// ===========================================

// Ad Account Management
// Import token encryption for secure token storage
import tokenEncryption from './services/token-encryption.js';

export async function saveAdAccount(userId, accountData) {
  try {
    const supabase = getSupabaseAdmin();
    const accountId = uuidv4();

    // Encrypt tokens before storing
    let encryptedData = {};
    if (accountData.accessToken || accountData.refreshToken) {
      try {
        encryptedData = await tokenEncryption.encryptAccountCredentials({
          accessToken: accountData.accessToken,
          refreshToken: accountData.refreshToken
        }, userId);
      } catch (encryptError) {
        console.error('Token encryption failed, storing unencrypted:', encryptError.message);
        encryptedData = {
          access_token: accountData.accessToken,
          refresh_token: accountData.refreshToken,
          access_token_encrypted: false,
          refresh_token_encrypted: false
        };
      }
    }

    const { data, error } = await supabase
      .from('ad_accounts')
      .insert({
        id: accountId,
        user_id: userId,
        platform: accountData.platform,
        account_id: accountData.accountId,
        account_name: accountData.accountName,
        access_token: encryptedData.access_token || accountData.accessToken,
        refresh_token: encryptedData.refresh_token || accountData.refreshToken,
        access_token_encrypted: encryptedData.access_token_encrypted || false,
        refresh_token_encrypted: encryptedData.refresh_token_encrypted || false,
        token_expires_at: accountData.tokenExpiresAt,
        status: 'active',
        metadata: accountData.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving ad account:', error);
    throw error;
  }
}

export async function updateAdAccount(accountId, userId, updateData) {
  try {
    const supabase = getSupabaseAdmin();

    const updates = {
      updated_at: new Date().toISOString()
    };

    // Encrypt tokens if being updated
    if (updateData.accessToken || updateData.refreshToken) {
      try {
        const encryptedData = await tokenEncryption.encryptAccountCredentials({
          accessToken: updateData.accessToken,
          refreshToken: updateData.refreshToken
        }, userId);

        if (updateData.accessToken) {
          updates.access_token = encryptedData.access_token;
          updates.access_token_encrypted = true;
        }
        if (updateData.refreshToken) {
          updates.refresh_token = encryptedData.refresh_token;
          updates.refresh_token_encrypted = true;
        }
      } catch (encryptError) {
        console.error('Token encryption failed during update:', encryptError.message);
        if (updateData.accessToken) updates.access_token = updateData.accessToken;
        if (updateData.refreshToken) updates.refresh_token = updateData.refreshToken;
      }
    }

    if (updateData.tokenExpiresAt) updates.token_expires_at = updateData.tokenExpiresAt;
    if (updateData.status) updates.status = updateData.status;
    if (updateData.metadata) updates.metadata = updateData.metadata;
    if (updateData.lastRefreshed) updates.last_refreshed = updateData.lastRefreshed;

    const { data, error } = await supabase
      .from('ad_accounts')
      .update(updates)
      .eq('id', accountId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating ad account:', error);
    throw error;
  }
}

export async function getAdAccounts(userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting ad accounts:', error);
    return [];
  }
}

export async function getAdAccount(accountId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('ad_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting ad account:', error);
    return null;
  }
}

export async function deleteAdAccount(accountId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('ad_accounts')
      .delete()
      .eq('id', accountId)
      .eq('user_id', userId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting ad account:', error);
    throw error;
  }
}

// Campaign Management
export async function createAdCampaign(campaignData) {
  try {
    const supabase = getSupabaseAdmin();
    const campaignId = uuidv4();

    const { data, error } = await supabase
      .from('ad_campaigns')
      .insert({
        id: campaignId,
        project_id: campaignData.project_id,
        user_id: campaignData.user_id,
        ad_account_id: campaignData.account_id,
        platform: campaignData.platform,
        external_campaign_id: campaignData.external_campaign_id,
        name: campaignData.name,
        objective: campaignData.objective,
        budget: campaignData.budget,
        targeting: campaignData.targeting,
        ads: campaignData.ads,
        landing_url: campaignData.landing_url,
        status: campaignData.status || 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating campaign:', error);
    throw error;
  }
}

export async function updateAdCampaign(campaignId, userId, updateData) {
  try {
    const supabase = getSupabaseAdmin();

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (updateData.name) updates.name = updateData.name;
    if (updateData.status) updates.status = updateData.status;
    if (updateData.budget) updates.budget = updateData.budget;
    if (updateData.targeting) updates.targeting = updateData.targeting;
    if (updateData.ads) updates.ads = updateData.ads;
    if (updateData.external_campaign_id) updates.external_campaign_id = updateData.external_campaign_id;
    if (updateData.performance_data) updates.performance_data = updateData.performance_data;

    const { data, error } = await supabase
      .from('ad_campaigns')
      .update(updates)
      .eq('id', campaignId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating campaign:', error);
    throw error;
  }
}

export async function getAdCampaigns(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('ad_campaigns')
      .select(`
        *,
        ad_accounts!inner(account_name, platform)
      `)
      .eq('user_id', userId);

    if (projectId && projectId !== 'all') {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting campaigns:', error);
    return [];
  }
}

export async function getAdCampaign(campaignId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('ad_campaigns')
      .select(`
        *,
        ad_accounts!inner(account_name, platform)
      `)
      .eq('id', campaignId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting campaign:', error);
    return null;
  }
}

export async function deleteAdCampaign(campaignId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('ad_campaigns')
      .delete()
      .eq('id', campaignId)
      .eq('user_id', userId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting campaign:', error);
    throw error;
  }
}

// Analytics and Performance
export async function saveAdMetrics(campaignId, metrics) {
  try {
    const supabase = getSupabaseAdmin();
    const metricId = uuidv4();

    const { data, error } = await supabase
      .from('ad_metrics')
      .upsert({
        id: metricId,
        campaign_id: campaignId,
        date: metrics.date || new Date().toISOString().split('T')[0],
        impressions: metrics.impressions || 0,
        clicks: metrics.clicks || 0,
        spend: metrics.spend || 0,
        conversions: metrics.conversions || 0,
        ctr: metrics.clicks && metrics.impressions ? (metrics.clicks / metrics.impressions) * 100 : 0,
        cpc: metrics.clicks && metrics.spend ? metrics.spend / metrics.clicks : 0,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'campaign_id,date'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving ad metrics:', error);
    throw error;
  }
}

export async function getAdAnalytics(filters) {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase.from('ad_metrics').select(`
      *,
      ad_campaigns!inner(name, platform, budget)
    `);

    if (filters.projectId && filters.projectId !== 'all') {
      query = query.eq('ad_campaigns.project_id', filters.projectId);
    }
    if (filters.campaignId && filters.campaignId !== 'all') {
      query = query.eq('campaign_id', filters.campaignId);
    }
    if (filters.userId) {
      query = query.eq('ad_campaigns.user_id', filters.userId);
    }

    // Time range filter
    if (filters.timeRange) {
      const days = {
        '1d': 1,
        '7d': 7,
        '30d': 30,
        '90d': 90
      }[filters.timeRange] || 7;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      query = query.gte('date', startDate.toISOString().split('T')[0]);
    }

    const { data, error } = await query.order('date', { ascending: true });

    if (error) throw error;

    // Aggregate data
    const summary = {
      impressions: data.reduce((sum, m) => sum + (m.impressions || 0), 0),
      clicks: data.reduce((sum, m) => sum + (m.clicks || 0), 0),
      spend: data.reduce((sum, m) => sum + (m.spend || 0), 0),
      conversions: data.reduce((sum, m) => sum + (m.conversions || 0), 0),
    };

    summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
    summary.avgCpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;

    // Calculate changes (mock data for now)
    summary.impressionsChange = 12;
    summary.clicksChange = 8;
    summary.spendChange = -5;
    summary.conversionsChange = 15;
    summary.ctrChange = 3;
    summary.cpcChange = -10;

    return {
      daily: data,
      summary
    };
  } catch (error) {
    console.error('Error getting analytics:', error);
    throw error;
  }
}

export async function getAdMetricsByCampaign(campaignId, dateRange) {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('ad_metrics')
      .select('*')
      .eq('campaign_id', campaignId);

    if (dateRange) {
      query = query.gte('date', dateRange.start).lte('date', dateRange.end);
    }

    const { data, error } = await query.order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting campaign metrics:', error);
    return [];
  }
}

// AI Recommendations
export async function saveAdRecommendation(recommendationData) {
  try {
    const supabase = getSupabaseAdmin();
    const recommendationId = uuidv4();

    const { data, error } = await supabase
      .from('ad_recommendations')
      .insert({
        id: recommendationId,
        campaign_id: recommendationData.campaign_id,
        user_id: recommendationData.user_id,
        type: recommendationData.type,
        title: recommendationData.title,
        description: recommendationData.description,
        impact: recommendationData.impact,
        confidence: recommendationData.confidence,
        recommendation_data: recommendationData.data || {},
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving recommendation:', error);
    throw error;
  }
}

export async function getAdRecommendations(userId, filters = {}) {
  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('ad_recommendations')
      .select(`
        *,
        ad_campaigns!inner(name, platform)
      `)
      .eq('user_id', userId);

    if (filters.campaignId) {
      query = query.eq('campaign_id', filters.campaignId);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.type) {
      query = query.eq('type', filters.type);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting recommendations:', error);
    return [];
  }
}

export async function applyAdRecommendation(recommendationId, userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('ad_recommendations')
      .update({
        status: 'applied',
        applied_at: new Date().toISOString()
      })
      .eq('id', recommendationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error applying recommendation:', error);
    throw error;
  }
}

// Budget Management
export async function getAdBudgets(userId) {
  try {
    const supabase = getSupabaseAdmin();

    // Get all campaigns with their current spend
    const { data: campaigns, error } = await supabase
      .from('ad_campaigns')
      .select(`
        *,
        ad_metrics(spend, date)
      `)
      .eq('user_id', userId);

    if (error) throw error;

    // Calculate budget utilization
    const budgets = campaigns.map(campaign => {
      const today = new Date().toISOString().split('T')[0];
      const todaySpend = campaign.ad_metrics
        ?.filter(m => m.date === today)
        ?.reduce((sum, m) => sum + m.spend, 0) || 0;

      return {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        daily_budget: campaign.budget?.daily || 0,
        daily_spend: todaySpend,
        utilization: campaign.budget?.daily
          ? (todaySpend / campaign.budget.daily) * 100
          : 0
      };
    });

    // Generate alerts
    const alerts = budgets
      .filter(b => b.utilization > 80)
      .map(b => ({
        type: b.utilization > 100 ? 'overspend' : 'warning',
        campaign_name: b.campaign_name,
        message: b.utilization > 100
          ? `Campaign has exceeded daily budget by ${(b.utilization - 100).toFixed(0)}%`
          : `Campaign is at ${b.utilization.toFixed(0)}% of daily budget`
      }));

    return {
      budgets,
      alerts
    };
  } catch (error) {
    console.error('Error getting budgets:', error);
    throw error;
  }
}

export async function updateCampaignBudget(campaignId, userId, newBudget) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('ad_campaigns')
      .update({
        budget: { daily: newBudget },
        updated_at: new Date().toISOString()
      })
      .eq('id', campaignId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating budget:', error);
    throw error;
  }
}

// Platform-specific functions
export async function syncGoogleAdsData(accountId, userId) {
  try {
    const account = await getAdAccount(accountId, userId);
    if (!account || account.platform !== 'google') {
      throw new Error('Invalid Google Ads account');
    }

    // In production, this would use the Google Ads API
    // For now, return mock data
    return {
      campaigns: [],
      lastSync: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error syncing Google Ads:', error);
    throw error;
  }
}

export async function syncFacebookAdsData(accountId, userId) {
  try {
    const account = await getAdAccount(accountId, userId);
    if (!account || account.platform !== 'facebook') {
      throw new Error('Invalid Facebook Ads account');
    }

    // In production, this would use the Facebook Marketing API
    // For now, return mock data
    return {
      campaigns: [],
      lastSync: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error syncing Facebook Ads:', error);
    throw error;
  }
}

// Utility functions
export async function checkAndResetDailyUsage(userId) {
  // This functionality is handled in getUserUsageStats for Supabase
  const stats = await getUserUsageStats(userId);

  const limitReached = stats.usage_limit !== -1 && stats.daily_usage_count >= stats.usage_limit;

  if (limitReached) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      limitReached: true,
      stats: {
        ...stats,
        reset_time: tomorrow.toISOString(),
        message: `You've used all ${stats.usage_limit} of your daily AI generations. Limits reset at midnight.`
      }
    };
  }

  return {
    limitReached: false,
    stats
  };
}

export async function resetUserDailyUsage(userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('users')
      .update({
        daily_usage_count: 0,
        daily_usage_reset_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error resetting daily usage:', error);
    throw error;
  }
}

export async function getProjectVersion(versionId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('project_versions')
      .select(`
        *,
        projects!inner(name)
      `)
      .eq('id', versionId)
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (data) {
      return {
        ...data,
        project_name: data.projects?.name
      };
    }
    return null;
  } catch (error) {
    console.error('Error getting project version:', error);
    throw error;
  }
}

export async function saveProjectHistory(projectId, userId, files, changeType) {
  // Alias for saveProjectVersion
  return saveProjectVersion(projectId, userId, files, changeType);
}

export async function getProjectHistory(projectId, userId, limit) {
  // Alias for getProjectVersions
  return getProjectVersions(projectId, userId, limit);
}

export async function saveProjectIntegration(projectId, userId, integrationType, config) {
  try {
    const supabase = getSupabaseAdmin();

    const integrationId = uuidv4();
    // Upsert integration
    const { data, error } = await supabase
      .from('project_integrations')
      .upsert({
        id: integrationId,
        project_id: projectId,
        user_id: userId,
        integration_type: integrationType,
        config: config,
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'project_id,integration_type'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error saving integration:', error);
    throw error;
  }
}

export async function getProjectIntegration(projectId, userId, integrationType) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('project_integrations')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('integration_type', integrationType)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error getting integration:', error);
    throw error;
  }
}

export async function removeProjectIntegration(projectId, userId, integrationType) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('project_integrations')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('integration_type', integrationType);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error removing integration:', error);
    throw error;
  }
}

export async function getProjectDeployments(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error getting deployments:', error);
    throw error;
  }
}

export function createAutoSaveHandler(projectId, userId) {
  let saveTimeout = null;
  let lastSavedFiles = null;

  const save = async (files) => {
    try {
      const filesString = JSON.stringify(files);
      if (filesString === lastSavedFiles) {
        return { success: true, message: 'No changes to save' };
      }

      const result = await updateProject(projectId, userId, { files });
      if (result) {
        lastSavedFiles = filesString;
        return { success: true, message: 'Project auto-saved' };
      }
      return { success: false, message: 'Failed to save project' };
    } catch (error) {
      console.error('Auto-save error:', error);
      return { success: false, message: error.message };
    }
  };

  const scheduleAutoSave = (files) => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      save(files);
    }, 5000);
  };

  const forceSave = async (files) => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    return await save(files);
  };

  const cancelAutoSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
  };

  return {
    scheduleAutoSave,
    forceSave,
    cancelAutoSave
  };
}

export async function runDatabaseHealthCheck() {
  try {
    const supabase = getSupabaseAdmin();
    const tables = [
      'users',
      'projects',
      'project_chat_history',
      'project_versions',
      'project_integrations',
      'usage_log',
      'deployments',
      'ad_accounts',
      'ad_campaigns',
      'ad_metrics',
      'ad_recommendations'
    ];
    const results = {};

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        results[table] = { exists: !error, count: count || 0 };
      } catch (error) {
        results[table] = { exists: false, error: error.message };
      }
    }

    return {
      healthy: Object.values(results).every(r => r.exists),
      tables: results
    };
  } catch (error) {
    console.error('Database health check failed:', error);
    return {
      healthy: false,
      error: error.message
    };
  }
}

// Note: All functions are already exported at their definitions above
// No need for duplicate export block

// ===========================================
// SCAFFOLD INITIALIZATION FUNCTIONS (Two-Phase)
// ===========================================

/**
 * Check if project has had scaffold initialization
 * @param {string} projectId
 * @returns {Promise<{initialized: boolean, metadata: object|null}>}
 */
export async function getProjectScaffoldStatus(projectId) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('projects')
      .select('scaffolds_initialized, scaffold_metadata')
      .eq('id', projectId)
      .single();

    if (error) throw error;

    return {
      initialized: data?.scaffolds_initialized ?? false,
      metadata: data?.scaffold_metadata ?? null
    };
  } catch (error) {
    console.error('[getProjectScaffoldStatus] Error:', error);
    // Default to false so detection runs
    return { initialized: false, metadata: null };
  }
}

/**
 * Mark project scaffolds as initialized with metadata
 * Uses atomic update to prevent race conditions
 *
 * @param {string} projectId
 * @param {string} userId
 * @param {object} metadata - { detected: [], triggerPrompt, method, timestamp }
 * @returns {Promise<{success: boolean, alreadyInitialized: boolean}>}
 */
export async function markScaffoldsInitialized(projectId, userId, metadata) {
  try {
    const supabase = getSupabaseAdmin();

    // Atomic update: Only update if scaffolds_initialized is currently false
    // This prevents race conditions from concurrent requests
    const { data, error } = await supabase
      .from('projects')
      .update({
        scaffolds_initialized: true,
        scaffold_metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', projectId)
      .eq('user_id', userId)
      .eq('scaffolds_initialized', false)  // Only if not already initialized
      .select('id')
      .maybeSingle();

    if (error) throw error;

    // If data is null, it means the row didn't match (already initialized)
    return {
      success: true,
      alreadyInitialized: data === null
    };
  } catch (error) {
    console.error('[markScaffoldsInitialized] Error:', error);
    throw error;
  }
}

/**
 * Reset scaffold initialization for a project
 * Allows re-running scaffold detection
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function resetScaffoldInitialization(projectId, userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('projects')
      .update({
        scaffolds_initialized: false,
        scaffold_metadata: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', projectId)
      .eq('user_id', userId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[resetScaffoldInitialization] Error:', error);
    throw error;
  }
}

// ============================================
// API KEYS VAULT OPERATIONS
// ============================================

/**
 * Save an API key to the user's vault
 * @param {string} userId - User ID
 * @param {Object} keyData - { provider, keyName, encryptedKey, maskedKey, keyPrefix }
 * @returns {Promise<Object>} Saved key data (without encrypted key)
 */
export async function saveApiKey(userId, keyData) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('api_keys_vault')
      .upsert({
        user_id: userId,
        provider: keyData.provider,
        key_name: keyData.keyName || 'Default',
        encrypted_key: keyData.encryptedKey,
        key_encrypted: true,
        masked_key: keyData.maskedKey,
        key_prefix: keyData.keyPrefix,
        status: 'active',
        environment: keyData.environment || 'production',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,provider,key_name'
      })
      .select('id, provider, key_name, masked_key, key_prefix, status, environment, created_at, updated_at')
      .single();

    if (error) throw error;

    console.log(`[saveApiKey] Saved key for ${keyData.provider} for user ${userId}`);
    return data;
  } catch (error) {
    console.error('[saveApiKey] Error:', error);
    throw error;
  }
}

/**
 * Get all API keys for a user (masked, no encrypted values)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of API keys with masked values
 */
export async function getUserApiKeys(userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('api_keys_vault')
      .select('id, provider, key_name, masked_key, key_prefix, status, environment, last_used_at, usage_count, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('provider', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getUserApiKeys] Error:', error);
    return [];
  }
}

/**
 * Get a specific API key's encrypted value for decryption
 * @param {string} userId - User ID
 * @param {string} provider - Provider name (e.g., 'openai')
 * @param {string} keyName - Optional key name (defaults to 'Default')
 * @returns {Promise<Object|null>} Key data with encrypted_key for decryption
 */
export async function getApiKeyForDecryption(userId, provider, keyName = 'Default') {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('api_keys_vault')
      .select('id, encrypted_key, key_encrypted')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('key_name', keyName)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    // Update last_used_at
    if (data) {
      await supabase
        .from('api_keys_vault')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id);
    }

    return data;
  } catch (error) {
    console.error('[getApiKeyForDecryption] Error:', error);
    return null;
  }
}

/**
 * Check if user has an active BYOK key for a provider
 * @param {string} userId - User ID
 * @param {string} provider - Provider name
 * @returns {Promise<boolean>}
 */
export async function hasApiKey(userId, provider) {
  try {
    const supabase = getSupabaseAdmin();

    const { count, error } = await supabase
      .from('api_keys_vault')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('status', 'active');

    if (error) throw error;
    return count > 0;
  } catch (error) {
    console.error('[hasApiKey] Error:', error);
    return false;
  }
}

/**
 * Revoke/delete an API key
 * @param {string} userId - User ID
 * @param {string} keyId - Key UUID
 * @param {string} reason - Revocation reason
 * @returns {Promise<boolean>}
 */
export async function revokeApiKey(userId, keyId, reason = 'User revoked') {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('api_keys_vault')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', keyId)
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`[revokeApiKey] Revoked key ${keyId} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[revokeApiKey] Error:', error);
    return false;
  }
}

/**
 * Update API key error status (called after failed API calls)
 * @param {string} keyId - Key UUID
 * @param {string} errorMessage - Error message
 */
export async function updateApiKeyError(keyId, errorMessage) {
  try {
    const supabase = getSupabaseAdmin();

    await supabase
      .from('api_keys_vault')
      .update({
        last_error: errorMessage,
        last_error_at: new Date().toISOString()
      })
      .eq('id', keyId);
  } catch (error) {
    console.error('[updateApiKeyError] Error:', error);
  }
}

// ============================================
// SUPABASE CONNECTIONS OPERATIONS
// ============================================

/**
 * Save a Supabase OAuth connection
 * @param {string} userId - User ID
 * @param {Object} connectionData - Connection data with encrypted tokens
 * @returns {Promise<Object>} Saved connection (without tokens)
 */
export async function saveSupabaseConnection(userId, connectionData) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('supabase_connections')
      .upsert({
        user_id: userId,
        org_id: connectionData.orgId,
        org_name: connectionData.orgName,
        project_ref: connectionData.projectRef,
        project_name: connectionData.projectName,
        project_url: connectionData.projectUrl,
        access_token_encrypted: connectionData.accessTokenEncrypted,
        refresh_token_encrypted: connectionData.refreshTokenEncrypted,
        token_encrypted: true,
        expires_at: connectionData.expiresAt,
        scopes: connectionData.scopes || ['database.read', 'database.write', 'projects.read'],
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,org_id,project_ref'
      })
      .select('id, org_id, org_name, project_ref, project_name, project_url, scopes, status, expires_at, created_at')
      .single();

    if (error) throw error;

    console.log(`[saveSupabaseConnection] Saved connection to ${connectionData.projectRef} for user ${userId}`);
    return data;
  } catch (error) {
    console.error('[saveSupabaseConnection] Error:', error);
    throw error;
  }
}

/**
 * Get all Supabase connections for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of connections (without tokens)
 */
export async function getUserSupabaseConnections(userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('supabase_connections')
      .select('id, org_id, org_name, project_ref, project_name, project_url, scopes, status, expires_at, last_used_at, created_at')
      .eq('user_id', userId)
      .neq('status', 'revoked')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getUserSupabaseConnections] Error:', error);
    return [];
  }
}

/**
 * Get Supabase connection tokens for API calls
 * @param {string} userId - User ID
 * @param {string} connectionId - Connection UUID
 * @returns {Promise<Object|null>} Connection with encrypted tokens
 */
export async function getSupabaseConnectionForUse(userId, connectionId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('supabase_connections')
      .select('id, project_ref, project_url, access_token_encrypted, refresh_token_encrypted, token_encrypted, expires_at, status')
      .eq('id', connectionId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    // Update last_used_at
    if (data) {
      await supabase
        .from('supabase_connections')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id);
    }

    return data;
  } catch (error) {
    console.error('[getSupabaseConnectionForUse] Error:', error);
    return null;
  }
}

/**
 * Update Supabase connection tokens (after refresh)
 * @param {string} connectionId - Connection UUID
 * @param {Object} newTokens - New encrypted tokens
 * @returns {Promise<boolean>}
 */
export async function updateSupabaseConnectionTokens(connectionId, newTokens) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('supabase_connections')
      .update({
        access_token_encrypted: newTokens.accessTokenEncrypted,
        refresh_token_encrypted: newTokens.refreshTokenEncrypted,
        expires_at: newTokens.expiresAt,
        last_refresh_at: new Date().toISOString(),
        status: 'active',
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', connectionId);

    if (error) throw error;

    console.log(`[updateSupabaseConnectionTokens] Refreshed tokens for connection ${connectionId}`);
    return true;
  } catch (error) {
    console.error('[updateSupabaseConnectionTokens] Error:', error);
    return false;
  }
}

/**
 * Mark a Supabase connection as expired or error
 * @param {string} connectionId - Connection UUID
 * @param {string} status - New status (expired, error, revoked)
 * @param {string} errorMessage - Optional error message
 */
export async function updateSupabaseConnectionStatus(connectionId, status, errorMessage = null) {
  try {
    const supabase = getSupabaseAdmin();

    await supabase
      .from('supabase_connections')
      .update({
        status,
        last_error: errorMessage,
        updated_at: new Date().toISOString()
      })
      .eq('id', connectionId);
  } catch (error) {
    console.error('[updateSupabaseConnectionStatus] Error:', error);
  }
}

/**
 * Disconnect/revoke a Supabase connection
 * @param {string} userId - User ID
 * @param {string} connectionId - Connection UUID
 * @returns {Promise<boolean>}
 */
export async function disconnectSupabaseConnection(userId, connectionId) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('supabase_connections')
      .update({
        status: 'revoked',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', connectionId)
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`[disconnectSupabaseConnection] Disconnected ${connectionId} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[disconnectSupabaseConnection] Error:', error);
    return false;
  }
}

// ============================================
// API USAGE LOGGING
// ============================================

/**
 * Log an API usage event
 * @param {Object} usageData - Usage data
 * @returns {Promise<string>} Log ID
 */
export async function logApiUsage(usageData) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('api_usage_log')
      .insert({
        user_id: usageData.userId,
        project_id: usageData.projectId,
        provider: usageData.provider,
        endpoint: usageData.endpoint,
        model: usageData.model,
        input_tokens: usageData.inputTokens || 0,
        output_tokens: usageData.outputTokens || 0,
        units: usageData.units || 1,
        unit_type: usageData.unitType || 'tokens',
        raw_cost_usd: usageData.rawCostUsd,
        marked_up_cost_usd: usageData.markedUpCostUsd,
        tokens_charged: usageData.tokensCharged || 0,
        billing_method: usageData.billingMethod,
        api_key_id: usageData.apiKeyId,
        request_id: usageData.requestId,
        response_status: usageData.responseStatus || 200,
        latency_ms: usageData.latencyMs,
        error_message: usageData.errorMessage,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (error) {
    console.error('[logApiUsage] Error:', error);
    return null;
  }
}

/**
 * Get API usage summary for a user
 * @param {string} userId - User ID
 * @param {number} days - Number of days to look back (default 30)
 * @returns {Promise<Object>} Usage summary by provider
 */
export async function getApiUsageSummary(userId, days = 30) {
  try {
    const supabase = getSupabaseAdmin();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('api_usage_log')
      .select('provider, billing_method, input_tokens, output_tokens, marked_up_cost_usd, tokens_charged')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString());

    if (error) throw error;

    // Aggregate by provider
    const summary = {};
    for (const row of (data || [])) {
      if (!summary[row.provider]) {
        summary[row.provider] = {
          totalRequests: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          byokRequests: 0,
          proxiedRequests: 0,
          tokensCharged: 0
        };
      }
      summary[row.provider].totalRequests++;
      summary[row.provider].totalTokens += (row.input_tokens || 0) + (row.output_tokens || 0);
      summary[row.provider].totalCostUsd += parseFloat(row.marked_up_cost_usd || 0);
      summary[row.provider].tokensCharged += row.tokens_charged || 0;
      if (row.billing_method === 'byok') {
        summary[row.provider].byokRequests++;
      } else if (row.billing_method === 'tokens') {
        summary[row.provider].proxiedRequests++;
      }
    }

    return summary;
  } catch (error) {
    console.error('[getApiUsageSummary] Error:', error);
    return {};
  }
}

// ============================================
// SCHEMA AUDIT LOG OPERATIONS
// ============================================

/**
 * Log a schema change operation
 * @param {Object} auditData - Audit data
 * @returns {Promise<string>} Audit log ID
 */
export async function logSchemaChange(auditData) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('schema_audit_log')
      .insert({
        user_id: auditData.userId,
        project_id: auditData.projectId,
        connection_id: auditData.connectionId,
        operation_type: auditData.operationType,
        target_type: auditData.targetType,
        target_name: auditData.targetName,
        sql_statement: auditData.sqlStatement,
        ai_session_id: auditData.aiSessionId,
        ai_model: auditData.aiModel,
        user_prompt: auditData.userPrompt,
        status: auditData.status || 'pending',
        rollback_sql: auditData.rollbackSql,
        can_rollback: !!auditData.rollbackSql,
        pre_snapshot_id: auditData.preSnapshotId,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (error) {
    console.error('[logSchemaChange] Error:', error);
    return null;
  }
}

/**
 * Update schema change status after execution
 * @param {string} auditId - Audit log ID
 * @param {string} status - New status
 * @param {Object} details - Additional details (error_message, execution_time_ms)
 */
export async function updateSchemaChangeStatus(auditId, status, details = {}) {
  try {
    const supabase = getSupabaseAdmin();

    await supabase
      .from('schema_audit_log')
      .update({
        status,
        executed_at: status === 'executed' ? new Date().toISOString() : null,
        error_message: details.errorMessage,
        execution_time_ms: details.executionTimeMs
      })
      .eq('id', auditId);
  } catch (error) {
    console.error('[updateSchemaChangeStatus] Error:', error);
  }
}

/**
 * Get schema audit history for a connection
 * @param {string} userId - User ID
 * @param {string} connectionId - Connection UUID
 * @param {number} limit - Max records to return
 * @returns {Promise<Array>} Audit log entries
 */
export async function getSchemaAuditHistory(userId, connectionId, limit = 50) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('schema_audit_log')
      .select('*')
      .eq('user_id', userId)
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getSchemaAuditHistory] Error:', error);
    return [];
  }
}

// =============================================================================
// DATABASE CONNECTIONS (Supports Supabase and Neon via direct credentials)
// =============================================================================

/**
 * Get all database connections for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Database connections
 */
export async function getUserDatabaseConnections(userId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('database_connections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[getUserDatabaseConnections] Error:', error);
    return [];
  }
}

/**
 * Get a specific database connection
 * @param {string} userId - User ID
 * @param {string} connectionId - Connection UUID
 * @returns {Promise<object|null>} Database connection record
 */
export async function getDatabaseConnection(userId, connectionId) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('database_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[getDatabaseConnection] Error:', error);
    return null;
  }
}

/**
 * Create a new database connection
 * @param {object} connectionData - Connection details
 * @returns {Promise<object>} Created connection record
 */
export async function createDatabaseConnection(connectionData) {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('database_connections')
      .insert({
        user_id: connectionData.userId,
        provider: connectionData.provider,
        connection_method: connectionData.connectionMethod || 'direct',
        connection_name: connectionData.connectionName,
        connection_string_encrypted: connectionData.connectionStringEncrypted,
        encryption_iv: connectionData.encryptionIv,
        encryption_salt: connectionData.encryptionSalt,
        host: connectionData.host,
        database_name: connectionData.databaseName,
        project_ref: connectionData.projectRef,
        ezcoder_project_id: connectionData.ezcoderProjectId,
        status: 'active',
        last_verified_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[createDatabaseConnection] Error:', error);
    throw error;
  }
}

/**
 * Update database connection status
 * @param {string} connectionId - Connection UUID
 * @param {string} status - New status
 * @param {object} details - Additional details
 */
export async function updateDatabaseConnectionStatus(connectionId, status, details = {}) {
  try {
    const supabase = getSupabaseAdmin();

    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'active') {
      updateData.last_verified_at = new Date().toISOString();
    }
    if (details.lastUsed) {
      updateData.last_used_at = new Date().toISOString();
    }

    await supabase
      .from('database_connections')
      .update(updateData)
      .eq('id', connectionId);
  } catch (error) {
    console.error('[updateDatabaseConnectionStatus] Error:', error);
  }
}

/**
 * Delete a database connection
 * @param {string} userId - User ID
 * @param {string} connectionId - Connection UUID
 */
export async function deleteDatabaseConnection(userId, connectionId) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('database_connections')
      .delete()
      .eq('id', connectionId)
      .eq('user_id', userId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[deleteDatabaseConnection] Error:', error);
    throw error;
  }
}

// =============================================================================
// LEGACY SUPABASE CONNECTIONS (OAuth-based, for when partner approval granted)
// =============================================================================

/**
 * Update Supabase connection with selected project
 * @param {string} connectionId - Connection UUID
 * @param {string} projectRef - Supabase project reference
 * @param {string} projectName - Optional project name
 * @returns {Promise<boolean>}
 */
export async function updateSupabaseConnectionProject(connectionId, projectRef, projectName = null) {
  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('supabase_connections')
      .update({
        project_ref: projectRef,
        project_name: projectName,
        updated_at: new Date().toISOString()
      })
      .eq('id', connectionId);

    if (error) throw error;

    console.log(`[updateSupabaseConnectionProject] Set project ${projectRef} for connection ${connectionId}`);
    return true;
  } catch (error) {
    console.error('[updateSupabaseConnectionProject] Error:', error);
    return false;
  }
}

// Re-export supabase client for compatibility
export { getSupabaseAdmin as supabase } from './supabase.js';
