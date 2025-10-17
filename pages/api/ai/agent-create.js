/**
 * Agentic AI Create API
 * Real coding agent that generates projects like Replit/Lovable
 */

import { AgenticOrchestrator } from '../../../lib/ai/agentic-orchestrator';
import { setTask, updateTaskStatus } from '../../../lib/ai/task-store';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, projectId, userId } = req.body;

    if (!prompt || !projectId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['prompt', 'projectId']
      });
    }

    const taskId = uuidv4();
    const agent = new AgenticOrchestrator(projectId, userId || 'demo-user');

    // Store initial task
    setTask(taskId, {
      taskId,
      status: 'processing',
      type: 'agent-create',
      prompt,
      projectId,
      userId,
      createdAt: new Date(),
      progress: []
    });

    // Process asynchronously
    (async () => {
      try {
        const result = await agent.processRequest(prompt, (update) => {
          // Update task with progress
          updateTaskStatus(taskId, 'processing', {
            progress: update.progress,
            currentMessage: update.message
          });
        });

        // Mark as completed
        updateTaskStatus(taskId, 'completed', {
          result,
          files: result.files,
          plan: result.plan,
          completedAt: new Date()
        });

      } catch (error) {
        console.error('[Agent Create] Error:', error);
        updateTaskStatus(taskId, 'failed', {
          error: error.message,
          completedAt: new Date()
        });
      }
    })();

    // Return immediately with task ID
    return res.status(200).json({
      success: true,
      taskId,
      message: 'Agent is working on your request',
      pollUrl: `/api/ai/task-status?taskId=${taskId}`
    });

  } catch (error) {
    console.error('[API] Agent create error:', error);
    return res.status(500).json({
      error: 'Failed to start agent',
      message: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
