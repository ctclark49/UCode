/**
 * AI Resume API
 *
 * Resumes a paused conversation after:
 * 1. Token purchase (insufficient tokens pause)
 * 2. Database connection (requestDatabaseConnection tool pause)
 * 3. Other user input requirements
 *
 * POST /api/ai/resume
 * Body: { projectId, contextId?, resumeToken?, toolResult?, inputType? }
 *
 * GET /api/ai/resume?projectId=xxx
 * Check if there's a paused conversation
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import {
  getPausedContext,
  markContextResumed,
  checkPausedConversation
} from '../../../lib/ai/conversation-context-store';
import {
  restoreConversationState,
  deleteConversationState,
  buildResumeMessages
} from '../../../lib/ai/conversation-state';
import { tokenManagerV2 } from '../../../lib/tokens-v2';
import Anthropic from '@anthropic-ai/sdk';
import { getModelForTier } from '../../../lib/ai/agent-config';
import { createProductionTools, toolsToAnthropicFormat, executeTool } from '../../../lib/ai/production-tools';
import { createDatabaseToolsV2 } from '../../../lib/ai/database-tools';

const anthropic = new Anthropic();

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false
  },
};

export default async function handler(req, res) {
  // Only allow POST and GET
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate user
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.id) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    const userId = session.user.id;
    const body = req.method === 'POST' ? req.body : req.query;
    const { projectId, contextId, resumeToken, toolResult, inputType } = body;

    // If resumeToken provided, this is a database connection resume (or similar)
    if (resumeToken && req.method === 'POST') {
      return handleDatabaseConnectionResume(req, res, userId, resumeToken, toolResult, inputType);
    }

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID required',
        code: 'MISSING_PROJECT_ID'
      });
    }

    // GET: Check if there's a paused conversation
    if (req.method === 'GET') {
      const { hasPaused, context } = await checkPausedConversation(userId, projectId);

      if (!hasPaused) {
        return res.status(200).json({
          hasPausedConversation: false,
          message: 'No paused conversation found'
        });
      }

      // Check current token balance
      const tokenBalance = await tokenManagerV2.getUserTokens(userId);
      const hasTokens = tokenBalance.totalAvailable > 1000; // Need at least 1000 to continue

      return res.status(200).json({
        hasPausedConversation: true,
        canResume: hasTokens,
        context: {
          contextId: context.contextId,
          pauseReason: context.pauseReason,
          tokensUsed: context.tokensUsed,
          createdAt: context.createdAt,
          expiresAt: context.expiresAt,
          currentTask: context.currentTask,
          filesModified: context.pendingChanges?.length || 0
        },
        tokenBalance: {
          available: tokenBalance.totalAvailable,
          needsMore: !hasTokens
        },
        purchaseUrl: hasTokens ? null : '/billing'
      });
    }

    // POST: Resume the conversation
    // First, check token balance
    const tokenBalance = await tokenManagerV2.getUserTokens(userId);
    const MIN_TOKENS_FOR_RESUME = 1000;

    if (tokenBalance.totalAvailable < MIN_TOKENS_FOR_RESUME) {
      return res.status(402).json({
        error: 'Insufficient tokens to resume',
        code: 'INSUFFICIENT_TOKENS',
        available: tokenBalance.totalAvailable,
        required: MIN_TOKENS_FOR_RESUME,
        message: 'You need at least 1,000 tokens to resume. Purchase more tokens to continue.',
        purchaseUrl: '/billing'
      });
    }

    // Get the paused context
    const context = await getPausedContext(userId, projectId);

    if (!context) {
      return res.status(404).json({
        error: 'No paused conversation found',
        code: 'NO_CONTEXT',
        message: 'The paused conversation has expired or was already resumed.'
      });
    }

    // Mark as resumed (optimistically)
    await markContextResumed(context.contextId);

    // Return the context for the client to use with production-chat
    return res.status(200).json({
      success: true,
      message: 'Context retrieved successfully. Ready to resume.',
      resumeData: {
        contextId: context.contextId,
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        fileState: context.fileState,
        model: context.model,
        // The task to continue
        currentTask: context.currentTask,
        // Prompt to append that tells AI to continue
        resumePrompt: `Continue from where you left off. You were working on: "${context.currentTask}". The files have been restored to the state when you paused. Please continue completing the task.`
      },
      tokenBalance: {
        available: tokenBalance.totalAvailable
      }
    });

  } catch (error) {
    console.error('[Resume API] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to resume conversation',
      code: 'INTERNAL_ERROR'
    });
  }
}

/**
 * Handle resume after database connection (or other user input)
 * Uses the new conversation-state system for pause/resume
 */
async function handleDatabaseConnectionResume(req, res, userId, resumeToken, toolResult, inputType) {
  if (!toolResult) {
    return res.status(400).json({ error: 'Missing toolResult' });
  }

  try {
    // Restore conversation state
    const state = await restoreConversationState(resumeToken, userId);

    if (!state) {
      return res.status(404).json({
        error: 'Conversation state not found or expired',
        code: 'STATE_EXPIRED',
        message: 'The conversation has expired. Please start a new request.'
      });
    }

    // Build messages with the user's input as tool result
    const messages = buildResumeMessages(state, toolResult);

    // Set up SSE for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // Send resume confirmation
    sendEvent('resumed', {
      message: 'Conversation resumed',
      inputType,
      connectionResult: toolResult
    });

    // Prepare tools
    let tools = {};
    const mutableFileState = state.context?.fileState || {};

    // Get production tools
    const productionTools = await createProductionTools(state.projectId, mutableFileState);
    tools = { ...productionTools };

    // Add database tools if connection was just established
    if (inputType === 'database_connection' && toolResult.success && toolResult.connectionId) {
      try {
        const dbTools = await createDatabaseToolsV2(userId, toolResult.connectionId, state.projectId);
        tools = { ...tools, ...dbTools };
        sendEvent('tools_updated', { addedTools: Object.keys(dbTools) });
      } catch (error) {
        console.error('[ai/resume] Failed to create database tools:', error);
        sendEvent('warning', { message: 'Database connected but tools failed to initialize' });
      }
    }

    // Get user tier for model selection
    const userTier = state.context?.userTier || 'free';
    const modelConfig = getModelForTier(userTier, 'coder');

    // Continue the conversation with Claude
    const stream = anthropic.messages.stream({
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens || 4096,
      system: state.context?.systemPrompt || 'You are a helpful coding assistant. Continue from where you left off.',
      messages,
      tools: toolsToAnthropicFormat(tools)
    });

    // Handle streaming response
    let currentToolUse = null;
    let accumulatedText = '';

    stream.on('text', (text) => {
      accumulatedText += text;
      sendEvent('text', { text });
    });

    stream.on('contentBlockStart', (block) => {
      if (block.type === 'tool_use') {
        currentToolUse = {
          id: block.id,
          name: block.name,
          input: ''
        };
        sendEvent('tool_start', { toolName: block.name, toolId: block.id });
      }
    });

    stream.on('contentBlockStop', async (block) => {
      if (block?.type === 'tool_use' && currentToolUse) {
        const toolName = currentToolUse.name;
        const toolInput = block.input || {};

        sendEvent('tool_executing', { toolName, input: toolInput });

        try {
          const result = await executeTool(tools, toolName, toolInput);
          sendEvent('tool_result', { toolName, result });
        } catch (error) {
          sendEvent('tool_error', { toolName, error: error.message });
        }

        currentToolUse = null;
      }
    });

    stream.on('message', (message) => {
      if (message.stop_reason === 'end_turn') {
        sendEvent('complete', {
          stopReason: 'end_turn',
          text: accumulatedText
        });
      }
    });

    stream.on('error', (error) => {
      console.error('[ai/resume] Stream error:', error);
      sendEvent('error', { message: error.message });
    });

    // Wait for stream to complete
    await stream.finalMessage();

    // Clean up the saved state
    await deleteConversationState(resumeToken);

    // End SSE
    sendEvent('done', {});
    res.end();

  } catch (error) {
    console.error('[ai/resume] Database connection resume error:', error);

    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
}
