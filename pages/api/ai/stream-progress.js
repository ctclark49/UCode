/**
 * SSE Streaming Endpoint for Real-Time AI Progress
 * Subscribes to Redis pub/sub and streams progress events to frontend
 */

import { createClient } from 'redis';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

// Redis connection cache
let redisSubClient = null;

async function getRedisSubscriber() {
  if (redisSubClient && redisSubClient.isOpen) {
    return redisSubClient;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisSubClient = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) return new Error('Redis connection failed');
        return Math.min(retries * 100, 3000);
      }
    }
  });

  redisSubClient.on('error', (err) => {
    console.error('[Redis Sub] Error:', err);
  });

  await redisSubClient.connect();
  console.log('[Redis Sub] Connected for SSE streaming');

  return redisSubClient;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskId } = req.query;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  console.log(`[SSE] Client connected for task ${taskId}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    taskId,
    timestamp: Date.now()
  })}\n\n`);

  let subscriber = null;
  let isConnected = true;

  try {
    // Get Redis subscriber
    subscriber = await getRedisSubscriber();

    // Create dedicated subscriber for this connection
    const dedicatedSub = subscriber.duplicate();
    await dedicatedSub.connect();

    // Subscribe to progress channel
    const progressChannel = `progress:${taskId}`;

    await dedicatedSub.subscribe(progressChannel, (message) => {
      if (!isConnected) return;

      try {
        const event = JSON.parse(message);

        console.log(`[SSE] Sending event to client: ${event.type}`);

        res.write(`data: ${JSON.stringify(event)}\n\n`);

        // Close connection if task is completed or errored
        if (event.type === 'task_completed' || event.type === 'task_error') {
          console.log(`[SSE] Task ${taskId} finished, closing connection`);
          setTimeout(() => {
            if (isConnected) {
              dedicatedSub.unsubscribe(progressChannel);
              dedicatedSub.quit();
              res.end();
              isConnected = false;
            }
          }, 1000);
        }
      } catch (error) {
        console.error('[SSE] Error processing message:', error);
      }
    });

    console.log(`[SSE] Subscribed to ${progressChannel}`);

    // Also subscribe to file changes for live preview updates
    const filesChannel = `files:${taskId}`;

    await dedicatedSub.subscribe(filesChannel, (message) => {
      if (!isConnected) return;

      try {
        const fileChange = JSON.parse(message);

        res.write(`data: ${JSON.stringify({
          type: 'file_change',
          ...fileChange,
          timestamp: Date.now()
        })}\n\n`);
      } catch (error) {
        console.error('[SSE] Error processing file change:', error);
      }
    });

    // Send heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      if (!isConnected) {
        clearInterval(heartbeatInterval);
        return;
      }

      res.write(`: heartbeat\n\n`);
    }, 15000);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`[SSE] Client disconnected for task ${taskId}`);
      isConnected = false;
      clearInterval(heartbeatInterval);

      dedicatedSub.unsubscribe(progressChannel);
      dedicatedSub.unsubscribe(filesChannel);
      dedicatedSub.quit();
    });

  } catch (error) {
    console.error('[SSE] Error setting up stream:', error);

    if (isConnected) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message,
        timestamp: Date.now()
      })}\n\n`);
      res.end();
    }
  }
}
