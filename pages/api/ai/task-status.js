/**
 * Task Status API
 * Check status and results of AI tasks
 */

import { getTask } from '../../../lib/ai/task-store';
import { query } from '../../../lib/database/postgres-adapter';

/**
 * Get task status from database
 */
async function getTaskFromDB(taskId) {
  try {
    const result = await query(
      `SELECT id, user_id, project_id, type, prompt, status, agent_type, result, error,
              created_at, started_at, completed_at, tokens_used, cost_usd
       FROM ai_tasks
       WHERE id = $1`,
      [taskId]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('[TaskStatus] Database error:', error);
    return null;
  }
}

/**
 * API Route Handler
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { taskId } = req.query;

    if (!taskId) {
      return res.status(400).json({ error: 'Missing taskId parameter' });
    }

    // Try in-memory store first (fastest)
    const memoryTask = getTask(taskId);

    if (memoryTask) {
      return res.status(200).json({
        taskId: memoryTask.taskId,
        status: memoryTask.status,
        agentType: memoryTask.agentType,
        type: memoryTask.type,
        prompt: memoryTask.prompt,
        result: memoryTask.result,
        error: memoryTask.error,
        createdAt: memoryTask.createdAt,
        completedAt: memoryTask.completedAt,
        source: 'memory'
      });
    }

    // Fall back to database
    const dbTask = await getTaskFromDB(taskId);

    if (!dbTask) {
      return res.status(404).json({
        error: 'Task not found',
        taskId
      });
    }

    // Format response
    const response = {
      taskId: dbTask.id,
      status: dbTask.status,
      agentType: dbTask.agent_type,
      type: dbTask.type,
      prompt: dbTask.prompt,
      result: dbTask.result,
      error: dbTask.error,
      createdAt: dbTask.created_at,
      startedAt: dbTask.started_at,
      completedAt: dbTask.completed_at,
      tokensUsed: dbTask.tokens_used,
      costUsd: dbTask.cost_usd,
      source: 'database'
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('[API] Task status error:', error);

    return res.status(500).json({
      error: 'Failed to fetch task status',
      message: error.message
    });
  }
}
