// pages/api/ai/chat.js - Unified AI Chat API (replaces Kubernetes orchestrator calls)
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { generateCompletion, generateWithConsensus, generateCode, debugCode, getProviderStatus } from '../../../lib/ai/local-orchestrator';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Track token usage in database
 */
async function trackUsage(userId, usage, provider, model) {
  try {
    // Get user's current usage
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('monthly_tokens_used, monthly_tokens_limit, additional_tokens_purchased, subscription_tier')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('[Chat API] Error fetching user:', userError);
      return;
    }

    // Update user's token usage
    const newTokensUsed = (user.monthly_tokens_used || 0) + usage.totalTokens;

    await supabase
      .from('users')
      .update({
        monthly_tokens_used: newTokensUsed,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    // Log usage in ai_usage table (create if doesn't exist)
    const usageRecord = {
      user_id: userId,
      provider: provider,
      model: model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cost_usd: calculateCost(provider, model, usage),
      created_at: new Date().toISOString()
    };

    // Try to insert, but don't fail if table doesn't exist yet
    try {
      await supabase.from('ai_usage').insert(usageRecord);
    } catch (tableError) {
      console.log('[Chat API] ai_usage table not available yet, skipping detailed logging');
    }

    console.log(`[Chat API] Tracked ${usage.totalTokens} tokens for user ${userId}`);
  } catch (error) {
    console.error('[Chat API] Error tracking usage:', error);
  }
}

/**
 * Calculate cost based on provider and model
 */
function calculateCost(provider, model, usage) {
  const pricing = {
    anthropic: {
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
    },
    openai: {
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
    },
    gemini: {
      'gemini-1.0-pro': { input: 0.00025, output: 0.0005 },
      'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    }
  };

  const modelPricing = pricing[provider]?.[model] || { input: 0.001, output: 0.002 };

  return (
    (usage.inputTokens / 1000) * modelPricing.input +
    (usage.outputTokens / 1000) * modelPricing.output
  );
}

/**
 * Check if user has enough tokens
 */
async function checkTokenQuota(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('monthly_tokens_used, monthly_tokens_limit, additional_tokens_purchased, skip_usage_check, subscription_tier')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[Chat API] Error checking quota:', error);
    return { allowed: true, remaining: 100000 }; // Allow on error
  }

  // Skip check for admin or unlimited users
  if (user.skip_usage_check || user.subscription_tier === 'unlimited') {
    return { allowed: true, remaining: 999999999 };
  }

  const used = user.monthly_tokens_used || 0;
  const limit = user.monthly_tokens_limit || 100000;
  const additional = user.additional_tokens_purchased || 0;
  const total = limit + additional;
  const remaining = Math.max(0, total - used);

  return {
    allowed: remaining > 0,
    remaining,
    used,
    limit: total
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user session
    const session = await getServerSession(req, res, authOptions);

    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = session.user.id;

    // Check token quota
    const quota = await checkTokenQuota(userId);

    if (!quota.allowed) {
      return res.status(429).json({
        error: 'Token quota exceeded',
        details: `You've used all ${quota.limit} tokens. Purchase more or upgrade your plan.`,
        used: quota.used,
        limit: quota.limit
      });
    }

    // Parse request
    const {
      messages,
      provider = 'auto',
      model = 'balanced',
      mode = 'chat',
      stream = false,
      code,
      error: errorMsg,
      context = {}
    } = req.body;

    if (!messages && mode === 'chat') {
      return res.status(400).json({ error: 'Messages are required' });
    }

    console.log(`[Chat API] Request from user ${userId}: mode=${mode}, provider=${provider}, model=${model}`);

    let response;

    // Handle different modes
    switch (mode) {
      case 'consensus':
        response = await generateWithConsensus(messages, { model, stream });
        break;

      case 'code':
        if (!messages || messages.length === 0) {
          return res.status(400).json({ error: 'Prompt is required for code generation' });
        }
        const prompt = messages[messages.length - 1].content;
        response = await generateCode(prompt, context);
        break;

      case 'debug':
        if (!code || !errorMsg) {
          return res.status(400).json({ error: 'Code and error are required for debugging' });
        }
        response = await debugCode(code, errorMsg, context);
        break;

      case 'chat':
      default:
        response = await generateCompletion(messages, { provider, model, stream });
        break;
    }

    // Track usage
    if (response.usage) {
      await trackUsage(userId, response.usage, response.provider, response.model);
    }

    // Return response
    return res.status(200).json({
      success: true,
      content: response.content,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      consensus: response.consensus || false,
      providersUsed: response.providersUsed || [response.provider],
      quotaRemaining: quota.remaining - (response.usage?.totalTokens || 0)
    });

  } catch (error) {
    console.error('[Chat API] Error:', error);

    // Provide helpful error messages
    if (error.message.includes('No AI providers configured')) {
      return res.status(503).json({
        error: 'AI service unavailable',
        details: 'No AI providers are configured. Please contact support.'
      });
    }

    if (error.message.includes('API key')) {
      return res.status(503).json({
        error: 'AI service unavailable',
        details: 'AI provider authentication failed. Please contact support.'
      });
    }

    return res.status(500).json({
      error: 'Failed to generate response',
      details: error.message
    });
  }
}

/**
 * Health check endpoint
 */
export async function healthCheck(req, res) {
  const status = getProviderStatus();
  const availableProviders = Object.keys(status).filter(p => status[p].available);

  return res.status(200).json({
    healthy: availableProviders.length > 0,
    providers: status,
    availableProviders
  });
}
