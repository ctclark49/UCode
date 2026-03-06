/**
 * Planner Agent - Task Decomposition and Planning
 *
 * The Planner Agent is the SECOND step in the multi-agent pipeline.
 * It takes the user's request (and intent classification) and creates
 * a structured plan for implementation.
 *
 * Responsibilities:
 * 1. Break down the request into discrete tasks
 * 2. Identify file dependencies and order
 * 3. Estimate complexity per task
 * 4. Flag tasks that may need escalation (Business tier)
 * 5. Create actionable specifications for the Coder
 *
 * Model Selection by Tier:
 * - FREE: Haiku 4.5 (fast, efficient planning)
 * - PRO Standard: Haiku 4.5
 * - PRO Deep Think: Opus 4 (thorough analysis)
 * - BUSINESS Standard: Opus 4 (with escalation flags)
 * - BUSINESS Max: Opus 4
 * - ENTERPRISE: Opus 4
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  MODELS,
  AGENTS,
  getModelForAgent,
  getAgentConfig,
  shouldEscalate,
} from '../agent-config.js';

// Import package manifest for framework preference and package validation
import {
  getAvailablePackagesForPrompt,
  isPackageAvailable,
  INSTANT_FRAMEWORKS,
  CACHED_FRAMEWORKS,
} from '../../preview/package-manifest.js';

// =============================================================================
// FRAMEWORK PREFERENCE CONFIGURATION
// =============================================================================
// Cached at module load for performance (expensive string operations)
let _cachedPackagesPrompt = null;

/**
 * Get available packages prompt (cached for performance)
 * @returns {string} Formatted string of available packages
 */
function getPackagesPromptCached() {
  if (!_cachedPackagesPrompt) {
    _cachedPackagesPrompt = getAvailablePackagesForPrompt();
  }
  return _cachedPackagesPrompt;
}

/**
 * Framework preference section for planner system prompt
 * Guides the planner to prefer instant frameworks for new projects
 */
const FRAMEWORK_PREFERENCE_SECTION = `
FRAMEWORK SELECTION (CRITICAL FOR NEW PROJECTS):
When creating a new project or the user does not specify a framework:

INSTANT FRAMEWORKS - Use these by default (<3s startup):
- vite/react: DEFAULT CHOICE for web apps, dashboards, SPAs
- vue/nuxt: Best for Vue ecosystem apps
- nextjs: Best for SSR, full-stack React, or when SEO matters

CACHED FRAMEWORKS - Only if user EXPLICITLY requests (15-25s startup):
- svelte/sveltekit: Only if user says "Svelte" or "SvelteKit"
- astro: Only if user says "Astro" or needs static site
- express: Only for API-only backends with no frontend

RULE: If user says "build me an app", "create a dashboard", "make a website"
WITHOUT specifying a framework, ALWAYS choose vite/react. It has:
- Instant startup (<3s)
- Broadest package support (200+ pre-installed)
- Best developer experience

PRE-INSTALLED PACKAGES (Do NOT list in packagesNeeded):
All packages below are already installed. Import them directly:
- AI/LLM: @anthropic-ai/sdk, openai, @google/generative-ai, ai (Vercel SDK)
- Payments: stripe, @stripe/stripe-js, @stripe/react-stripe-js
- Auth: next-auth, @clerk/nextjs, @supabase/ssr, @supabase/auth-helpers-react
- Database: @supabase/supabase-js, firebase, @prisma/client, drizzle-orm
- UI: All @radix-ui/*, lucide-react, framer-motion, @headlessui/react
- Forms: react-hook-form, @hookform/resolvers, zod, yup
- Charts: recharts, @tanstack/react-table, @tanstack/react-query
- Utils: lodash, date-fns, dayjs, uuid, nanoid, axios, clsx, tailwind-merge

Only add to packagesNeeded if a package is NOT in the pre-installed list.
`;

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
 * Task schema for structured output
 */
const TASK_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Unique task identifier' },
    title: { type: 'string', description: 'Brief task title' },
    description: { type: 'string', description: 'Detailed task description' },
    type: {
      type: 'string',
      enum: ['create_file', 'modify_file', 'delete_file', 'install_package', 'configure', 'refactor'],
      description: 'Type of task',
    },
    targetFile: { type: 'string', description: 'File path to create/modify' },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
      description: 'Task IDs this depends on',
    },
    complexity: {
      type: 'string',
      enum: ['trivial', 'simple', 'moderate', 'complex', 'very_complex'],
      description: 'Estimated complexity',
    },
    requiresEscalation: {
      type: 'boolean',
      description: 'Whether this task needs a more capable model (Business tier)',
    },
    escalationReason: {
      type: 'string',
      description: 'Why escalation is recommended (if applicable)',
    },
    specifications: {
      type: 'object',
      properties: {
        imports: { type: 'array', items: { type: 'string' } },
        exports: { type: 'array', items: { type: 'string' } },
        functions: { type: 'array', items: { type: 'string' } },
        components: { type: 'array', items: { type: 'string' } },
        styling: { type: 'string' },
        integrations: { type: 'array', items: { type: 'string' } },
      },
      description: 'Technical specifications for the Coder',
    },
  },
  required: ['id', 'title', 'description', 'type', 'complexity'],
};

/**
 * Plan schema for structured output
 */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Brief summary of the implementation plan',
    },
    approach: {
      type: 'string',
      description: 'High-level approach to solving this',
    },
    tasks: {
      type: 'array',
      items: TASK_SCHEMA,
      description: 'Ordered list of tasks to complete',
    },
    estimatedTokens: {
      type: 'number',
      description: 'Estimated total tokens for code generation',
    },
    risks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Potential risks or challenges',
    },
    packagesNeeded: {
      type: 'array',
      items: { type: 'string' },
      description: 'NPM packages that need to be installed',
    },
    hasEscalationTasks: {
      type: 'boolean',
      description: 'Whether any tasks require escalation to a more capable model',
    },
  },
  required: ['summary', 'approach', 'tasks'],
};

/**
 * System prompt for the Planner Agent
 */
const PLANNER_SYSTEM_PROMPT = `You are a Planning Agent for a code generation system. Your job is to create detailed, actionable implementation plans.

RESPONSIBILITIES:
1. Break down requests into discrete, implementable tasks
2. Order tasks by dependencies (what needs to happen first)
3. Identify files to create/modify
4. Estimate complexity accurately
5. Flag tasks that are particularly complex or risky
6. Provide clear specifications for the Coder agent

TASK TYPES:
- create_file: Create a new file from scratch
- modify_file: Edit an existing file
- delete_file: Remove a file
- install_package: Add NPM dependencies
- configure: Update configuration files
- refactor: Restructure existing code

COMPLEXITY LEVELS:
- trivial: Single line change, obvious solution
- simple: One function, clear implementation
- moderate: Multiple functions, some decisions needed
- complex: Multiple concerns, careful implementation needed
- very_complex: Architecture decisions, edge cases, security concerns

ESCALATION CRITERIA (flag requiresEscalation: true for):
- Security-sensitive code (auth, crypto, payments)
- Complex algorithms or data structures
- Performance-critical code paths
- Database migrations or schema changes
- Code that integrates with external APIs
- Multi-file refactoring with complex dependencies

PLANNING RULES:
1. Each task should be completable independently once dependencies are met
2. Task order matters - dependencies must be satisfied
3. Be specific about what goes in each file
4. Include imports/exports in specifications
5. Estimate tokens conservatively (better to over-estimate)
6. Flag risks early - better to warn than to fail
${FRAMEWORK_PREFERENCE_SECTION}
OUTPUT FORMAT:
Return a valid JSON plan matching the schema. Be thorough but efficient.`;

/**
 * Create an implementation plan
 *
 * @param {Object} options - Planning options
 * @param {string} options.userMessage - The user's original request
 * @param {Object} options.intentClassification - Classification from Intent Agent
 * @param {Object} options.existingFiles - Map of filename -> content
 * @param {Array} options.conversationHistory - Previous messages
 * @param {string} options.tier - User's subscription tier
 * @param {string} options.mode - Current AI mode
 * @param {Object} options.projectContext - Additional project context
 * @returns {Promise<Object>} - The implementation plan
 */
export async function createPlan(options) {
  const {
    userMessage,
    intentClassification = {},
    existingFiles = {},
    conversationHistory = [],
    tier = 'free',
    mode = 'standard',
    projectContext = {},
  } = options;

  const client = getClient();
  const agentConfig = getAgentConfig(tier, mode);
  const model = agentConfig.models.planner;

  // ===========================================================================
  // OPTIMIZED CONTEXT (Solution 2: Progressive Context Loading)
  // If optimized context is provided, use it instead of building from scratch
  // This reduces input tokens from ~50K to ~2K for the Planner
  // ===========================================================================
  let fileContext = '';
  const optimizedCtx = projectContext?.optimized;

  if (optimizedCtx) {
    // Use pre-computed optimized context (Solution 2)
    console.log('[PlannerAgent] Using optimized progressive context');

    const summary = optimizedCtx.summary || {};
    fileContext = `\nPROJECT STRUCTURE:\n${summary.fileTree || Object.keys(existingFiles).slice(0, 30).join('\\n')}`;

    if (summary.packageInfo?.dependencies?.length > 0) {
      fileContext += `\n\nDEPENDENCIES: ${summary.packageInfo.dependencies.join(', ')}`;
    }

    if (summary.signatures && Object.keys(summary.signatures).length > 0) {
      fileContext += `\n\nKEY FILE SIGNATURES:`;
      for (const [path, sig] of Object.entries(summary.signatures).slice(0, 8)) {
        fileContext += `\n- ${path}: exports [${sig.exports?.join(', ') || 'default'}]`;
      }
    }

    if (summary.detected) {
      fileContext += `\n\nDETECTED: ${summary.detected.framework || 'js'}, ${summary.detected.language || 'javascript'}, ${summary.detected.styling || 'css'}`;
    }
  } else {
    // Fallback: Build file context with content previews for key files
    const fileList = Object.keys(existingFiles);
    const keyFilePatterns = ['package.json', 'App.jsx', 'App.tsx', 'index.html', 'main.jsx', 'main.tsx', 'index.js', 'index.ts'];

    if (fileList.length > 0) {
      const keyFilePreviews = [];
      const otherFiles = [];

      for (const [path, content] of Object.entries(existingFiles)) {
        const isKeyFile = keyFilePatterns.some(pattern => path.endsWith(pattern));
        if (isKeyFile && content) {
          // Include first 60 lines of key files for better planning context
          const lines = content.split('\n');
          const preview = lines.slice(0, 60).join('\n');
          keyFilePreviews.push(`--- ${path} ---\n${preview}${lines.length > 60 ? '\n... (truncated)' : ''}`);
        } else {
          otherFiles.push(path);
        }
      }

      fileContext = `\nPROJECT FILES (${fileList.length} total):`;
      if (keyFilePreviews.length > 0) {
        fileContext += `\n\nKEY FILE CONTENTS:\n${keyFilePreviews.join('\n\n')}`;
      }
      if (otherFiles.length > 0) {
        fileContext += `\n\nOTHER FILES:\n${otherFiles.slice(0, 30).join('\n')}${otherFiles.length > 30 ? `\n... and ${otherFiles.length - 30} more` : ''}`;
      }
    }
  }

  // Build intent context including database/scaffold/service requirements
  let intentContext = '';
  if (intentClassification.intentType) {
    intentContext = `\nINTENT CLASSIFICATION:\n- Type: ${intentClassification.intentType}\n- Complexity: ${intentClassification.complexity || 'unknown'}\n- Scope: ${intentClassification.extractedContext?.targetScope || 'unknown'}`;

    // Add database requirements from intent agent
    if (intentClassification.dataRequirements?.needsDatabase) {
      intentContext += `\n\nDATABASE REQUIREMENTS:`;
      intentContext += `\n- Needs Database: YES`;
      if (intentClassification.dataRequirements.detectedEntities?.length > 0) {
        intentContext += `\n- Detected Entities: ${intentClassification.dataRequirements.detectedEntities.join(', ')}`;
      }
      if (intentClassification.dataRequirements.suggestedTables?.length > 0) {
        intentContext += `\n- Suggested Tables: ${intentClassification.dataRequirements.suggestedTables.map(t => t.name || t).join(', ')}`;
      }
    }

    // Add scaffold requirements from intent agent
    if (intentClassification.scaffoldsNeeded?.length > 0) {
      intentContext += `\n\nSCAFFOLDS NEEDED: ${intentClassification.scaffoldsNeeded.join(', ')}`;
    }

    // Add external services from intent agent
    if (intentClassification.externalServices?.length > 0) {
      intentContext += `\n\nEXTERNAL SERVICES: ${intentClassification.externalServices.join(', ')}`;
    }
  }

  // Build conversation context (last 3 for efficiency)
  const recentHistory = conversationHistory.slice(-3);
  const historyContext = recentHistory.length > 0
    ? `\n\nRECENT CONTEXT:\n${recentHistory.map(m => `${m.role}: ${m.content?.slice(0, 300)}...`).join('\n')}`
    : '';

  // Build project context (use detected values from optimized context if available)
  const detectedFramework = optimizedCtx?.summary?.detected?.framework;
  const detectedLanguage = optimizedCtx?.summary?.detected?.language;
  const detectedStyling = optimizedCtx?.summary?.detected?.styling;

  const projContext = projectContext.framework || detectedFramework
    ? `\nPROJECT INFO:\n- Framework: ${projectContext.framework || detectedFramework || 'JavaScript'}\n- Language: ${projectContext.language || detectedLanguage || 'JavaScript'}\n- Style: ${projectContext.styleFramework || detectedStyling || 'CSS'}`
    : '';

  const userPrompt = `Create an implementation plan for the following request:

USER REQUEST:
"${userMessage}"
${intentContext}
${fileContext}
${historyContext}
${projContext}

${agentConfig.allowEscalation ? `
IMPORTANT: This user has Business tier. You can flag tasks that would benefit from
a more capable model using "requiresEscalation": true. Flag tasks that involve:
- Security/authentication
- Complex algorithms
- Performance-critical code
- Database operations
- External API integrations
` : ''}

Create a detailed, actionable plan. Return valid JSON matching the plan schema.`;

  try {
    const startTime = Date.now();

    // INDUSTRY BEST PRACTICE: Use tool calling for structured output
    // This guarantees valid JSON - no parsing needed
    const planTool = {
      name: 'create_plan',
      description: 'Create the implementation plan with tasks',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of the implementation plan' },
          approach: { type: 'string', description: 'High-level approach to solving this' },
          tasks: {
            type: 'array',
            description: 'Ordered list of tasks to complete',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique task identifier (e.g., task_1)' },
                title: { type: 'string', description: 'Brief task title' },
                description: { type: 'string', description: 'Detailed task description' },
                type: { type: 'string', enum: ['create_file', 'modify_file', 'delete_file', 'install_package', 'configure', 'refactor'] },
                targetFile: { type: 'string', description: 'File path to create/modify' },
                complexity: { type: 'string', enum: ['trivial', 'simple', 'moderate', 'complex', 'very_complex'] },
                requiresEscalation: { type: 'boolean', description: 'Whether this task needs a more capable model' }
              },
              required: ['id', 'title', 'description', 'type', 'complexity']
            }
          },
          packagesNeeded: { type: 'array', items: { type: 'string' }, description: 'NPM packages to install' },
          estimatedTokens: { type: 'number', description: 'Estimated total tokens for code generation' }
        },
        required: ['summary', 'approach', 'tasks']
      }
    };

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: PLANNER_SYSTEM_PROMPT,
      tools: [planTool],
      tool_choice: { type: 'tool', name: 'create_plan' },
      messages: [
        { role: 'user', content: userPrompt }
      ],
    });

    const duration = Date.now() - startTime;

    // Extract plan directly from tool use - NO PARSING NEEDED
    let plan;
    const toolUse = response.content.find(c => c.type === 'tool_use');

    if (toolUse && toolUse.input) {
      // Tool use returns structured data directly
      plan = toolUse.input;
      console.log('[PlannerAgent] Got structured plan via tool use');
    } else {
      // Fallback: try to extract from text if tool use failed
      const textContent = response.content.find(c => c.type === 'text');
      if (textContent) {
        try {
          const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            plan = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          // Ignore parse errors, will use fallback below
        }
      }

      // If still no plan, create a minimal default plan
      if (!plan) {
        console.warn('[PlannerAgent] Tool use failed, creating minimal plan');
        plan = createMinimalPlan(userMessage, intentClassification);
      }
    }

    // Post-process: check for escalation triggers in task descriptions
    if (agentConfig.allowEscalation && plan.tasks) {
      let hasEscalation = false;
      for (const task of plan.tasks) {
        // Check if task description contains escalation triggers
        if (!task.requiresEscalation && shouldEscalate(task.description)) {
          task.requiresEscalation = true;
          task.escalationReason = 'Auto-detected complexity requiring advanced model';
          hasEscalation = true;
        }
        if (task.requiresEscalation) {
          hasEscalation = true;
        }
      }
      plan.hasEscalationTasks = hasEscalation;
    }

    // Post-process: Filter out pre-installed packages from packagesNeeded
    // This prevents unnecessary install tasks for packages already in the Docker image
    if (plan.packagesNeeded && Array.isArray(plan.packagesNeeded)) {
      const originalCount = plan.packagesNeeded.length;
      plan.packagesNeeded = plan.packagesNeeded.filter(pkg => {
        // Strip version specifiers for checking (e.g., "lodash@^4.17.21" -> "lodash")
        const pkgName = pkg.replace(/@[\^~]?[\d.]+.*$/, '').replace(/@.*$/, '');
        const isPreInstalled = isPackageAvailable(pkgName);
        if (isPreInstalled) {
          console.log(`[PlannerAgent] Filtered pre-installed package: ${pkg}`);
        }
        return !isPreInstalled;
      });

      if (originalCount !== plan.packagesNeeded.length) {
        console.log(`[PlannerAgent] Filtered ${originalCount - plan.packagesNeeded.length} pre-installed packages from packagesNeeded`);
      }
    }

    // Calculate token usage
    const usage = response.usage || {};

    console.log(`[PlannerAgent] Created plan with ${plan.tasks?.length || 0} tasks using ${model} in ${duration}ms`);

    return {
      success: true,
      plan,
      model,
      agentConfig,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      duration,
    };
  } catch (error) {
    console.error('[PlannerAgent] Planning error:', error);

    return {
      success: false,
      error: error.message,
      plan: null,
      model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      duration: 0,
    };
  }
}

/**
 * Refine an existing plan based on feedback
 *
 * @param {Object} options - Refinement options
 * @param {Object} options.currentPlan - The current plan
 * @param {string} options.feedback - User or system feedback
 * @param {Object} options.completedTasks - Tasks already completed
 * @param {string} options.tier - User's subscription tier
 * @param {string} options.mode - Current AI mode
 * @returns {Promise<Object>} - The refined plan
 */
export async function refinePlan(options) {
  const {
    currentPlan,
    feedback,
    completedTasks = {},
    tier = 'free',
    mode = 'standard',
  } = options;

  const client = getClient();
  const model = getModelForAgent(tier, mode, AGENTS.PLANNER);

  const userPrompt = `Refine this implementation plan based on feedback:

CURRENT PLAN:
${JSON.stringify(currentPlan, null, 2)}

COMPLETED TASKS:
${Object.keys(completedTasks).length > 0 ? JSON.stringify(completedTasks, null, 2) : 'None yet'}

FEEDBACK:
"${feedback}"

Update the plan to address the feedback. Keep completed tasks marked and adjust remaining tasks as needed.
Return the complete updated plan as valid JSON.`;

  try {
    const startTime = Date.now();

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt }
      ],
    });

    const duration = Date.now() - startTime;

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent) {
      throw new Error('No text response from Planner Agent');
    }

    let refinedPlan;
    try {
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        refinedPlan = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('[PlannerAgent] Failed to parse refined plan');
      throw new Error(`Plan refinement parsing failed: ${parseError.message}`);
    }

    const usage = response.usage || {};

    console.log(`[PlannerAgent] Refined plan with ${refinedPlan.tasks?.length || 0} tasks in ${duration}ms`);

    return {
      success: true,
      plan: refinedPlan,
      model,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      duration,
    };
  } catch (error) {
    console.error('[PlannerAgent] Refinement error:', error);

    return {
      success: false,
      error: error.message,
      plan: currentPlan, // Return original plan on failure
      model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      duration: 0,
    };
  }
}

/**
 * Estimate total tokens needed for a plan
 *
 * @param {Object} plan - The implementation plan
 * @returns {number} - Estimated tokens
 */
export function estimatePlanTokens(plan) {
  if (!plan || !plan.tasks) return 0;

  const complexityMultipliers = {
    trivial: 500,
    simple: 1000,
    moderate: 2000,
    complex: 4000,
    very_complex: 8000,
  };

  let total = 0;
  for (const task of plan.tasks) {
    const multiplier = complexityMultipliers[task.complexity] || 2000;
    total += multiplier;
  }

  return total;
}

/**
 * Get the next task from a plan
 *
 * @param {Object} plan - The implementation plan
 * @param {Set} completedTaskIds - Set of completed task IDs
 * @returns {Object|null} - Next task to execute or null if done
 */
export function getNextTask(plan, completedTaskIds = new Set()) {
  if (!plan || !plan.tasks) return null;

  for (const task of plan.tasks) {
    // Skip completed tasks
    if (completedTaskIds.has(task.id)) continue;

    // Check if dependencies are satisfied
    const dependenciesMet = !task.dependencies ||
      task.dependencies.every(depId => completedTaskIds.has(depId));

    if (dependenciesMet) {
      return task;
    }
  }

  return null; // All tasks complete or blocked
}

/**
 * Check if a plan is complete
 *
 * @param {Object} plan - The implementation plan
 * @param {Set} completedTaskIds - Set of completed task IDs
 * @returns {boolean}
 */
export function isPlanComplete(plan, completedTaskIds = new Set()) {
  if (!plan || !plan.tasks) return true;
  return plan.tasks.every(task => completedTaskIds.has(task.id));
}

/**
 * Create a minimal plan when AI planning fails
 * This ensures we always have something to work with
 *
 * @param {string} userMessage - The user's request
 * @param {Object} intentClassification - Classification from Intent Agent
 * @returns {Object} - Minimal plan
 */
export function createMinimalPlan(userMessage, intentClassification = {}) {
  const intent = intentClassification.intentType || 'feature';
  const mentionedFiles = intentClassification.extractedContext?.mentionedFiles || [];
  const complexity = intentClassification.complexity || 'moderate';

  // Infer a reasonable target file from the message
  let targetFile = mentionedFiles[0];
  if (!targetFile) {
    const lower = userMessage.toLowerCase();
    if (lower.includes('component')) targetFile = 'src/components/NewComponent.jsx';
    else if (lower.includes('page')) targetFile = 'pages/new-page.js';
    else if (lower.includes('api')) targetFile = 'pages/api/endpoint.js';
    else if (lower.includes('hook')) targetFile = 'src/hooks/useNewHook.js';
    else if (lower.includes('util') || lower.includes('helper')) targetFile = 'src/utils/helper.js';
    else targetFile = 'src/index.js';
  }

  // Determine task type
  const taskType = intent === 'bug_fix' ? 'modify_file' :
                   intent === 'refactor' ? 'refactor' :
                   mentionedFiles.length > 0 ? 'modify_file' : 'create_file';

  return {
    summary: `Implementation plan for: ${userMessage.slice(0, 100)}${userMessage.length > 100 ? '...' : ''}`,
    approach: 'Direct implementation based on user request',
    tasks: [{
      id: 'task_1',
      title: intent === 'bug_fix' ? 'Fix the issue' :
             intent === 'refactor' ? 'Refactor code' :
             'Implement feature',
      description: userMessage,
      type: taskType,
      targetFile: targetFile,
      complexity: complexity,
      requiresEscalation: false,
      specifications: {
        imports: [],
        exports: ['default'],
        functions: [],
        components: []
      }
    }],
    packagesNeeded: [],
    estimatedTokens: complexity === 'simple' ? 1000 :
                     complexity === 'moderate' ? 2500 :
                     complexity === 'complex' ? 5000 : 8000,
    hasEscalationTasks: false
  };
}

export default {
  createPlan,
  refinePlan,
  estimatePlanTokens,
  getNextTask,
  isPlanComplete,
  createMinimalPlan,
};
