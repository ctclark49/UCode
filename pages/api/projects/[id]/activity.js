/**
 * Project Activity API
 *
 * GET /api/projects/[id]/activity
 *
 * Returns unified activity timeline for a project:
 * - AI chat messages (user prompts + assistant responses)
 * - File changes (creates, updates, deletes from tool_calls)
 * - Deployments
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../auth/[...nextauth]';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id: projectId } = req.query;
  const { limit = 100 } = req.query;

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID required' });
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get user ID from email
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email.toLowerCase())
      .single();

    if (!user || project.user_id !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const activities = [];

    // 1. Fetch chat history
    const { data: chatHistory, error: chatError } = await supabase
      .from('chat_history')
      .select('id, role, content, tool_calls, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (!chatError && chatHistory) {
      chatHistory.forEach(msg => {
        // Add the message itself
        activities.push({
          id: `chat-${msg.id}`,
          type: msg.role === 'user' ? 'user_message' : 'ai_message',
          title: msg.role === 'user' ? 'You' : 'AI Assistant',
          preview: truncateText(msg.content, 150),
          timestamp: msg.created_at,
          category: 'ai'
        });

        // Extract file changes from tool_calls
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          msg.tool_calls.forEach(tool => {
            if (tool.function?.name === 'writeFile' || tool.function?.name === 'editFile') {
              const args = parseToolArgs(tool.function?.arguments);
              if (args?.file_path || args?.path) {
                activities.push({
                  id: `file-${msg.id}-${tool.id || Math.random()}`,
                  type: tool.function.name === 'writeFile' ? 'file_created' : 'file_modified',
                  title: tool.function.name === 'writeFile' ? 'File created' : 'File modified',
                  files: [args.file_path || args.path],
                  timestamp: msg.created_at,
                  category: 'files'
                });
              }
            }
          });
        }
      });
    }

    // 2. Fetch deployments
    const { data: deployments, error: deployError } = await supabase
      .from('deployments')
      .select('id, subdomain, url, platform, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!deployError && deployments) {
      deployments.forEach(deploy => {
        activities.push({
          id: `deploy-${deploy.id}`,
          type: 'deployment',
          title: `Deployed to ${deploy.platform || 'EzCoder'}`,
          preview: deploy.url || `${deploy.subdomain}.ezcoder.dev`,
          timestamp: deploy.created_at,
          category: 'deploy',
          metadata: {
            url: deploy.url,
            subdomain: deploy.subdomain,
            status: deploy.status
          }
        });
      });
    }

    // 3. Try to fetch from project_chat_history if chat_history was empty
    if ((!chatHistory || chatHistory.length === 0)) {
      const { data: projectChat } = await supabase
        .from('project_chat_history')
        .select('id, role, content, tool_calls, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (projectChat) {
        projectChat.forEach(msg => {
          activities.push({
            id: `pchat-${msg.id}`,
            type: msg.role === 'user' ? 'user_message' : 'ai_message',
            title: msg.role === 'user' ? 'You' : 'AI Assistant',
            preview: truncateText(msg.content, 150),
            timestamp: msg.created_at,
            category: 'ai'
          });
        });
      }
    }

    // Sort all activities by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      activities: activities.slice(0, parseInt(limit)),
      total: activities.length
    });

  } catch (error) {
    console.error('[Activity API] Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch activity',
      message: error.message
    });
  }
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function parseToolArgs(args) {
  if (!args) return null;
  if (typeof args === 'object') return args;
  try {
    return JSON.parse(args);
  } catch {
    return null;
  }
}
