/**
 * Agent Configuration - Centralized AI Model & Tier Configuration
 *
 * This is the single source of truth for:
 * - Model constants and identifiers
 * - Tier-based model selection per agent
 * - Mode configurations (Standard, Deep Think, Max)
 * - Intent classification types
 * - Escalation triggers for intelligent model upgrades
 *
 * Architecture Overview:
 * ----------------------
 * All tiers get the FULL pipeline: Intent → Planner → Architect → Coder
 *
 * The difference is which MODELS power each agent:
 *
 * FREE TIER:
 *   - All agents use Haiku 4.5 (fast, cost-effective)
 *   - Full capabilities, just lighter models
 *
 * PRO TIER:
 *   - Standard Mode: Haiku 4.5 (planning) → Sonnet 4 (coding)
 *   - Deep Think Mode: Opus (planning) → Sonnet 4.5 (coding)
 *   - Toggle available in UI
 *
 * BUSINESS TIER:
 *   - Standard Mode: Opus (planning) → Sonnet 4.5 (coding)
 *   - Intelligent Escalation: Opus Planner can flag tasks needing Opus Coder
 *   - Max Mode: All Opus (manual toggle for complex tasks)
 *
 * ENTERPRISE TIER:
 *   - All Opus with priority processing
 *   - Custom model selection available
 */

// =============================================================================
// MODEL CONSTANTS
// =============================================================================

export const MODELS = {
  // Haiku 4.5 - Fast, efficient for routing and simple tasks (FREE tier only)
  HAIKU_4_5: 'claude-haiku-4-5-20251001',

  // Sonnet 4 - Balanced performance (legacy, rarely used)
  SONNET_4: 'claude-sonnet-4-20250514',

  // Sonnet 4.5 - Enhanced coding with better reasoning (default for paid tiers)
  SONNET_4_5: 'claude-sonnet-4-5-20250929',

  // Opus 4 - Complex planning (legacy)
  OPUS_4: 'claude-opus-4-20250514',

  // Opus 4.5 - Most capable for complex planning and coding
  OPUS_4_5: 'claude-opus-4-5-20251101',
};

// Model capabilities for intelligent selection
export const MODEL_CAPABILITIES = {
  [MODELS.HAIKU_4_5]: {
    name: 'Haiku 4.5',
    strengths: ['fast routing', 'simple tasks', 'quick iterations'],
    contextWindow: 200000,
    costTier: 'low',
    inputCostPer1M: 0.80,
    outputCostPer1M: 4.00,
  },
  [MODELS.SONNET_4]: {
    name: 'Sonnet 4',
    strengths: ['balanced coding', 'good reasoning', 'tool use'],
    contextWindow: 200000,
    costTier: 'medium',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
  },
  [MODELS.SONNET_4_5]: {
    name: 'Sonnet 4.5',
    strengths: ['advanced coding', 'complex reasoning', 'multi-file changes'],
    contextWindow: 200000,
    costTier: 'medium-high',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
  },
  [MODELS.OPUS_4]: {
    name: 'Opus 4',
    strengths: ['complex planning', 'architecture design', 'nuanced reasoning'],
    contextWindow: 200000,
    costTier: 'high',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
  },
  [MODELS.OPUS_4_5]: {
    name: 'Opus 4.5',
    strengths: ['most capable', 'complex planning', 'architecture design', 'nuanced reasoning', 'extended thinking'],
    contextWindow: 200000,
    costTier: 'highest',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
  },
};

// =============================================================================
// TIER DEFINITIONS
// =============================================================================

export const TIERS = {
  FREE: 'free',
  PRO: 'pro',
  BUSINESS: 'business',
  ENTERPRISE: 'enterprise',
};

// Normalize tier names from various sources
export function normalizeTierName(tier) {
  if (!tier) return TIERS.FREE;
  const normalized = String(tier).toLowerCase().trim();

  const tierMap = {
    'free': TIERS.FREE,
    'starter': TIERS.FREE,
    'basic': TIERS.FREE,
    'pro': TIERS.PRO,
    'creator': TIERS.PRO,
    'professional': TIERS.PRO,
    'business': TIERS.BUSINESS,
    'team': TIERS.BUSINESS,
    'enterprise': TIERS.ENTERPRISE,
    'unlimited': TIERS.ENTERPRISE,
  };

  return tierMap[normalized] || TIERS.FREE;
}

// =============================================================================
// AI MODES
// =============================================================================

export const AI_MODES = {
  STANDARD: 'standard',
  DEEP_THINK: 'deep_think',
  MAX: 'max',
};

// Mode availability by tier
export const MODE_AVAILABILITY = {
  [TIERS.FREE]: [AI_MODES.STANDARD],
  [TIERS.PRO]: [AI_MODES.STANDARD, AI_MODES.DEEP_THINK],
  [TIERS.BUSINESS]: [AI_MODES.STANDARD, AI_MODES.MAX],
  [TIERS.ENTERPRISE]: [AI_MODES.STANDARD, AI_MODES.DEEP_THINK, AI_MODES.MAX],
};

// =============================================================================
// AGENT TYPES
// =============================================================================

export const AGENTS = {
  INTENT: 'intent',
  PLANNER: 'planner',
  ARCHITECT: 'architect',
  CODER: 'coder',
};

// =============================================================================
// TIER-BASED MODEL CONFIGURATION
// =============================================================================

/**
 * Model selection per agent, per tier, per mode
 *
 * Structure: TIER_AGENT_CONFIG[tier][mode][agent] = model
 */
export const TIER_AGENT_CONFIG = {
  // FREE TIER - All Haiku 4.5 (full pipeline, efficient models)
  [TIERS.FREE]: {
    [AI_MODES.STANDARD]: {
      [AGENTS.INTENT]: MODELS.HAIKU_4_5,
      [AGENTS.PLANNER]: MODELS.HAIKU_4_5,
      [AGENTS.ARCHITECT]: MODELS.HAIKU_4_5,
      [AGENTS.CODER]: MODELS.HAIKU_4_5,
    },
  },

  // PRO TIER - Sonnet 4.5 for all agents
  [TIERS.PRO]: {
    // Standard: All Sonnet 4.5
    [AI_MODES.STANDARD]: {
      [AGENTS.INTENT]: MODELS.SONNET_4_5,
      [AGENTS.PLANNER]: MODELS.SONNET_4_5,
      [AGENTS.ARCHITECT]: MODELS.SONNET_4_5,
      [AGENTS.CODER]: MODELS.SONNET_4_5,
    },
    // Deep Think: Opus 4.5 planning → Sonnet 4.5 coding
    [AI_MODES.DEEP_THINK]: {
      [AGENTS.INTENT]: MODELS.SONNET_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.SONNET_4_5,
    },
  },

  // BUSINESS TIER - Opus 4.5 planning, Sonnet 4.5 coding
  [TIERS.BUSINESS]: {
    // Standard: Opus 4.5 planning → Sonnet 4.5 coding (with intelligent escalation)
    [AI_MODES.STANDARD]: {
      [AGENTS.INTENT]: MODELS.SONNET_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.SONNET_4_5,
      // Flag: Planner can escalate individual tasks to Opus Coder
      allowEscalation: true,
      escalatedCoder: MODELS.OPUS_4_5,
    },
    // Max Mode: All Opus 4.5
    [AI_MODES.MAX]: {
      [AGENTS.INTENT]: MODELS.OPUS_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.OPUS_4_5,
    },
  },

  // ENTERPRISE TIER - All Opus 4.5 always
  [TIERS.ENTERPRISE]: {
    [AI_MODES.STANDARD]: {
      [AGENTS.INTENT]: MODELS.OPUS_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.OPUS_4_5,
    },
    [AI_MODES.DEEP_THINK]: {
      [AGENTS.INTENT]: MODELS.OPUS_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.OPUS_4_5,
    },
    [AI_MODES.MAX]: {
      [AGENTS.INTENT]: MODELS.OPUS_4_5,
      [AGENTS.PLANNER]: MODELS.OPUS_4_5,
      [AGENTS.ARCHITECT]: MODELS.OPUS_4_5,
      [AGENTS.CODER]: MODELS.OPUS_4_5,
    },
  },
};

// =============================================================================
// INTENT CLASSIFICATION
// =============================================================================

export const INTENT_TYPES = {
  // Simple - Can be handled directly without full pipeline
  QUESTION: 'question',           // User asking for information
  EXPLANATION: 'explanation',     // User wants code explained
  CLARIFICATION: 'clarification', // User needs something clarified

  // Medium - Requires some planning
  SMALL_EDIT: 'small_edit',       // Single file, minor change
  BUG_FIX: 'bug_fix',             // Fix an identified bug
  REFACTOR: 'refactor',           // Improve existing code

  // Complex - Requires full pipeline
  NEW_FEATURE: 'new_feature',     // Build something new
  MULTI_FILE: 'multi_file',       // Changes across multiple files
  ARCHITECTURE: 'architecture',   // System design decisions

  // Special
  CONTINUATION: 'continuation',   // Continue previous work
  UNKNOWN: 'unknown',             // Couldn't classify
};

// Intent to pipeline mapping
export const INTENT_PIPELINE_MAP = {
  // Direct response - no pipeline needed
  [INTENT_TYPES.QUESTION]: { skipPipeline: true, directResponse: true },
  [INTENT_TYPES.EXPLANATION]: { skipPipeline: true, directResponse: true },
  [INTENT_TYPES.CLARIFICATION]: { skipPipeline: true, directResponse: true },

  // Simplified pipeline - skip architect
  [INTENT_TYPES.SMALL_EDIT]: { skipArchitect: true },
  [INTENT_TYPES.BUG_FIX]: { skipArchitect: true },

  // Full pipeline
  [INTENT_TYPES.REFACTOR]: { fullPipeline: true },
  [INTENT_TYPES.NEW_FEATURE]: { fullPipeline: true },
  [INTENT_TYPES.MULTI_FILE]: { fullPipeline: true },
  [INTENT_TYPES.ARCHITECTURE]: { fullPipeline: true },

  // Special handling
  [INTENT_TYPES.CONTINUATION]: { resumePrevious: true },
  [INTENT_TYPES.UNKNOWN]: { fullPipeline: true }, // Default to full for safety
};

// =============================================================================
// ESCALATION TRIGGERS
// =============================================================================

/**
 * Patterns that indicate a task should be escalated to a more capable model
 * Used by Business tier's "intelligent escalation" feature
 */
export const ESCALATION_TRIGGERS = {
  // Complexity indicators
  complexity: [
    'complex algorithm',
    'performance critical',
    'security sensitive',
    'cryptograph',
    'concurrent',
    'parallel processing',
    'state machine',
    'recursive',
    'optimization',
  ],

  // Architecture indicators
  architecture: [
    'system design',
    'database schema',
    'api design',
    'authentication flow',
    'authorization',
    'microservice',
    'event sourcing',
    'cqrs',
  ],

  // Scale indicators
  scale: [
    'multiple files',
    'across components',
    'refactor entire',
    'migrate',
    'upgrade',
    'rewrite',
  ],

  // Risk indicators
  risk: [
    'production',
    'critical path',
    'financial',
    'user data',
    'pii',
    'gdpr',
    'compliance',
  ],
};

/**
 * Check if a task description triggers escalation
 * @param {string} taskDescription - The task to check
 * @returns {boolean} - Whether to escalate
 */
export function shouldEscalate(taskDescription) {
  if (!taskDescription) return false;
  const lower = taskDescription.toLowerCase();

  for (const category of Object.values(ESCALATION_TRIGGERS)) {
    for (const trigger of category) {
      if (lower.includes(trigger)) {
        return true;
      }
    }
  }

  return false;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the model for a specific agent given tier and mode
 *
 * @param {string} tier - User's subscription tier
 * @param {string} mode - Current AI mode (standard, deep_think, max)
 * @param {string} agent - Agent type (intent, planner, architect, coder)
 * @returns {string} - Model identifier
 */
export function getModelForAgent(tier, mode, agent) {
  const normalizedTier = normalizeTierName(tier);
  const normalizedMode = mode || AI_MODES.STANDARD;

  // Get tier config
  const tierConfig = TIER_AGENT_CONFIG[normalizedTier];
  if (!tierConfig) {
    console.warn(`[AgentConfig] Unknown tier: ${tier}, falling back to FREE`);
    return TIER_AGENT_CONFIG[TIERS.FREE][AI_MODES.STANDARD][agent];
  }

  // Get mode config
  const modeConfig = tierConfig[normalizedMode] || tierConfig[AI_MODES.STANDARD];
  if (!modeConfig) {
    console.warn(`[AgentConfig] Unknown mode: ${mode} for tier: ${normalizedTier}, falling back to STANDARD`);
    return tierConfig[AI_MODES.STANDARD][agent];
  }

  // Get agent model
  const model = modeConfig[agent];
  if (!model) {
    console.warn(`[AgentConfig] Unknown agent: ${agent}, falling back to HAIKU`);
    return MODELS.HAIKU_4_5;
  }

  return model;
}

/**
 * Get full agent configuration for a tier and mode
 *
 * @param {string} tier - User's subscription tier
 * @param {string} mode - Current AI mode
 * @returns {Object} - Full configuration object
 */
export function getAgentConfig(tier, mode) {
  const normalizedTier = normalizeTierName(tier);
  const normalizedMode = mode || AI_MODES.STANDARD;

  const tierConfig = TIER_AGENT_CONFIG[normalizedTier] || TIER_AGENT_CONFIG[TIERS.FREE];
  const modeConfig = tierConfig[normalizedMode] || tierConfig[AI_MODES.STANDARD];

  return {
    tier: normalizedTier,
    mode: normalizedMode,
    models: {
      intent: modeConfig[AGENTS.INTENT],
      planner: modeConfig[AGENTS.PLANNER],
      architect: modeConfig[AGENTS.ARCHITECT],
      coder: modeConfig[AGENTS.CODER],
    },
    allowEscalation: modeConfig.allowEscalation || false,
    escalatedCoder: modeConfig.escalatedCoder || null,
    availableModes: MODE_AVAILABILITY[normalizedTier] || [AI_MODES.STANDARD],
  };
}

/**
 * Get available modes for a tier
 *
 * @param {string} tier - User's subscription tier
 * @returns {string[]} - Array of available mode names
 */
export function getAvailableModes(tier) {
  const normalizedTier = normalizeTierName(tier);
  return MODE_AVAILABILITY[normalizedTier] || [AI_MODES.STANDARD];
}

/**
 * Check if a mode is available for a tier
 *
 * @param {string} tier - User's subscription tier
 * @param {string} mode - Mode to check
 * @returns {boolean}
 */
export function isModeAvailable(tier, mode) {
  const availableModes = getAvailableModes(tier);
  return availableModes.includes(mode);
}

/**
 * Get pipeline configuration based on intent
 *
 * @param {string} intentType - The classified intent type
 * @returns {Object} - Pipeline configuration
 */
export function getPipelineConfig(intentType) {
  return INTENT_PIPELINE_MAP[intentType] || INTENT_PIPELINE_MAP[INTENT_TYPES.UNKNOWN];
}

// =============================================================================
// TOKEN LIMITS (for reference - actual enforcement in middleware)
// =============================================================================

export const TOKEN_LIMITS = {
  [TIERS.FREE]: {
    daily: 7500,
    monthly: 225000,
    maxPerRequest: 4000,
  },
  [TIERS.PRO]: {
    daily: null, // No daily limit
    monthly: 500000,
    maxPerRequest: 16000,
  },
  [TIERS.BUSINESS]: {
    daily: null,
    monthly: 1500000, // Reduced from 2M for profitability
    maxPerRequest: 32000,
  },
  [TIERS.ENTERPRISE]: {
    daily: null,
    monthly: null, // Unlimited
    maxPerRequest: 100000,
  },
};

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  MODELS,
  MODEL_CAPABILITIES,
  TIERS,
  AI_MODES,
  AGENTS,
  INTENT_TYPES,
  TIER_AGENT_CONFIG,
  MODE_AVAILABILITY,
  INTENT_PIPELINE_MAP,
  ESCALATION_TRIGGERS,
  TOKEN_LIMITS,
  normalizeTierName,
  getModelForAgent,
  getAgentConfig,
  getAvailableModes,
  isModeAvailable,
  getPipelineConfig,
  shouldEscalate,
};
