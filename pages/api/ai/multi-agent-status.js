/**
 * Multi-Agent Task Status API
 * Check status of tasks in production NewK8V2 system
 */

const AI_ORCHESTRATOR_URL = process.env.AI_ORCHESTRATOR_URL || 'http://35.226.165.86:8080';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { taskId } = req.query;

    if (!taskId) {
      return res.status(400).json({ error: 'Missing taskId' });
    }

    // Query orchestrator for task status
    const response = await fetch(`${AI_ORCHESTRATOR_URL}/api/v1/tasks/${taskId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({
          error: 'Task not found',
          taskId
        });
      }
      throw new Error(`Orchestrator error: ${response.status}`);
    }

    const data = await response.json();

    return res.status(200).json({
      taskId: data.taskId,
      status: data.status,
      agentType: data.agentType,
      result: data.result,
      error: data.error,
      progress: data.progress,
      createdAt: data.createdAt,
      completedAt: data.completedAt,
      files: data.files
    });

  } catch (error) {
    console.error('[Multi-Agent Status] Error:', error);

    return res.status(500).json({
      error: 'Failed to check task status',
      message: error.message
    });
  }
}
