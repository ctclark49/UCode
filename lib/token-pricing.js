// lib/token-pricing.js - Accurate token pricing with 3.5x markup for sustainability
// All prices are in USD per 1M tokens
// MARKUP: 3.5x on all API costs ensures profitability
//
// Token-to-USD Conversion:
// - 1 EzCoder token = variable USD value based on model used
// - When a user spends tokens, we calculate the actual API cost and charge 3.5x
// - This ensures consistent profitability regardless of which model is used
//
// Last updated: January 2026 (includes GPT-5.x, Claude Opus/Sonnet 4.5, Gemini 3)

const MARKUP = 3.5;

/**
 * Calculate marked-up prices from base API costs
 */
function withMarkup(inputPrice, outputPrice) {
  return {
    input: inputPrice,
    output: outputPrice,
    markup: MARKUP,
    ourInput: inputPrice * MARKUP,
    ourOutput: outputPrice * MARKUP
  };
}

export const MODEL_PRICING = {
  // ============================================================
  // OPENAI MODELS (ChatGPT) - Prices as of January 2026
  // https://openai.com/pricing
  // ============================================================

  // GPT-5.2 (Latest Flagship - 400K context, 128K output)
  'gpt-5.2': withMarkup(1.75, 14.00),
  'gpt-5-2': withMarkup(1.75, 14.00),
  'gpt-5.2-chat-latest': withMarkup(1.75, 14.00),

  // GPT-5 Series
  'gpt-5': withMarkup(1.25, 10.00),
  'gpt-5-chat-latest': withMarkup(1.25, 10.00),
  'gpt-5-mini': withMarkup(0.25, 2.00),
  'gpt-5-nano': withMarkup(0.05, 0.40),

  // GPT-4.1 Series
  'gpt-4.1': withMarkup(2.00, 8.00),
  'gpt-4-1': withMarkup(2.00, 8.00),
  'gpt-4.1-mini': withMarkup(0.40, 1.60),
  'gpt-4.1-nano': withMarkup(0.10, 0.40),

  // GPT-4o (Multimodal model)
  'gpt-4o': withMarkup(2.50, 10.00),
  'gpt-4o-2024-11-20': withMarkup(2.50, 10.00),
  'gpt-4o-2024-08-06': withMarkup(2.50, 10.00),
  'gpt-4o-2024-05-13': withMarkup(5.00, 15.00),

  // GPT-4o Mini (Small, fast, cheap)
  'gpt-4o-mini': withMarkup(0.15, 0.60),
  'gpt-4o-mini-2024-07-18': withMarkup(0.15, 0.60),

  // GPT-4 Turbo
  'gpt-4-turbo': withMarkup(10.00, 30.00),
  'gpt-4-turbo-preview': withMarkup(10.00, 30.00),
  'gpt-4-turbo-2024-04-09': withMarkup(10.00, 30.00),
  'gpt-4-1106-preview': withMarkup(10.00, 30.00),
  'gpt-4-0125-preview': withMarkup(10.00, 30.00),

  // GPT-4 (Original)
  'gpt-4': withMarkup(30.00, 60.00),
  'gpt-4-32k': withMarkup(60.00, 120.00),
  'gpt-4-0613': withMarkup(30.00, 60.00),

  // GPT-3.5 Turbo
  'gpt-3.5-turbo': withMarkup(0.50, 1.50),
  'gpt-3.5-turbo-0125': withMarkup(0.50, 1.50),
  'gpt-3.5-turbo-1106': withMarkup(1.00, 2.00),
  'gpt-3.5-turbo-16k': withMarkup(3.00, 4.00),
  'gpt-3.5-turbo-instruct': withMarkup(1.50, 2.00),

  // o4 Models (Latest Reasoning)
  'o4-mini': withMarkup(5.00, 20.00),
  'o4-mini-deep-research': withMarkup(5.00, 20.00),

  // o3 Models (Advanced Reasoning)
  'o3': withMarkup(2.00, 8.00),
  'o3-deep-research': withMarkup(2.00, 8.00),
  'o3-pro': withMarkup(4.00, 16.00),
  'o3-pro-2025-06-10': withMarkup(4.00, 16.00),

  // o1 Models (Reasoning)
  'o1': withMarkup(15.00, 60.00),
  'o1-2024-12-17': withMarkup(15.00, 60.00),
  'o1-preview': withMarkup(15.00, 60.00),
  'o1-preview-2024-09-12': withMarkup(15.00, 60.00),
  'o1-pro': withMarkup(20.00, 80.00),
  'o1-mini': withMarkup(3.00, 12.00),
  'o1-mini-2024-09-12': withMarkup(3.00, 12.00),

  // o3-mini (Legacy reasoning model)
  'o3-mini': withMarkup(1.10, 4.40),
  'o3-mini-2025-01-31': withMarkup(1.10, 4.40),

  // ============================================================
  // ANTHROPIC CLAUDE MODELS - Prices as of January 2026
  // https://www.anthropic.com/pricing
  // ============================================================

  // Claude Opus 4.5 (Most Capable - 67% cheaper than Opus 4!)
  // $5 input / $25 output per million tokens
  'claude-opus-4-5': withMarkup(5.00, 25.00),
  'claude-opus-4.5': withMarkup(5.00, 25.00),
  'claude-4.5-opus': withMarkup(5.00, 25.00),
  'claude-4-5-opus': withMarkup(5.00, 25.00),

  // Claude Sonnet 4.5 (Same pricing as Sonnet 4)
  // $3 input / $15 output (standard), $6/$22.50 for >200K context
  'claude-sonnet-4-5': withMarkup(3.00, 15.00),
  'claude-sonnet-4.5': withMarkup(3.00, 15.00),
  'claude-4.5-sonnet': withMarkup(3.00, 15.00),
  'claude-4-5-sonnet': withMarkup(3.00, 15.00),

  // Claude Opus 4 (claude-opus-4-20250514)
  'claude-opus-4-20250514': withMarkup(15.00, 75.00),
  'claude-opus-4': withMarkup(15.00, 75.00),
  'claude-4-opus': withMarkup(15.00, 75.00),

  // Claude Sonnet 4 (claude-sonnet-4-20250514)
  'claude-sonnet-4-20250514': withMarkup(3.00, 15.00),
  'claude-sonnet-4': withMarkup(3.00, 15.00),
  'claude-4-sonnet': withMarkup(3.00, 15.00),

  // Claude 3.5 Models
  'claude-3-5-sonnet-20241022': withMarkup(3.00, 15.00),
  'claude-3-5-sonnet-latest': withMarkup(3.00, 15.00),
  'claude-3.5-sonnet': withMarkup(3.00, 15.00),
  'claude-3-5-haiku-20241022': withMarkup(0.80, 4.00),
  'claude-3.5-haiku': withMarkup(0.80, 4.00),

  // Claude Haiku 4 (Economy tier)
  // $1 input / $5 output per million tokens
  'claude-haiku-4': withMarkup(1.00, 5.00),
  'claude-4-haiku': withMarkup(1.00, 5.00),

  // Claude 3 Models
  'claude-3-opus': withMarkup(15.00, 75.00),
  'claude-3-opus-20240229': withMarkup(15.00, 75.00),
  'claude-3-opus-latest': withMarkup(15.00, 75.00),
  'claude-3-sonnet': withMarkup(3.00, 15.00),
  'claude-3-sonnet-20240229': withMarkup(3.00, 15.00),
  'claude-3-haiku': withMarkup(0.25, 1.25),
  'claude-3-haiku-20240307': withMarkup(0.25, 1.25),

  // Claude 2.x (Legacy)
  'claude-2.1': withMarkup(8.00, 24.00),
  'claude-2.0': withMarkup(8.00, 24.00),
  'claude-2': withMarkup(8.00, 24.00),
  'claude-instant-1.2': withMarkup(0.80, 2.40),
  'claude-instant': withMarkup(0.80, 2.40),

  // ============================================================
  // GOOGLE GEMINI MODELS - Prices as of January 2026
  // https://ai.google.dev/pricing
  // ============================================================

  // Gemini 3 Flash (Newest - Released Dec 2025, outperforms 2.5 Pro!)
  // $0.50 input / $3.00 output per million tokens
  'gemini-3-flash': withMarkup(0.50, 3.00),
  'gemini-3.0-flash': withMarkup(0.50, 3.00),

  // Gemini 3 Pro (Premium tier)
  // $2-4 input / $12-18 output per million tokens (using midpoint)
  'gemini-3-pro': withMarkup(3.00, 15.00),
  'gemini-3.0-pro': withMarkup(3.00, 15.00),

  // Gemini 2.5 Flash
  'gemini-2.5-flash': withMarkup(0.30, 2.50),
  'gemini-2-5-flash': withMarkup(0.30, 2.50),

  // Gemini 2.5 Pro
  'gemini-2.5-pro': withMarkup(2.50, 10.00),
  'gemini-2-5-pro': withMarkup(2.50, 10.00),

  // Gemini 2.0 Models
  'gemini-2.0-flash': withMarkup(0.10, 0.40),
  'gemini-2.0-flash-exp': withMarkup(0.10, 0.40),
  'gemini-2.0-flash-thinking-exp': withMarkup(0.10, 0.40),

  // Gemini 1.5 Pro
  'gemini-1.5-pro': withMarkup(1.25, 5.00),
  'gemini-1.5-pro-latest': withMarkup(1.25, 5.00),
  'gemini-1.5-pro-002': withMarkup(1.25, 5.00),
  'gemini-1.5-pro-001': withMarkup(1.25, 5.00),

  // Gemini 1.5 Flash
  'gemini-1.5-flash': withMarkup(0.075, 0.30),
  'gemini-1.5-flash-latest': withMarkup(0.075, 0.30),
  'gemini-1.5-flash-002': withMarkup(0.075, 0.30),
  'gemini-1.5-flash-001': withMarkup(0.075, 0.30),
  'gemini-1.5-flash-8b': withMarkup(0.0375, 0.15),

  // Gemini 1.0 Pro (Legacy)
  'gemini-pro': withMarkup(0.50, 1.50),
  'gemini-1.0-pro': withMarkup(0.50, 1.50),
  'gemini-pro-vision': withMarkup(0.50, 1.50),

  // ============================================================
  // DEFAULT FALLBACK
  // Used when model is not recognized - conservative pricing
  // ============================================================
  'default': withMarkup(3.00, 10.00)
};

// Model aliases for common variations
const MODEL_ALIASES = {
  // OpenAI aliases - Updated for GPT-5 series
  'chatgpt': 'gpt-5.2',
  'chatgpt-5': 'gpt-5',
  'chatgpt-4o': 'gpt-4o',
  'gpt5': 'gpt-5',
  'gpt52': 'gpt-5.2',
  'gpt4': 'gpt-4',
  'gpt4o': 'gpt-4o',
  'gpt4-turbo': 'gpt-4-turbo',
  'gpt35': 'gpt-3.5-turbo',
  'gpt-35-turbo': 'gpt-3.5-turbo',

  // Claude aliases - Updated for 4.5 series
  'claude': 'claude-sonnet-4.5',
  'claude-latest': 'claude-sonnet-4.5',
  'claude-sonnet': 'claude-sonnet-4.5',
  'claude-opus': 'claude-opus-4.5',
  'claude-haiku': 'claude-haiku-4',
  'sonnet': 'claude-sonnet-4.5',
  'sonnet-4.5': 'claude-sonnet-4.5',
  'opus': 'claude-opus-4.5',
  'opus-4.5': 'claude-opus-4.5',
  'haiku': 'claude-haiku-4',

  // Gemini aliases - Updated for Gemini 3
  'gemini': 'gemini-3-flash',
  'gemini-latest': 'gemini-3-flash',
  'gemini-flash': 'gemini-3-flash',
  'gemini-pro': 'gemini-3-pro',
  'gemini-pro-latest': 'gemini-3-pro'
};

/**
 * Resolve model name to canonical form
 */
function resolveModelName(model) {
  const modelLower = model.toLowerCase().trim();
  return MODEL_ALIASES[modelLower] || modelLower;
}

/**
 * Get pricing for a specific model
 */
export function getModelPricing(model) {
  const resolvedModel = resolveModelName(model);
  return MODEL_PRICING[resolvedModel] || MODEL_PRICING.default;
}

/**
 * Calculate the cost in USD for token usage
 * @param {string} model - The model name
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {object} - Cost breakdown and total
 */
export function calculateTokenCost(model, inputTokens, outputTokens) {
  const pricing = getModelPricing(model);

  // Calculate costs (prices are per 1M tokens, so divide by 1,000,000)
  const inputCost = (inputTokens / 1000000) * pricing.ourInput;
  const outputCost = (outputTokens / 1000000) * pricing.ourOutput;
  const totalCost = inputCost + outputCost;

  // Also calculate the raw API cost (before markup)
  const rawInputCost = (inputTokens / 1000000) * pricing.input;
  const rawOutputCost = (outputTokens / 1000000) * pricing.output;
  const rawTotalCost = rawInputCost + rawOutputCost;

  return {
    inputCost,
    outputCost,
    totalCost,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model,
    markup: MARKUP,
    rawCost: rawTotalCost,
    profit: totalCost - rawTotalCost,
    pricing: {
      inputPer1M: pricing.ourInput,
      outputPer1M: pricing.ourOutput,
      rawInputPer1M: pricing.input,
      rawOutputPer1M: pricing.output
    }
  };
}

/**
 * Convert USD to EzCoder tokens based on average model cost
 * Used for token package purchases (we sell at a flat rate)
 *
 * Token Package Pricing Strategy:
 * - We sell tokens at $0.05 per 1K tokens (base rate)
 * - This averages out across all model usage
 * - Heavy Claude Opus users cost us more, but heavy Haiku users cost less
 * - The 3.5x markup ensures profitability even with expensive model usage
 */
export const TOKEN_PACKAGE_RATE = {
  dollarsPerThousandTokens: 0.05,  // $0.05 per 1K tokens sold
  tokensPerDollar: 20000           // 20K tokens per $1
};

/**
 * Estimate token value in dollars based on user's tier
 * This is used for displaying approximate dollar value of tokens
 * @param {number} tokens - Number of tokens
 * @param {string} tier - User's subscription tier
 * @returns {number} - Estimated dollar value
 */
export function estimateTokenValue(tokens, tier = 'starter') {
  // Token value varies by tier (higher tiers get better rates)
  const tokensPerDollar = {
    starter: 20000,    // $0.05 per 1K tokens
    creator: 21053,    // ~$0.0475 per 1K tokens (5% discount)
    business: 22222,   // ~$0.045 per 1K tokens (10% discount)
    enterprise: 25000  // $0.04 per 1K tokens (20% discount)
  };

  const rate = tokensPerDollar[tier] || tokensPerDollar.starter;
  return tokens / rate;
}

/**
 * Calculate how many tokens a dollar amount buys
 * @param {number} dollars - USD amount
 * @param {string} tier - User's subscription tier
 * @returns {number} - Number of tokens
 */
export function dollarsToTokens(dollars, tier = 'starter') {
  const tokensPerDollar = {
    starter: 20000,
    creator: 21053,
    business: 22222,
    enterprise: 25000
  };

  const rate = tokensPerDollar[tier] || tokensPerDollar.starter;
  return Math.floor(dollars * rate);
}

/**
 * Get model display name and category
 * @param {string} model - The model identifier
 * @returns {object} - Display information
 */
export function getModelInfo(model) {
  const modelLower = model.toLowerCase();

  // OpenAI models - GPT-5 series first (most likely used)
  if (modelLower.includes('gpt-5.2') || modelLower.includes('gpt-5-2')) {
    return { name: 'GPT-5.2', provider: 'OpenAI', category: 'flagship' };
  }
  if (modelLower.includes('gpt-5-nano')) {
    return { name: 'GPT-5 Nano', provider: 'OpenAI', category: 'economy' };
  }
  if (modelLower.includes('gpt-5-mini')) {
    return { name: 'GPT-5 Mini', provider: 'OpenAI', category: 'standard' };
  }
  if (modelLower.includes('gpt-5')) {
    return { name: 'GPT-5', provider: 'OpenAI', category: 'flagship' };
  }
  if (modelLower.includes('o4')) {
    return { name: 'O4 Mini', provider: 'OpenAI', category: 'reasoning' };
  }
  if (modelLower.includes('o3-pro') || modelLower.includes('o3pro')) {
    return { name: 'O3 Pro', provider: 'OpenAI', category: 'reasoning-premium' };
  }
  if (modelLower.includes('o3')) {
    if (modelLower.includes('mini')) {
      return { name: 'O3 Mini', provider: 'OpenAI', category: 'reasoning' };
    }
    return { name: 'O3', provider: 'OpenAI', category: 'reasoning' };
  }
  if (modelLower.includes('o1-pro') || modelLower.includes('o1pro')) {
    return { name: 'O1 Pro', provider: 'OpenAI', category: 'reasoning-premium' };
  }
  if (modelLower.includes('o1')) {
    if (modelLower.includes('mini')) {
      return { name: 'O1 Mini', provider: 'OpenAI', category: 'reasoning' };
    }
    return { name: 'O1', provider: 'OpenAI', category: 'reasoning' };
  }
  if (modelLower.includes('gpt-4.1') || modelLower.includes('gpt-4-1')) {
    if (modelLower.includes('nano')) {
      return { name: 'GPT-4.1 Nano', provider: 'OpenAI', category: 'economy' };
    }
    if (modelLower.includes('mini')) {
      return { name: 'GPT-4.1 Mini', provider: 'OpenAI', category: 'standard' };
    }
    return { name: 'GPT-4.1', provider: 'OpenAI', category: 'flagship' };
  }
  if (modelLower.includes('gpt-4o-mini')) {
    return { name: 'GPT-4o Mini', provider: 'OpenAI', category: 'economy' };
  }
  if (modelLower.includes('gpt-4o')) {
    return { name: 'GPT-4o', provider: 'OpenAI', category: 'standard' };
  }
  if (modelLower.includes('gpt-4-turbo')) {
    return { name: 'GPT-4 Turbo', provider: 'OpenAI', category: 'premium' };
  }
  if (modelLower.includes('gpt-4')) {
    return { name: 'GPT-4', provider: 'OpenAI', category: 'legacy' };
  }
  if (modelLower.includes('gpt-3.5')) {
    return { name: 'GPT-3.5 Turbo', provider: 'OpenAI', category: 'legacy' };
  }

  // Claude models - 4.5 series first
  if (modelLower.includes('opus-4.5') || modelLower.includes('opus-4-5') || modelLower.includes('4.5-opus') || modelLower.includes('4-5-opus')) {
    return { name: 'Claude Opus 4.5', provider: 'Anthropic', category: 'premium' };
  }
  if (modelLower.includes('sonnet-4.5') || modelLower.includes('sonnet-4-5') || modelLower.includes('4.5-sonnet') || modelLower.includes('4-5-sonnet')) {
    return { name: 'Claude Sonnet 4.5', provider: 'Anthropic', category: 'flagship' };
  }
  if (modelLower.includes('haiku-4') || modelLower.includes('4-haiku')) {
    return { name: 'Claude Haiku 4', provider: 'Anthropic', category: 'economy' };
  }
  if (modelLower.includes('opus-4') || modelLower.includes('claude-4-opus')) {
    return { name: 'Claude Opus 4', provider: 'Anthropic', category: 'premium' };
  }
  if (modelLower.includes('sonnet-4') || modelLower.includes('claude-4-sonnet')) {
    return { name: 'Claude Sonnet 4', provider: 'Anthropic', category: 'flagship' };
  }
  if (modelLower.includes('claude-3-5-sonnet') || modelLower.includes('claude-3.5-sonnet')) {
    return { name: 'Claude 3.5 Sonnet', provider: 'Anthropic', category: 'standard' };
  }
  if (modelLower.includes('claude-3-5-haiku') || modelLower.includes('claude-3.5-haiku')) {
    return { name: 'Claude 3.5 Haiku', provider: 'Anthropic', category: 'economy' };
  }
  if (modelLower.includes('claude-3-opus')) {
    return { name: 'Claude 3 Opus', provider: 'Anthropic', category: 'legacy' };
  }
  if (modelLower.includes('claude-3-sonnet')) {
    return { name: 'Claude 3 Sonnet', provider: 'Anthropic', category: 'legacy' };
  }
  if (modelLower.includes('claude-3-haiku')) {
    return { name: 'Claude 3 Haiku', provider: 'Anthropic', category: 'economy' };
  }
  if (modelLower.includes('claude-instant')) {
    return { name: 'Claude Instant', provider: 'Anthropic', category: 'legacy' };
  }
  if (modelLower.includes('claude-2')) {
    return { name: 'Claude 2', provider: 'Anthropic', category: 'legacy' };
  }

  // Gemini models - 3 series first
  if (modelLower.includes('gemini-3-pro') || modelLower.includes('gemini-3.0-pro')) {
    return { name: 'Gemini 3 Pro', provider: 'Google', category: 'premium' };
  }
  if (modelLower.includes('gemini-3') || modelLower.includes('gemini-3.0')) {
    return { name: 'Gemini 3 Flash', provider: 'Google', category: 'flagship' };
  }
  if (modelLower.includes('gemini-2.5-pro') || modelLower.includes('gemini-2-5-pro')) {
    return { name: 'Gemini 2.5 Pro', provider: 'Google', category: 'standard' };
  }
  if (modelLower.includes('gemini-2.5-flash') || modelLower.includes('gemini-2-5-flash')) {
    return { name: 'Gemini 2.5 Flash', provider: 'Google', category: 'standard' };
  }
  if (modelLower.includes('gemini-2.0')) {
    return { name: 'Gemini 2.0 Flash', provider: 'Google', category: 'economy' };
  }
  if (modelLower.includes('gemini-1.5-pro')) {
    return { name: 'Gemini 1.5 Pro', provider: 'Google', category: 'economy' };
  }
  if (modelLower.includes('gemini-1.5-flash-8b')) {
    return { name: 'Gemini 1.5 Flash 8B', provider: 'Google', category: 'economy' };
  }
  if (modelLower.includes('gemini-1.5-flash')) {
    return { name: 'Gemini 1.5 Flash', provider: 'Google', category: 'economy' };
  }
  if (modelLower.includes('gemini-pro')) {
    return { name: 'Gemini Pro', provider: 'Google', category: 'legacy' };
  }

  return { name: model, provider: 'Unknown', category: 'standard' };
}

/**
 * Get all available models grouped by provider
 */
export function getAvailableModels() {
  return {
    openai: [
      { id: 'gpt-5.2', name: 'GPT-5.2 (Latest)', category: 'flagship' },
      { id: 'gpt-5', name: 'GPT-5', category: 'flagship' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', category: 'standard' },
      { id: 'gpt-5-nano', name: 'GPT-5 Nano', category: 'economy' },
      { id: 'gpt-4o', name: 'GPT-4o', category: 'standard' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', category: 'economy' },
      { id: 'o4-mini', name: 'O4 Mini (Reasoning)', category: 'reasoning' },
      { id: 'o3', name: 'O3 (Reasoning)', category: 'reasoning' },
      { id: 'o3-pro', name: 'O3 Pro', category: 'reasoning-premium' },
      { id: 'o1', name: 'O1 (Reasoning)', category: 'reasoning' },
      { id: 'o1-pro', name: 'O1 Pro', category: 'reasoning-premium' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', category: 'legacy' }
    ],
    anthropic: [
      { id: 'claude-opus-4.5', name: 'Claude Opus 4.5 (Most Capable)', category: 'premium' },
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5 (Latest)', category: 'flagship' },
      { id: 'claude-opus-4', name: 'Claude Opus 4', category: 'premium' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', category: 'flagship' },
      { id: 'claude-haiku-4', name: 'Claude Haiku 4', category: 'economy' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', category: 'standard' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', category: 'economy' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', category: 'economy' }
    ],
    google: [
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash (Latest)', category: 'flagship' },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro', category: 'premium' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', category: 'standard' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', category: 'standard' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', category: 'economy' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', category: 'economy' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', category: 'economy' }
    ]
  };
}

/**
 * Get the markup multiplier
 */
export function getMarkup() {
  return MARKUP;
}

export default {
  MODEL_PRICING,
  MARKUP,
  getModelPricing,
  calculateTokenCost,
  estimateTokenValue,
  dollarsToTokens,
  getModelInfo,
  getAvailableModels,
  getMarkup,
  TOKEN_PACKAGE_RATE
};
