/**
 * Queue Task Status API
 * Checks Redis for task completion status
 */

import { createClient } from 'redis';

let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: 'redis://localhost:6379'
    });

    redisClient.on('error', (err) => console.error('[Redis] Error:', err));
    await redisClient.connect();
  }

  return redisClient;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { taskId } = req.query;

    if (!taskId) {
      return res.status(400).json({ error: 'Missing taskId' });
    }

    const redis = await getRedisClient();

    // Get task from hash
    const taskJson = await redis.hGet('tasks', taskId);

    if (!taskJson) {
      return res.status(404).json({
        error: 'Task not found',
        taskId
      });
    }

    const task = JSON.parse(taskJson);

    // Check if result exists
    const resultJson = await redis.hGet('results', taskId);

    if (resultJson) {
      const result = JSON.parse(resultJson);

      return res.status(200).json({
        taskId,
        status: 'completed',
        result: result.content,
        files: result.files,
        agentType: result.agentType,
        completedAt: result.completedAt
      });
    }

    // Task is still pending/processing
    return res.status(200).json({
      taskId,
      status: task.status || 'processing',
      agentType: task.agentType,
      createdAt: task.createdAt,
      progress: 50
    });

  } catch (error) {
    console.error('[Queue Status] Error:', error);

    return res.status(500).json({
      error: 'Failed to check status',
      message: error.message
    });
  }
}
