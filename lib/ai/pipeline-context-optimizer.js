/**
 * Pipeline Context Optimizer - Reduces Token Usage in Multi-Agent Pipeline
 *
 * Implements 5 industry-standard optimizations specifically for the multi-agent architecture:
 * 1. Shared Project Summary - Compressed context passed through pipeline (~60% reduction)
 * 2. Progressive Context Loading - Load only what each agent needs (~30% reduction)
 * 3. Batch Code Generation - Multiple files in fewer API calls (~20% reduction)
 * 4. Smart Pipeline Skipping - Skip stages for simple tasks (~25% for simple tasks)
 * 5. Context Caching - Cache analysis results in Redis/memory (~40% for repeat users)
 *
 * Expected combined savings: 50-70% reduction in input tokens
 *
 * @module lib/ai/pipeline-context-optimizer
 */

import crypto from 'crypto';

// =============================================================================
// SOLUTION 1: SHARED PROJECT SUMMARY
// =============================================================================

/**
 * Create a compressed project summary that's passed through the entire pipeline
 * This replaces sending full file contents to each agent independently
 *
 * Before: Each agent received ~50,000+ tokens of file content
 * After: Each agent receives the same ~1,500 token summary
 *
 * @param {Object} existingFiles - Map of filename -> content
 * @param {Object} options - Summary options
 * @returns {Object} - Compressed project summary
 */
export function createProjectSummary(existingFiles, options = {}) {
  const {
    maxFileTreeEntries = 50,
    maxKeyFileContent = 1500,
    maxKeyFiles = 3,
    includeSignatures = true,
  } = options;

  const files = Object.keys(existingFiles);
  const summary = {
    totalFiles: files.length,
    createdAt: Date.now(),
    hash: createFilesHash(existingFiles),
    fileTree: createFileTree(files, maxFileTreeEntries),
    packageInfo: extractPackageInfo(existingFiles),
    signatures: includeSignatures ? extractFileSignatures(existingFiles) : {},
    keyFiles: extractKeyFileContent(existingFiles, maxKeyFiles, maxKeyFileContent),
    detected: {
      framework: detectFramework(existingFiles),
      language: detectLanguage(files),
      styling: detectStyling(files),
    },
  };

  summary.estimatedTokens = Math.ceil(JSON.stringify(summary).length / 4);
  console.log(`[PipelineContextOptimizer] Created project summary: ${summary.totalFiles} files → ~${summary.estimatedTokens} tokens`);

  return summary;
}

function createFilesHash(files) {
  const content = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => `${path}:${content?.length || 0}`)
    .join('|');
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
}

function createFileTree(files, maxEntries) {
  const tree = {};
  for (const file of files.slice(0, maxEntries)) {
    const parts = file.split('/');
    const filename = parts.pop();
    const dir = parts.join('/') || '.';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(filename);
  }

  const treeStr = Object.entries(tree)
    .map(([dir, dirFiles]) => `${dir}/: ${dirFiles.join(', ')}`)
    .join('\n');

  return files.length > maxEntries
    ? `${treeStr}\n... and ${files.length - maxEntries} more files`
    : treeStr;
}

function extractPackageInfo(files) {
  const pkg = files['package.json'];
  if (!pkg) return null;

  try {
    const parsed = JSON.parse(pkg);
    return {
      name: parsed.name,
      dependencies: Object.keys(parsed.dependencies || {}),
      devDependencies: Object.keys(parsed.devDependencies || {}).slice(0, 10),
      scripts: Object.keys(parsed.scripts || {}),
      main: parsed.main,
      type: parsed.type,
    };
  } catch {
    return null;
  }
}

function extractFileSignatures(files) {
  const signatures = {};
  const priorityFiles = Object.keys(files).filter(f =>
    f.includes('App.') ||
    f.includes('index.') ||
    f.includes('main.') ||
    f.endsWith('.config.js') ||
    f.includes('/api/') ||
    f.includes('/pages/')
  ).slice(0, 10);

  for (const path of priorityFiles) {
    const content = files[path];
    if (!content || content.length > 10000) continue;

    const sig = {
      exports: extractExports(content),
      imports: extractImports(content),
      type: inferFileType(path),
    };

    if (sig.exports.length > 0 || sig.imports.length > 0) {
      signatures[path] = sig;
    }
  }

  return signatures;
}

function extractExports(content) {
  const exports = [];
  const namedExports = content.match(/export\s+(?:const|let|var|function|class|async function)\s+(\w+)/g);
  if (namedExports) {
    exports.push(...namedExports.map(e => e.split(/\s+/).pop()));
  }
  if (/export\s+default/.test(content)) {
    exports.push('default');
  }
  return [...new Set(exports)].slice(0, 10);
}

function extractImports(content) {
  const imports = [];
  const importMatches = content.match(/import\s+.*?\s+from\s+['"][^'"]+['"]/g);
  if (importMatches) {
    for (const match of importMatches) {
      const module = match.match(/from\s+['"]([^'"]+)['"]/)?.[1];
      if (module && !module.startsWith('.')) {
        imports.push(module.split('/')[0]);
      }
    }
  }
  return [...new Set(imports)].slice(0, 15);
}

function extractKeyFileContent(files, maxFiles, maxChars) {
  const keyFiles = {};
  const priorities = ['package.json', 'next.config.js', 'vite.config.js', 'tailwind.config.js', 'tsconfig.json'];

  for (const file of priorities) {
    if (files[file] && Object.keys(keyFiles).length < maxFiles) {
      keyFiles[file] = truncateContent(files[file], maxChars);
    }
  }

  const entryFiles = Object.keys(files).filter(f =>
    (f.includes('App.') || f.includes('index.') || f.includes('main.')) &&
    !f.includes('node_modules')
  );

  for (const file of entryFiles) {
    if (Object.keys(keyFiles).length >= maxFiles) break;
    if (!keyFiles[file]) {
      keyFiles[file] = truncateContent(files[file], maxChars);
    }
  }

  return keyFiles;
}

function truncateContent(content, maxChars) {
  if (!content || content.length <= maxChars) return content;
  const cutPoint = content.lastIndexOf('\n', maxChars);
  const text = content.slice(0, cutPoint > maxChars / 2 ? cutPoint : maxChars);
  return text + '\n// ... truncated';
}

function inferFileType(path) {
  const lower = path.toLowerCase();
  if (lower.includes('/api/') || lower.includes('/routes/')) return 'api';
  if (lower.includes('/pages/') || lower.includes('/app/')) return 'page';
  if (lower.includes('/components/')) return 'component';
  if (lower.includes('/hooks/') || lower.startsWith('use')) return 'hook';
  if (lower.includes('.config.')) return 'config';
  if (lower.includes('/utils/') || lower.includes('/lib/')) return 'util';
  return 'other';
}

function detectFramework(files) {
  const fileList = Object.keys(files);
  if (fileList.some(f => f.includes('next.config'))) return 'nextjs';
  if (fileList.some(f => f.includes('vite.config'))) return 'vite';
  if (fileList.some(f => f.includes('nuxt.config'))) return 'nuxt';
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return 'nextjs';
      if (deps.vite) return 'vite';
      if (deps.vue) return 'vue';
      if (deps.react) return 'react';
      if (deps.svelte) return 'svelte';
    } catch {}
  }
  return 'javascript';
}

function detectLanguage(files) {
  const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
  const jsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
  return tsFiles.length > jsFiles.length ? 'typescript' : 'javascript';
}

function detectStyling(files) {
  if (files.some(f => f.includes('tailwind.config'))) return 'tailwind';
  if (files.some(f => f.endsWith('.module.css') || f.endsWith('.module.scss'))) return 'css-modules';
  if (files.some(f => f.endsWith('.scss'))) return 'scss';
  return 'css';
}


// =============================================================================
// SOLUTION 2: PROGRESSIVE CONTEXT LOADING
// =============================================================================

/**
 * Context loader that provides different levels of detail per agent
 * Each agent only gets what it actually needs
 */
export const ProgressiveContext = {
  /**
   * Minimal context for Intent Agent
   * ~500 tokens instead of ~50,000
   */
  forIntent(existingFiles, projectSummary) {
    return {
      fileCount: Object.keys(existingFiles).length,
      fileList: Object.keys(existingFiles).slice(0, 20),
      framework: projectSummary?.detected?.framework || 'unknown',
      hasExistingCode: Object.keys(existingFiles).length > 0,
    };
  },

  /**
   * Planning context for Planner Agent
   * ~2,000 tokens instead of ~50,000
   */
  forPlanner(existingFiles, projectSummary) {
    return {
      summary: projectSummary,
      structure: projectSummary?.fileTree || Object.keys(existingFiles).slice(0, 30).join('\n'),
      packageInfo: projectSummary?.packageInfo,
      signatures: projectSummary?.signatures || {},
    };
  },

  /**
   * Architecture context for Architect Agent
   * ~3,000 tokens instead of ~50,000
   */
  forArchitect(existingFiles, projectSummary, plan) {
    const targetFiles = plan?.tasks
      ?.filter(t => t.type === 'modify_file')
      ?.map(t => t.targetFile)
      ?.filter(Boolean) || [];

    const relevantContent = {};
    for (const file of targetFiles.slice(0, 3)) {
      if (existingFiles[file] && existingFiles[file].length < 3000) {
        relevantContent[file] = existingFiles[file];
      }
    }

    return {
      summary: projectSummary,
      targetFiles: relevantContent,
      dependencies: projectSummary?.packageInfo?.dependencies || [],
    };
  },

  /**
   * Coding context for Coder Agent
   * Only the specific file being modified - minimal overhead
   */
  forCoder(existingFiles, task, fileSpec) {
    return {
      existingContent: task.type === 'modify_file' ? existingFiles[task.targetFile] : null,
      fileSpec,
    };
  },

  /**
   * Format context as string for inclusion in prompts
   */
  formatForPrompt(context, stage) {
    switch (stage) {
      case 'intent':
        return `Project has ${context.fileCount} files using ${context.framework}.`;

      case 'planner':
        let plannerCtx = `PROJECT STRUCTURE:\n${context.structure}\n`;
        if (context.packageInfo) {
          plannerCtx += `\nDEPENDENCIES: ${context.packageInfo.dependencies?.join(', ') || 'none'}`;
        }
        if (context.signatures && Object.keys(context.signatures).length > 0) {
          plannerCtx += `\n\nKEY FILE SIGNATURES:\n`;
          for (const [path, sig] of Object.entries(context.signatures)) {
            plannerCtx += `- ${path}: exports [${sig.exports.join(', ')}]\n`;
          }
        }
        return plannerCtx;

      case 'architect':
        let archCtx = `PROJECT SUMMARY:\n${JSON.stringify(context.summary?.detected || {})}\n`;
        if (Object.keys(context.targetFiles || {}).length > 0) {
          archCtx += `\nFILES TO MODIFY:\n`;
          for (const [path, content] of Object.entries(context.targetFiles)) {
            archCtx += `\n=== ${path} ===\n${content}\n`;
          }
        }
        return archCtx;

      case 'coder':
        if (context.existingContent) {
          return `EXISTING CONTENT TO MODIFY:\n${context.existingContent}`;
        }
        return '';

      default:
        return JSON.stringify(context);
    }
  },
};


// =============================================================================
// SOLUTION 3: BATCH CODE GENERATION
// =============================================================================

/**
 * Group related tasks for batch generation
 * Reduces API calls from N to ceil(N/batchSize)
 */
export function groupTasksForBatching(tasks, maxPerBatch = 3) {
  const batches = [];
  const codeTasksOnly = tasks.filter(t =>
    ['create_file', 'modify_file'].includes(t.type)
  );

  // Group by directory first
  const byDirectory = {};
  for (const task of codeTasksOnly) {
    const dir = task.targetFile?.split('/').slice(0, -1).join('/') || '.';
    if (!byDirectory[dir]) byDirectory[dir] = [];
    byDirectory[dir].push(task);
  }

  // Create batches from directory groups
  for (const [dir, dirTasks] of Object.entries(byDirectory)) {
    for (let i = 0; i < dirTasks.length; i += maxPerBatch) {
      batches.push({
        directory: dir,
        tasks: dirTasks.slice(i, i + maxPerBatch),
        batchId: `batch_${batches.length}`,
      });
    }
  }

  return batches;
}

/**
 * Format multiple tasks into a single prompt
 */
export function formatBatchPrompt(batch, existingFiles, architecture) {
  const { tasks, directory } = batch;

  let prompt = `Generate code for ${tasks.length} related files in "${directory}":\n\n`;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const fileSpec = architecture?.fileStructure?.find(f => f.path === task.targetFile) || {};
    const existing = task.type === 'modify_file' ? existingFiles[task.targetFile] : null;

    prompt += `=== FILE ${i + 1}: ${task.targetFile} ===\n`;
    prompt += `Task: ${task.title}\n`;
    prompt += `Description: ${task.description}\n`;
    prompt += `Type: ${task.type}\n`;

    if (fileSpec.purpose) {
      prompt += `Purpose: ${fileSpec.purpose}\n`;
    }

    if (existing) {
      prompt += `\nExisting content to modify:\n${truncateContent(existing, 2000)}\n`;
    }

    prompt += '\n';
  }

  prompt += `\nReturn each file's complete code using this format:\n`;
  prompt += `===FILE:path/to/file.js===\n`;
  prompt += `(complete code here)\n`;
  prompt += `===END_FILE===\n`;

  return prompt;
}

/**
 * Parse batch response into individual files
 */
export function parseBatchResponse(response) {
  const files = {};
  const pattern = /===FILE:([^=]+)===\n([\s\S]*?)===END_FILE===/g;

  let match;
  while ((match = pattern.exec(response)) !== null) {
    const [, path, code] = match;
    files[path.trim()] = code.trim();
  }

  // Fallback: try to split by markdown code blocks
  if (Object.keys(files).length === 0) {
    const codeBlocks = response.match(/```(?:jsx?|tsx?|javascript|typescript)?\n([\s\S]*?)```/g);
    if (codeBlocks && codeBlocks.length > 0) {
      return { _raw: codeBlocks.map(b => b.replace(/```\w*\n?/g, '').trim()) };
    }
  }

  return files;
}


// =============================================================================
// SOLUTION 4: SMART PIPELINE SKIPPING
// =============================================================================

/**
 * Determine optimal pipeline configuration based on task analysis
 */
export function determinePipelineConfig(intent, projectSummary) {
  const config = {
    skipIntent: false,
    skipPlanner: false,
    skipArchitect: false,
    useBatching: false,
    useQuickPlan: false,
    estimatedComplexity: 'moderate',
  };

  // Questions/explanations skip pipeline entirely
  if (intent?.pipelineConfig?.skipPipeline) {
    return { ...config, skipAll: true };
  }

  // Single file changes don't need architecture phase
  if (
    intent?.intentType === 'small_edit' ||
    intent?.intentType === 'bug_fix' ||
    intent?.extractedContext?.targetScope === 'single_file'
  ) {
    config.skipArchitect = true;
    config.estimatedComplexity = 'simple';
  }

  // Trivial changes can use quick plan (no API call)
  if (
    intent?.complexity === 'trivial' ||
    (intent?.intentType === 'small_edit' && (projectSummary?.totalFiles || 0) < 5)
  ) {
    config.useQuickPlan = true;
    config.skipArchitect = true;
    config.estimatedComplexity = 'trivial';
  }

  // Enable batching for multi-file tasks
  if (
    intent?.intentType === 'multi_file' ||
    intent?.intentType === 'new_feature' ||
    intent?.extractedContext?.targetScope === 'multiple_files'
  ) {
    config.useBatching = true;
    config.estimatedComplexity = 'complex';
  }

  return config;
}

/**
 * Create a quick plan for trivial tasks (no API call needed)
 */
export function createQuickPlan(userMessage, intent, targetFile) {
  return {
    summary: `Quick ${intent?.intentType || 'edit'} task`,
    approach: 'Direct modification',
    tasks: [{
      id: 'task_1',
      title: intent?.intentType === 'small_edit' ? 'Apply small edit' : 'Fix bug',
      description: userMessage,
      type: targetFile ? 'modify_file' : 'create_file',
      targetFile: targetFile || extractTargetFile(userMessage),
      complexity: 'trivial',
      dependencies: [],
    }],
    estimatedTokens: 1000,
    quickPlan: true,
  };
}

function extractTargetFile(message) {
  const patterns = [
    /(?:in|file|modify|edit|fix|update)\s+[`"']?([a-zA-Z0-9_./-]+\.[a-z]+)[`"']?/i,
    /([a-zA-Z0-9_/-]+\.(js|jsx|ts|tsx|css|json))/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Enhanced intent check for pipeline skipping
 */
export function shouldSkipDetailedPlanning(intent, projectSummary) {
  if (!intent) return false;

  // Skip for trivial complexity
  if (intent.complexity === 'trivial') return true;

  // Skip for small edits in small projects
  if (
    intent.intentType === 'small_edit' &&
    (projectSummary?.totalFiles || 0) < 10
  ) {
    return true;
  }

  // Skip for direct bug fixes
  if (intent.intentType === 'bug_fix' && intent.confidence > 0.8) {
    return true;
  }

  return false;
}


// =============================================================================
// SOLUTION 5: CONTEXT CACHING
// =============================================================================

const memoryCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Context cache manager with Redis fallback to memory
 */
export const ContextCache = {
  async get(projectId, existingFiles) {
    const currentHash = createFilesHash(existingFiles);
    const cacheKey = `ctx:${projectId}:summary`;

    // Try Redis first
    try {
      const redis = await getRedisClient();
      if (redis) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.hash === currentHash) {
            console.log(`[ContextCache] Redis hit for ${projectId}`);
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn('[ContextCache] Redis error, using memory:', e.message);
    }

    // Fallback to memory cache
    const memCached = memoryCache.get(cacheKey);
    if (memCached && memCached.hash === currentHash && Date.now() - memCached.cachedAt < CACHE_TTL) {
      console.log(`[ContextCache] Memory hit for ${projectId}`);
      return memCached;
    }

    return null;
  },

  async set(projectId, summary) {
    const cacheKey = `ctx:${projectId}:summary`;
    const data = { ...summary, cachedAt: Date.now() };

    // Try Redis first
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.set(cacheKey, JSON.stringify(data), { ex: 900 });
        console.log(`[ContextCache] Stored in Redis for ${projectId}`);
      }
    } catch (e) {
      console.warn('[ContextCache] Redis set error:', e.message);
    }

    // Always store in memory as backup
    memoryCache.set(cacheKey, data);

    // Clean old entries
    if (memoryCache.size > 100) {
      const oldest = [...memoryCache.entries()]
        .sort(([,a], [,b]) => a.cachedAt - b.cachedAt)
        .slice(0, 20);
      for (const [key] of oldest) {
        memoryCache.delete(key);
      }
    }
  },

  async invalidate(projectId) {
    const cacheKey = `ctx:${projectId}:summary`;

    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.del(cacheKey);
      }
    } catch {}

    memoryCache.delete(cacheKey);
  },

  async getOrCreate(projectId, existingFiles, options = {}) {
    const cached = await this.get(projectId, existingFiles);
    if (cached) {
      return cached;
    }

    const summary = createProjectSummary(existingFiles, options);
    await this.set(projectId, summary);

    return summary;
  },
};

let redisClient = null;
async function getRedisClient() {
  if (redisClient === false) return null;
  if (redisClient) return redisClient;

  try {
    const { getRedis } = await import('../adapters/redis-adapter.js');
    redisClient = await getRedis();
    return redisClient;
  } catch {
    console.log('[ContextCache] Redis not available, using memory only');
    redisClient = false;
    return null;
  }
}


// =============================================================================
// COST ESTIMATION
// =============================================================================

/**
 * Estimate token cost for a pipeline run
 */
export function estimatePipelineCost(projectSummary, pipelineConfig, tier) {
  const stageEstimates = {
    intent: 500,
    planner: pipelineConfig.skipPlanner || pipelineConfig.useQuickPlan ? 0 : 2000,
    architect: pipelineConfig.skipArchitect ? 0 : 2500,
    coder: 3000,
  };

  let totalInput = stageEstimates.intent;
  if (!pipelineConfig.skipPlanner && !pipelineConfig.useQuickPlan) totalInput += stageEstimates.planner;
  if (!pipelineConfig.skipArchitect) totalInput += stageEstimates.architect;
  totalInput += stageEstimates.coder;

  const outputEstimate = Math.ceil(totalInput * 0.6);

  const modelCosts = {
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
    'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
    'claude-opus-4-5-20251101': { input: 15.00, output: 75.00 },
  };

  // Model selection matches agent-config.js TIER_AGENT_CONFIG
  let effectiveModel = 'claude-haiku-4-5-20251001'; // Free tier
  if (tier === 'pro') effectiveModel = 'claude-sonnet-4-5-20250929';
  if (tier === 'business') effectiveModel = 'claude-sonnet-4-5-20250929'; // Coder uses Sonnet 4.5
  if (tier === 'enterprise') effectiveModel = 'claude-opus-4-5-20251101';

  const costs = modelCosts[effectiveModel] || modelCosts['claude-haiku-4-5-20251001'];

  const estimatedCost = (
    (totalInput / 1_000_000) * costs.input +
    (outputEstimate / 1_000_000) * costs.output
  );

  return {
    estimatedInputTokens: totalInput,
    estimatedOutputTokens: outputEstimate,
    estimatedTotalTokens: totalInput + outputEstimate,
    estimatedCost: estimatedCost.toFixed(4),
    stagesSkipped: [
      pipelineConfig.useQuickPlan && 'planner',
      pipelineConfig.skipArchitect && 'architect',
    ].filter(Boolean),
    model: effectiveModel,
  };
}


// =============================================================================
// MAIN EXPORT: OPTIMIZED CONTEXT PROVIDER
// =============================================================================

/**
 * Main entry point - creates optimized context for the entire pipeline
 *
 * Usage in orchestrator:
 * ```javascript
 * const optimizedCtx = await createOptimizedContext(projectId, existingFiles, intent);
 *
 * // For Intent Agent
 * const intentContext = optimizedCtx.getIntentContext();
 *
 * // For Planner Agent
 * const plannerContext = optimizedCtx.getPlannerContext();
 *
 * // For Architect Agent
 * const architectContext = optimizedCtx.getArchitectContext(plan);
 *
 * // For Coder Agent
 * const coderContext = optimizedCtx.getCoderContext(task, fileSpec);
 * ```
 *
 * @param {string} projectId - Project identifier
 * @param {Object} existingFiles - Map of filename -> content
 * @param {Object} intent - Intent classification result
 * @returns {Promise<Object>} - Optimized context object
 */
export async function createOptimizedContext(projectId, existingFiles, intent) {
  const projectSummary = await ContextCache.getOrCreate(projectId, existingFiles);
  const pipelineConfig = determinePipelineConfig(intent, projectSummary);

  return {
    projectId,
    projectSummary,
    pipelineConfig,

    // Progressive context getters
    getIntentContext: () => ProgressiveContext.forIntent(existingFiles, projectSummary),
    getPlannerContext: () => ProgressiveContext.forPlanner(existingFiles, projectSummary),
    getArchitectContext: (plan) => ProgressiveContext.forArchitect(existingFiles, projectSummary, plan),
    getCoderContext: (task, fileSpec) => ProgressiveContext.forCoder(existingFiles, task, fileSpec),

    // Format context as string for prompts
    formatForPrompt: (stage, extraData) => {
      switch (stage) {
        case 'intent':
          return ProgressiveContext.formatForPrompt(
            ProgressiveContext.forIntent(existingFiles, projectSummary),
            'intent'
          );
        case 'planner':
          return ProgressiveContext.formatForPrompt(
            ProgressiveContext.forPlanner(existingFiles, projectSummary),
            'planner'
          );
        case 'architect':
          return ProgressiveContext.formatForPrompt(
            ProgressiveContext.forArchitect(existingFiles, projectSummary, extraData),
            'architect'
          );
        case 'coder':
          return ProgressiveContext.formatForPrompt(
            ProgressiveContext.forCoder(existingFiles, extraData?.task, extraData?.fileSpec),
            'coder'
          );
        default:
          return '';
      }
    },

    // Batching support
    createBatches: (tasks) => groupTasksForBatching(tasks),
    formatBatchPrompt: (batch, architecture) => formatBatchPrompt(batch, existingFiles, architecture),

    // Cost estimation
    estimateCost: (tier) => estimatePipelineCost(projectSummary, pipelineConfig, tier),

    // Quick plan for trivial tasks
    createQuickPlan: (userMessage, targetFile) => createQuickPlan(userMessage, intent, targetFile),

    // Direct access to raw files when needed (for coder modifications)
    getFile: (path) => existingFiles[path] || null,
    hasFile: (path) => !!existingFiles[path],
  };
}

export default {
  createProjectSummary,
  createOptimizedContext,
  ProgressiveContext,
  ContextCache,
  groupTasksForBatching,
  formatBatchPrompt,
  parseBatchResponse,
  determinePipelineConfig,
  createQuickPlan,
  shouldSkipDetailedPlanning,
  estimatePipelineCost,
};
