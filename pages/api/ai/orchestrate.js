/**
 * AI Orchestrator API
 * Submit AI development requests using local AI chat
 */

import { generateCompletion, generateCode } from '../../../lib/ai/local-orchestrator';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../../lib/database/postgres-adapter';
import { setTask, updateTaskStatus } from '../../../lib/ai/task-store';

/**
 * Process AI request with appropriate agent
 */
async function processAIRequest(type, prompt, userId, projectId) {
  const taskId = uuidv4();

  // Store task
  setTask(taskId, {
    taskId,
    status: 'processing',
    type,
    prompt,
    userId,
    projectId,
    createdAt: new Date(),
    agentType: mapTypeToAgent(type)
  });

  // Process asynchronously
  (async () => {
    try {
      let result;

      if (type === 'code' || type === 'frontend' || type === 'backend') {
        // Use code generation
        const response = await generateCode(prompt, { projectId });
        result = response.content;
      } else {
        // Use general completion
        const messages = [
          {
            role: 'system',
            content: getSystemPromptForType(type)
          },
          {
            role: 'user',
            content: prompt
          }
        ];

        const response = await generateCompletion(messages, {
          model: 'balanced',
          temperature: 0.7
        });

        result = response.content;
      }

      // Update task
      updateTaskStatus(taskId, 'completed', {
        result,
        completedAt: new Date()
      });

      // Store in database
      try {
        await query(
          `INSERT INTO ai_tasks (id, user_id, project_id, type, prompt, status, agent_type, result, created_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [taskId, userId, projectId, type, prompt, 'completed', mapTypeToAgent(type), result, new Date(), new Date()]
        );
      } catch (dbError) {
        console.error('[AI Orchestrate] DB error:', dbError);
      }

    } catch (error) {
      console.error('[AI Orchestrate] Processing error:', error);
      updateTaskStatus(taskId, 'failed', {
        error: error.message,
        completedAt: new Date()
      });
    }
  })();

  return taskId;
}

function mapTypeToAgent(type) {
  const mapping = {
    'frontend': 'frontend-developer',
    'backend': 'backend-developer',
    'code': 'code-generator',
    'test': 'testing-engineer',
    'debug': 'debugger',
    'optimize': 'performance-optimizer',
    'general': 'project-architect'
  };
  return mapping[type] || 'general-assistant';
}

function getSystemPromptForType(type) {
  const prompts = {
    frontend: 'You are an expert frontend developer. Generate clean, modern React/Next.js code with best practices.',
    backend: 'You are an expert backend developer. Generate clean, scalable Node.js/API code with proper error handling.',
    test: 'You are an expert testing engineer. Generate comprehensive test cases with Jest/Vitest.',
    debug: 'You are an expert debugger. Analyze code and provide fixes with explanations.',
    optimize: 'You are a performance optimization expert. Provide optimized code with benchmarks.',
    general: 'You are an expert software architect. Provide comprehensive technical solutions.'
  };
  return prompts[type] || prompts.general;
}

/**
 * API Route Handler
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, prompt, projectId } = req.body;

    // Get user ID from session
    const userId = req.session?.user?.id || 1; // Default to 1 for demo

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'Missing projectId' });
    }

    // Submit to orchestrator
    const taskId = await processAIRequest(
      type || 'general',
      prompt,
      userId,
      projectId
    );

    return res.status(200).json({
      success: true,
      taskId,
      agentType: mapTypeToAgent(type || 'general'),
      message: 'Task submitted successfully',
      estimatedTime: '30-60 seconds'
    });

  } catch (error) {
    console.error('[API] Orchestrator error:', error);

    return res.status(500).json({
      error: 'Failed to submit AI request',
      message: error.message
    });
  }
}

// Configure API route for larger payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
};