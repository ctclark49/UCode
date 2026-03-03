/**
 * Conversation State Manager
 *
 * Handles saving and restoring AI conversation state for pause/resume flow.
 * When the AI calls a tool that requires user input (like requestDatabaseConnection),
 * we pause the conversation, save state, and resume after user provides input.
 *
 * State is stored in Redis for fast access and automatic expiration.
 */

import { createClient } from 'redis';
import { nanoid } from 'nanoid';

// Redis client (lazy initialized)
let redis = null;

// State expiration (15 minutes - user has time to provide credentials)
const STATE_TTL_SECONDS = 15 * 60;

/**
 * Initialize Redis connection
 */
async function getRedis() {
  if (redis && redis.isOpen) {
    return redis;
  }

  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

  if (!redisUrl) {
    console.warn('[conversation-state] No Redis URL configured, using in-memory fallback');
    return null;
  }

  try {
    redis = createClient({ url: redisUrl });
    redis.on('error', (err) => console.error('[conversation-state] Redis error:', err));
    await redis.connect();
    return redis;
  } catch (error) {
    console.error('[conversation-state] Failed to connect to Redis:', error);
    return null;
  }
}

// In-memory fallback when Redis is not available
const memoryStore = new Map();

/**
 * Generate a resume token
 * @returns {string} Unique resume token
 */
export function generateResumeToken() {
  return `resume_${nanoid(32)}`;
}

/**
 * Save conversation state for later resume
 *
 * @param {object} options - State options
 * @param {string} options.userId - User ID
 * @param {string} options.projectId - Project ID
 * @param {string} options.conversationId - Conversation/session ID
 * @param {Array} options.messages - Conversation messages so far
 * @param {object} options.pausedToolCall - The tool call that triggered the pause
 * @param {object} options.context - Additional context (files, settings, etc.)
 * @returns {Promise<string>} Resume token
 */
export async function saveConversationState({
  userId,
  projectId,
  conversationId,
  messages,
  pausedToolCall,
  context = {}
}) {
  const resumeToken = generateResumeToken();

  const state = {
    userId,
    projectId,
    conversationId,
    messages,
    pausedToolCall,
    context,
    pausedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString()
  };

  const key = `conversation:${resumeToken}`;
  const redis = await getRedis();

  if (redis) {
    await redis.setEx(key, STATE_TTL_SECONDS, JSON.stringify(state));
  } else {
    // In-memory fallback
    memoryStore.set(key, {
      ...state,
      expires: Date.now() + STATE_TTL_SECONDS * 1000
    });
  }

  console.log(`[conversation-state] Saved state for resume token: ${resumeToken.substring(0, 20)}...`);

  return resumeToken;
}

/**
 * Restore conversation state from a resume token
 *
 * @param {string} resumeToken - The resume token
 * @param {string} userId - User ID (for validation)
 * @returns {Promise<object|null>} Conversation state or null if expired/invalid
 */
export async function restoreConversationState(resumeToken, userId) {
  const key = `conversation:${resumeToken}`;
  const redis = await getRedis();

  let stateJson;

  if (redis) {
    stateJson = await redis.get(key);
  } else {
    // In-memory fallback
    const cached = memoryStore.get(key);
    if (cached && cached.expires > Date.now()) {
      stateJson = JSON.stringify(cached);
    }
  }

  if (!stateJson) {
    console.warn(`[conversation-state] State not found or expired for token: ${resumeToken.substring(0, 20)}...`);
    return null;
  }

  const state = JSON.parse(stateJson);

  // Validate user owns this conversation
  if (state.userId !== userId) {
    console.error(`[conversation-state] User mismatch for resume token`);
    return null;
  }

  return state;
}

/**
 * Delete conversation state (after successful resume or cancellation)
 *
 * @param {string} resumeToken - The resume token
 */
export async function deleteConversationState(resumeToken) {
  const key = `conversation:${resumeToken}`;
  const redis = await getRedis();

  if (redis) {
    await redis.del(key);
  } else {
    memoryStore.delete(key);
  }

  console.log(`[conversation-state] Deleted state for token: ${resumeToken.substring(0, 20)}...`);
}

/**
 * Create a tool result message for resuming the conversation
 *
 * @param {object} pausedToolCall - The original tool call that was paused
 * @param {object} result - The result to provide (e.g., connectionId from user input)
 * @returns {object} Tool result message
 */
export function createResumeToolResult(pausedToolCall, result) {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: pausedToolCall.id,
        content: JSON.stringify(result)
      }
    ]
  };
}

/**
 * Build messages array for resuming conversation
 *
 * @param {object} state - Saved conversation state
 * @param {object} userInput - User's input (e.g., database connection result)
 * @returns {Array} Messages array for Claude API
 */
export function buildResumeMessages(state, userInput) {
  const messages = [...state.messages];

  // Add the tool result from user input
  const toolResult = createResumeToolResult(state.pausedToolCall, userInput);
  messages.push(toolResult);

  return messages;
}

/**
 * Check if a tool result indicates the AI should pause
 *
 * @param {object} result - Tool execution result
 * @returns {boolean} True if AI should pause for user input
 */
export function shouldPauseForUserInput(result) {
  return result?.action === 'PAUSE_FOR_USER_INPUT';
}

/**
 * Check if connection already exists (no pause needed)
 *
 * @param {object} result - Tool execution result
 * @returns {boolean} True if connection already exists
 */
export function connectionAlreadyExists(result) {
  return result?.action === 'CONNECTION_EXISTS';
}

export default {
  generateResumeToken,
  saveConversationState,
  restoreConversationState,
  deleteConversationState,
  createResumeToolResult,
  buildResumeMessages,
  shouldPauseForUserInput,
  connectionAlreadyExists
};
