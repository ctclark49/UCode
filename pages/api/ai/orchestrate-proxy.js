/**
 * SIMPLE AI Orchestrator Proxy
 * Forwards ALL requests to localhost:8080 (port-forwarded from cluster)
 * NO COMPLEXITY, NO WORKAROUNDS
 */

const ORCHESTRATOR_URL = 'http://localhost:8080';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    console.log('[Proxy] Forwarding to multi-agent system:', {
      prompt: body.prompt?.substring(0, 50),
      projectId: body.projectId
    });

    // Forward directly to orchestrator
    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentType: 'project-architect',
        prompt: body.prompt,
        projectId: body.projectId || 'demo',
        userId: 'local-user',
        files: body.files || {},
        metadata: body
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Orchestrator error: ${response.status}`);
    }

    const data = await response.json();

    console.log('[Proxy] Task created:', data.taskId);

    return res.status(200).json(data);

  } catch (error) {
    console.error('[Proxy] Error:', error.message);

    return res.status(500).json({
      error: 'Orchestrator connection failed',
      message: error.message,
      hint: 'Run: kubectl port-forward -n newk8v2-production svc/ai-orchestrator 8080:8080'
    });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }
  }
};
