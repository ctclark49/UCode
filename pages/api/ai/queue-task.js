/**
 * Direct Queue Task API
 * Pushes tasks directly to Redis queues that agents consume
 * THIS IS THE REAL SYSTEM - NO WORKAROUNDS
 */

import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, projectId, agentType = 'project-architect' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const taskId = uuidv4();
    const task = {
      taskId,
      prompt,
      projectId: projectId || 'demo',
      userId: 'local-user',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    console.log(`[Queue] Pushing task to queue:${agentType}:`, {
      taskId,
      prompt: prompt.substring(0, 50)
    });

    const redis = await getRedisClient();

    // Push to agent's queue
    await redis.rPush(`queue:${agentType}`, JSON.stringify(task));

    // Store task in hash for status lookups
    await redis.hSet('tasks', taskId, JSON.stringify(task));

    console.log(`[Queue] Task ${taskId} queued successfully`);

    return res.status(200).json({
      success: true,
      taskId,
      agentType,
      message: `Task queued for ${agentType} agent`,
      queueName: `queue:${agentType}`
    });

  } catch (error) {
    console.error('[Queue] Error:', error);

    return res.status(500).json({
      error: 'Failed to queue task',
      message: error.message,
      hint: 'Run: kubectl port-forward -n newk8v2-production svc/redis 6379:6379'
    });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }
  }
};
