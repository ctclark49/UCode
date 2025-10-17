/**
 * Multi-Agent AI Request API
 * Routes requests to production NewK8V2 multi-agent system
 */

import { v4 as uuidv4 } from 'uuid';

const AI_ORCHESTRATOR_URL = process.env.AI_ORCHESTRATOR_URL || 'http://35.226.165.86:8080';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, projectId, agentType = 'project-architect' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    console.log(`[Multi-Agent] Routing request to ${agentType}`);
    console.log(`[Multi-Agent] Prompt: ${prompt.substring(0, 100)}...`);

    // Submit to AI orchestrator
    const response = await fetch(`${AI_ORCHESTRATOR_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType,
        prompt,
        projectId: projectId || 'demo-project',
        userId: req.session?.user?.id || 'demo-user',
        metadata: {
          source: 'web-ui',
          timestamp: new Date().toISOString()
        }
      }),
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orchestrator error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    console.log(`[Multi-Agent] Task submitted: ${data.taskId}`);

    return res.status(200).json({
      success: true,
      taskId: data.taskId,
      agentType,
      message: `Task submitted to ${agentType} agent`,
      pollUrl: `/api/ai/multi-agent-status?taskId=${data.taskId}`
    });

  } catch (error) {
    console.error('[Multi-Agent] Error:', error);

    return res.status(500).json({
      error: 'Failed to submit to multi-agent system',
      message: error.message,
      details: error.cause?.message || ''
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
