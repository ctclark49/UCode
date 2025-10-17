/**
 * Unified AI Processing Endpoint
 * Single-system architecture with tier-based execution modes
 * 
 * @production-ready
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getOrchestrator } from '../../../lib/ai-core/orchestrator-singleton';
import { tokenManager } from '../../../lib/tokens';
import { logger } from '../../../lib/monitoring/logger';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();

  try {
    // Authenticate user
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      logger.warn('Unauthorized AI processing attempt', { requestId });
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user details and tier
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user.email.toLowerCase())
      .single();

    if (userError || !user) {
      logger.error('User lookup failed', { email: session.user.email, error: userError });
      return res.status(404).json({ error: 'User not found' });
    }

    // Extract request parameters
    const {
      prompt,
      mode = 'single-pass', // Default to single-pass for all users
      files = {},
      images = [],
      context = {},
      preferences = {},
      projectId = 'default',
      forceMode = null
    } = req.body;

    // Determine user tier
    const userTier = user.subscription_tier || 'free';
    
    // Determine execution mode based on tier
    let executionMode = mode;
    if (userTier === 'free') {
      executionMode = 'single-pass'; // Free tier always single-pass
    } else if (forceMode && userTier !== 'free') {
      executionMode = forceMode; // Paid tiers can force mode
    }

    // Check token balance for paid features
    let hasTokens = true;
    if (executionMode === 'autonomous') {
      const balance = await tokenManager.getTokenBalance(user.id);
      hasTokens = balance > 1000; // Minimum for autonomous
      
      if (!hasTokens) {
        return res.status(402).json({ 
          error: 'Insufficient tokens for autonomous mode',
          required: 1000,
          balance,
          purchaseUrl: '/billing'
        });
      }
    }

    // Log request
    logger.info('AI processing request', {
      requestId,
      userId: user.id,
      userTier,
      executionMode,
      promptLength: prompt?.length,
      filesCount: Object.keys(files).length
    });

    // Get orchestrator singleton
    const orchestrator = await getOrchestrator();
    
    // Prepare request based on tier and mode
    const orchestratorRequest = {
      prompt,
      mode: executionMode === 'autonomous' ? 'autonomous' : 'advanced',
      files,
      images,
      context: {
        ...context,
        userId: user.id,
        userTier,
        requestId,
        projectId
      },
      preferences: {
        ...preferences,
        // Apply tier-based limits
        maxTokens: getMaxTokensForTier(userTier),
        model: getModelForTier(userTier),
        temperature: preferences.temperature || 0.7
      }
    };

    // Process request
    let response;
    
    if (executionMode === 'single-pass') {
      // Single execution (non-autonomous)
      response = await orchestrator.processRequest(orchestratorRequest);
    } else if (executionMode === 'autonomous') {
      // Continuous execution until complete
      response = await processAutonomous(orchestrator, orchestratorRequest, user.id);
    } else {
      // Default to single-pass
      response = await orchestrator.processRequest(orchestratorRequest);
    }

    // Track token usage
    if (response.usage?.total_tokens) {
      await tokenManager.consumeTokens(user.id, response.usage.total_tokens);
    }

    // Log completion
    const duration = Date.now() - startTime;
    logger.info('AI processing completed', {
      requestId,
      duration,
      tokensUsed: response.usage?.total_tokens,
      cached: response.cached || false
    });

    // Return response
    return res.status(200).json({
      success: true,
      requestId,
      mode: executionMode,
      result: response.result || response,
      usage: response.usage,
      cached: response.cached || false,
      duration
    });

  } catch (error) {
    logger.error('AI processing failed', {
      requestId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      requestId,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Process autonomous request with continuous execution
 */
async function processAutonomous(orchestrator, request, userId) {
  let result = null;
  let iterations = 0;
  const maxIterations = 10;
  const results = [];
  
  while (iterations < maxIterations) {
    // Check token balance before each iteration
    if (iterations > 0) {
      const balance = await tokenManager.getTokenBalance(userId);
      if (balance < 100) {
        // Pause execution
        return {
          result: combineResults(results),
          paused: true,
          reason: 'Insufficient tokens',
          iterations,
          continueUrl: `/api/ai/continue/${request.context.requestId}`
        };
      }
    }
    
    // Execute iteration
    const iterationResult = await orchestrator.processRequest({
      ...request,
      context: {
        ...request.context,
        iteration: iterations,
        previousResults: results.map(r => r.summary || r.result)
      }
    });
    
    results.push(iterationResult);
    
    // Check if task is complete
    if (isTaskComplete(iterationResult)) {
      break;
    }
    
    iterations++;
  }
  
  return {
    result: combineResults(results),
    iterations,
    usage: calculateTotalUsage(results)
  };
}

/**
 * Check if task is complete
 */
function isTaskComplete(result) {
  if (!result) return false;
  if (result.status === 'complete') return true;
  if (result.confidence && result.confidence > 0.95) return true;
  return false;
}

/**
 * Combine results from multiple iterations
 */
function combineResults(results) {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0].result || results[0];
  
  // Combine all results
  const combined = {
    files: {},
    content: [],
    summary: []
  };
  
  for (const result of results) {
    if (result.files) {
      Object.assign(combined.files, result.files);
    }
    if (result.content) {
      combined.content.push(result.content);
    }
    if (result.summary) {
      combined.summary.push(result.summary);
    }
  }
  
  return combined;
}

/**
 * Calculate total token usage
 */
function calculateTotalUsage(results) {
  const usage = {
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0
  };
  
  for (const result of results) {
    if (result.usage) {
      usage.total_tokens += result.usage.total_tokens || 0;
      usage.prompt_tokens += result.usage.prompt_tokens || 0;
      usage.completion_tokens += result.usage.completion_tokens || 0;
    }
  }
  
  return usage;
}

/**
 * Get max tokens based on tier
 */
function getMaxTokensForTier(tier) {
  const limits = {
    free: 1000,
    starter: 4000,
    creator: 8000,
    business: 16000,
    enterprise: 32000
  };
  
  return limits[tier] || 1000;
}

/**
 * Get model based on tier
 */
function getModelForTier(tier) {
  const models = {
    free: 'gpt-3.5-turbo',
    starter: 'gpt-4-turbo',
    creator: 'gpt-4-turbo',
    business: 'gpt-4',
    enterprise: 'gpt-4'
  };
  
  return models[tier] || 'gpt-3.5-turbo';
}