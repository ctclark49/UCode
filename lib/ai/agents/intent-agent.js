/**
 * Intent Agent - Request Classification and Routing
 *
 * The Intent Agent is the FIRST step in the multi-agent pipeline.
 * It analyzes the user's request to determine:
 *
 * 1. Intent Type - What kind of request is this?
 *    - question: User asking for information
 *    - explanation: User wants code explained
 *    - small_edit: Single file, minor change
 *    - bug_fix: Fix an identified bug
 *    - new_feature: Build something new
 *    - multi_file: Changes across multiple files
 *    - architecture: System design decisions
 *    - continuation: Continue previous work
 *
 * 2. Pipeline Routing - How should we process this?
 *    - Direct response (no pipeline needed)
 *    - Simplified pipeline (skip architect)
 *    - Full pipeline (intent → planner → architect → coder)
 *
 * 3. Context Extraction - What's relevant?
 *    - Files mentioned
 *    - Technologies/frameworks
 *    - Constraints or requirements
 *
 * This agent uses the fastest model (Haiku 4.5) for all tiers since
 * classification is a lightweight task. Accuracy > capability here.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  MODELS,
  AGENTS,
  INTENT_TYPES,
  getModelForAgent,
  getPipelineConfig,
} from '../agent-config.js';

// Anthropic client - lazy initialized
let anthropicClient = null;

function getClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

/**
 * Intent classification schema for structured output
 */
const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intentType: {
      type: 'string',
      enum: Object.values(INTENT_TYPES),
      description: 'The classified intent type',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence score (0-1)',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of why this intent was chosen',
    },
    extractedContext: {
      type: 'object',
      properties: {
        mentionedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files mentioned in the request',
        },
        technologies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Technologies/frameworks mentioned (React, Node, etc)',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Any constraints or requirements mentioned',
        },
        targetScope: {
          type: 'string',
          enum: ['single_file', 'multiple_files', 'entire_project', 'unknown'],
          description: 'Estimated scope of changes',
        },
      },
    },
    dataRequirements: {
      type: 'object',
      properties: {
        needsDatabase: {
          type: 'boolean',
          description: 'Whether this request requires database storage/queries',
        },
        detectedEntities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Data entities detected (e.g., "users", "products", "orders")',
        },
        suggestedTables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
            },
          },
          description: 'Suggested database tables with field names',
        },
      },
      description: 'Database and data storage requirements',
    },
    scaffoldsNeeded: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['auth', 'payments', 'analytics', 'email', 'storage', 'api', 'realtime'],
      },
      description: 'Pre-built scaffolds/integrations needed (auth, payments, etc)',
    },
    externalServices: {
      type: 'array',
      items: { type: 'string' },
      description: 'External services mentioned or needed (Stripe, Supabase, Firebase, etc)',
    },
    suggestedApproach: {
      type: 'string',
      description: 'Brief suggestion for how to handle this request',
    },
    requiresCodeGeneration: {
      type: 'boolean',
      description: 'Whether this request needs code to be written/modified',
    },
    complexity: {
      type: 'string',
      enum: ['trivial', 'simple', 'moderate', 'complex', 'very_complex'],
      description: 'Estimated complexity of the task',
    },
  },
  required: ['intentType', 'confidence', 'requiresCodeGeneration'],
};

/**
 * Create a default classification when parsing fails or no response
 * @param {string} reason - Why we're using the default
 * @returns {Object} - Safe default classification
 */
function createDefaultClassification(reason) {
  return {
    intentType: INTENT_TYPES.UNKNOWN,
    confidence: 0.5,
    reasoning: reason || 'Using default classification',
    requiresCodeGeneration: true,
    complexity: 'moderate',
    extractedContext: {
      mentionedFiles: [],
      technologies: [],
      constraints: [],
      targetScope: 'unknown',
    },
  };
}

/**
 * System prompt for the Intent Agent
 */
const INTENT_SYSTEM_PROMPT = `You are an Intent Classification Agent for a code generation system.

Your job is to analyze user requests and classify them accurately so the system can route them efficiently.

INTENT TYPES:
- question: User is asking for information or help understanding something (no code changes needed)
- explanation: User wants existing code explained or documented
- clarification: User needs something clarified before proceeding
- small_edit: Minor change to a single file (rename, add parameter, fix typo, etc)
- bug_fix: User identified a specific bug that needs fixing
- refactor: Improve existing code without changing functionality
- new_feature: Build something new (component, function, page, etc)
- multi_file: Changes that span multiple files
- architecture: System design, database schema, API design decisions
- continuation: User wants to continue from where they left off
- unknown: Cannot determine intent (default to full pipeline)

CLASSIFICATION RULES:
1. Questions that don't require code changes → question
2. "Explain this code" or "What does X do?" → explanation
3. Single file changes with clear scope → small_edit
4. "Fix the bug where..." with specific issue → bug_fix
5. "Add a new X" or "Create a Y" → new_feature
6. "Update all files to..." or changes to multiple components → multi_file
7. Database, API, auth system design → architecture
8. "Continue", "Keep going", "What's next" → continuation

DATABASE DETECTION - Set dataRequirements.needsDatabase=true when you see:
- Words like: "store", "save", "track", "persist", "list of", "history", "records"
- Features like: "user accounts", "orders", "inventory", "messages", "comments"
- Patterns like: "remember", "keep track of", "save for later", "log"
- Also detect entities (users, products, tasks, etc.) and suggest table schemas

SCAFFOLD DETECTION - Identify scaffoldsNeeded from these patterns:
- auth: "login", "signup", "authentication", "user accounts", "password", "OAuth"
- payments: "checkout", "payment", "subscription", "billing", "Stripe", "purchase"
- analytics: "analytics", "tracking", "metrics", "usage", "statistics", "dashboard"
- email: "email", "notification", "newsletter", "send mail", "confirm email"
- storage: "upload", "file", "image", "media", "S3", "storage"
- api: "API", "endpoint", "REST", "backend", "server"
- realtime: "realtime", "live", "websocket", "push notification", "sync"

EXTERNAL SERVICES - Detect mentions of:
- Stripe, PayPal, Square (payments)
- Supabase, Firebase, MongoDB, PostgreSQL (database)
- Auth0, Clerk, NextAuth (authentication)
- AWS, GCP, Vercel, Cloudflare (infrastructure)
- SendGrid, Resend, Mailgun (email)
- Twilio, OpenAI, Anthropic (APIs)

COMPLEXITY LEVELS:
- trivial: 1-2 line changes, obvious solution
- simple: Single function or small component
- moderate: Multiple functions, some planning needed
- complex: Multi-file, requires architecture thinking
- very_complex: Major feature, system-wide impact

Be accurate but fast. When uncertain, lean toward requiring more pipeline steps rather than fewer.
IMPORTANT: Always analyze for database needs, scaffolds, and external services - this helps downstream agents.`;

/**
 * Classify the user's intent
 *
 * @param {Object} options - Classification options
 * @param {string} options.userMessage - The user's message to classify
 * @param {Array} options.conversationHistory - Previous messages for context
 * @param {Object} options.existingFiles - Map of filename -> content (for context)
 * @param {string} options.tier - User's subscription tier
 * @param {string} options.mode - Current AI mode
 * @returns {Promise<Object>} - Classification result
 */
export async function classifyIntent(options) {
  const {
    userMessage,
    conversationHistory = [],
    existingFiles = {},
    tier = 'free',
    mode = 'standard',
  } = options;

  const client = getClient();
  const model = getModelForAgent(tier, mode, AGENTS.INTENT);

  // Build context about existing files with content previews for key files
  const fileList = Object.keys(existingFiles);
  const keyFilePatterns = ['package.json', 'App.jsx', 'App.tsx', 'index.html', 'main.jsx', 'main.tsx', 'index.js', 'index.ts'];

  let fileContext = '';
  if (fileList.length > 0) {
    const keyFilePreviews = [];
    const otherFiles = [];

    for (const [path, content] of Object.entries(existingFiles)) {
      const isKeyFile = keyFilePatterns.some(pattern => path.endsWith(pattern));
      if (isKeyFile && content) {
        // Include first 40 lines of key files for better context
        const preview = content.split('\n').slice(0, 40).join('\n');
        keyFilePreviews.push(`--- ${path} ---\n${preview}\n${content.split('\n').length > 40 ? '... (truncated)' : ''}`);
      } else {
        otherFiles.push(path);
      }
    }

    fileContext = `\n\nEXISTING PROJECT FILES (${fileList.length} files):`;
    if (keyFilePreviews.length > 0) {
      fileContext += `\n\nKEY FILE CONTENTS:\n${keyFilePreviews.join('\n\n')}`;
    }
    if (otherFiles.length > 0) {
      fileContext += `\n\nOTHER FILES:\n${otherFiles.slice(0, 20).join('\n')}${otherFiles.length > 20 ? `\n... and ${otherFiles.length - 20} more` : ''}`;
    }
  } else {
    fileContext = '\n\nNo existing project files.';
  }

  // Build conversation context (last 5 messages for efficiency)
  const recentHistory = conversationHistory.slice(-5);
  const historyContext = recentHistory.length > 0
    ? `\n\nRECENT CONVERSATION:\n${recentHistory.map(m => `${m.role}: ${m.content?.slice(0, 200)}...`).join('\n')}`
    : '';

  const userPrompt = `Classify the following user request:

USER REQUEST:
"${userMessage}"
${fileContext}
${historyContext}

Analyze this request and provide a structured classification. Return valid JSON matching the schema.`;

  try {
    const startTime = Date.now();

    // INDUSTRY BEST PRACTICE: Use tool calling for structured output
    // This eliminates fragile JSON parsing from text responses
    const intentClassificationTool = {
      name: 'classify_intent',
      description: 'Classify the user intent and return structured analysis',
      input_schema: INTENT_SCHEMA,
    };

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: INTENT_SYSTEM_PROMPT,
      tools: [intentClassificationTool],
      tool_choice: { type: 'tool', name: 'classify_intent' },
      messages: [
        { role: 'user', content: userPrompt }
      ],
    });

    const duration = Date.now() - startTime;

    // Extract classification directly from tool use - NO PARSING NEEDED
    let classification;
    const toolUse = response.content.find(c => c.type === 'tool_use');

    if (toolUse && toolUse.input) {
      // Tool calling returns structured data directly
      classification = toolUse.input;
      console.log('[IntentAgent] Got structured classification via tool calling');
    } else {
      // Fallback: try to extract from text response (legacy support)
      const textContent = response.content.find(c => c.type === 'text');
      if (textContent) {
        try {
          const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            classification = JSON.parse(jsonMatch[0]);
            console.log('[IntentAgent] Fallback: parsed JSON from text response');
          }
        } catch (parseError) {
          console.warn('[IntentAgent] Fallback parsing failed:', parseError.message);
        }
      }

      // If still no classification, use safe default
      if (!classification) {
        console.error('[IntentAgent] No tool use or parseable text in response');
        classification = createDefaultClassification('No valid response from model');
      }
    }

    // Get pipeline configuration based on intent
    const pipelineConfig = getPipelineConfig(classification.intentType);

    // Calculate token usage
    const usage = response.usage || {};

    console.log(`[IntentAgent] Classified as "${classification.intentType}" (${(classification.confidence * 100).toFixed(0)}% confidence) in ${duration}ms`);

    return {
      success: true,
      classification,
      pipelineConfig,
      model,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      duration,
    };
  } catch (error) {
    console.error('[IntentAgent] Classification error:', error);

    // Return safe default on error
    return {
      success: false,
      error: error.message,
      classification: {
        intentType: INTENT_TYPES.UNKNOWN,
        confidence: 0,
        reasoning: `Classification failed: ${error.message}`,
        requiresCodeGeneration: true,
        complexity: 'moderate',
      },
      pipelineConfig: getPipelineConfig(INTENT_TYPES.UNKNOWN),
      model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      duration: 0,
    };
  }
}

/**
 * Quick pattern-based intent detection (no AI needed)
 * CONSERVATIVE: Only used for truly trivial cases to avoid misclassification
 * Any request with potential complexity goes to AI for proper analysis
 *
 * @param {string} message - User message
 * @returns {Object|null} - Quick classification or null if AI needed
 */
export function quickIntentDetection(message) {
  if (!message) return null;

  const lower = message.toLowerCase().trim();

  // Skip quick detection for anything that might need database/scaffold/service detection
  // These patterns indicate complexity that AI should analyze
  const needsAIAnalysis = [
    // Database indicators
    /\b(store|save|track|persist|database|db|table|record|history|list of|remember)\b/i,
    // Auth indicators
    /\b(login|signup|sign up|auth|account|password|user)\b/i,
    // Payment indicators
    /\b(payment|checkout|stripe|pay|subscription|billing|purchase)\b/i,
    // External service indicators
    /\b(supabase|firebase|mongodb|postgres|api|backend|server)\b/i,
    // Feature indicators
    /\b(feature|component|page|function|system|app|application)\b/i,
  ];

  for (const pattern of needsAIAnalysis) {
    if (pattern.test(lower)) {
      return null; // Let AI analyze properly
    }
  }

  // ONLY handle truly trivial continuation patterns
  const trivialContinuationPatterns = [
    /^(continue|keep going|next|proceed|go on|carry on)\.?$/i,
    /^(ok|okay|yes|yep|sure|go ahead)\.?$/i,
  ];

  for (const pattern of trivialContinuationPatterns) {
    if (pattern.test(lower)) {
      return {
        intentType: INTENT_TYPES.CONTINUATION,
        confidence: 0.95,
        reasoning: 'Detected simple continuation request',
        requiresCodeGeneration: true,
        complexity: 'unknown',
        pipelineConfig: getPipelineConfig(INTENT_TYPES.CONTINUATION),
      };
    }
  }

  // Everything else goes to AI for proper classification with full schema analysis
  return null;
}

/**
 * Full intent classification with quick detection fallback
 *
 * @param {Object} options - Same as classifyIntent
 * @returns {Promise<Object>} - Classification result
 */
export async function getIntent(options) {
  const { userMessage } = options;

  // Try quick detection first (saves ~500 tokens)
  const quickResult = quickIntentDetection(userMessage);
  if (quickResult) {
    console.log(`[IntentAgent] Quick detection: ${quickResult.intentType}`);
    return {
      success: true,
      classification: quickResult,
      pipelineConfig: quickResult.pipelineConfig,
      model: 'quick_pattern_match',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      duration: 0,
      quickDetection: true,
    };
  }

  // Fall back to AI classification
  return classifyIntent(options);
}

/**
 * Should we skip the pipeline entirely and respond directly?
 *
 * @param {Object} classification - The intent classification
 * @returns {boolean}
 */
export function shouldSkipPipeline(classification) {
  const config = classification.pipelineConfig || getPipelineConfig(classification.intentType);
  return config.skipPipeline === true || config.directResponse === true;
}

/**
 * Should we skip the Architect agent?
 *
 * @param {Object} classification - The intent classification
 * @returns {boolean}
 */
export function shouldSkipArchitect(classification) {
  const config = classification.pipelineConfig || getPipelineConfig(classification.intentType);
  return config.skipArchitect === true;
}

export default {
  classifyIntent,
  quickIntentDetection,
  getIntent,
  shouldSkipPipeline,
  shouldSkipArchitect,
  INTENT_TYPES,
};
