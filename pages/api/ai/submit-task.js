/**
 * Submit Task to Agentic Orchestrator
 * Queues task in Redis for processing
 */

import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

let redisClient = null;

async function getRedisClient() {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) return new Error('Redis connection failed');
        return Math.min(retries * 100, 3000);
      }
    }
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Error:', err);
  });

  await redisClient.connect();
  console.log('[Redis] Connected for task submission');

  return redisClient;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projectId, userId, prompt, agentType = 'generic', context = {} } = req.body;

    if (!projectId || !userId || !prompt) {
      return res.status(400).json({
        error: 'Missing required fields: projectId, userId, prompt'
      });
    }

    // Generate task ID
    const taskId = uuidv4();

    // Create task object
    const task = {
      taskId,
      projectId,
      userId,
      prompt,
      agentType,
      context,
      createdAt: Date.now()
    };

    // Get Redis client
    const redis = await getRedisClient();

    // Queue task
    const queueName = `queue:${agentType}`;
    await redis.lPush(queueName, JSON.stringify(task));

    console.log(`[Task Submitted] ${taskId} to queue:${agentType}`);

    // Return task ID for SSE connection
    return res.status(200).json({
      success: true,
      taskId,
      queueName,
      message: 'Task queued successfully'
    });

  } catch (error) {
    console.error('[Submit Task] Error:', error);
    return res.status(500).json({
      error: 'Failed to submit task',
      message: error.message
    });
  }
}
