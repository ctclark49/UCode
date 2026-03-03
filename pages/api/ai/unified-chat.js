/**
 * Unified Conversational Chat API - "One Agent Facade" Pattern
 *
 * This endpoint provides a true conversational AI experience by:
 * 1. Running silent agents (Intent, Planner, Architect) internally
 * 2. Streaming only the Coder's output with visible tool calls
 * 3. Using tier-based model selection for each agent
 *
 * User sees: ONE intelligent assistant with real-time tool execution
 * Backend uses: 4 specialized agents with different models
 *
 * Streaming Protocol (Vercel AI SDK compatible):
 * 0: text-delta
 * 9: tool-call
 * a: tool-result
 * d: finish
 * e: files_updated
 * 3: error
 * p: progress
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { tokenManagerV2 } from '../../../lib/tokens-v2.js';
import { runUnifiedPipeline } from '../../../lib/ai/unified-agent.js';
import { normalizeTierName } from '../../../lib/ai/agent-config.js';
import { getSyncManager } from '../../../lib/flyio/sync-manager.js';
import { getRouteManager } from '../../../lib/flyio/route-manager.js';
import { saveConversationState } from '../../../lib/ai/conversation-state.js';

// Runtime config
export const config = {
  runtime: 'nodejs',
  maxDuration: 300, // 5 minutes for multi-file generation
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false
  }
};

// =============================================================================
// EXECUTOR MANAGEMENT (File sync to preview)
// Uses SyncManager for Redis-backed session state and reliable syncing
// =============================================================================

async function getExecutor(userId) {
  const previewProvider = process.env.PREVIEW_PROVIDER || 'flyio';

  if (previewProvider === 'flyio' && process.env.FLY_API_TOKEN) {
    try {
      // Use new SyncManager for Redis-backed session state
      const syncManager = getSyncManager();

      return {
        executor: createSyncManagerExecutorAdapter(syncManager, userId),
        type: 'flyio',
        syncManager, // Expose for direct access when needed
      };
    } catch (e) {
      console.warn('[UnifiedChat] SyncManager unavailable:', e.message);

      // Fallback to old FlyioPreviewManager if SyncManager fails
      try {
        const { getFlyioPreviewManager } = await import('../../../lib/flyio/preview-manager.js');
        const flyManager = getFlyioPreviewManager();

        if (flyManager.isConfigured()) {
          return {
            executor: createLegacyFlyioExecutorAdapter(flyManager),
            type: 'flyio-legacy'
          };
        }
      } catch (legacyError) {
        console.warn('[UnifiedChat] Legacy Fly.io also unavailable:', legacyError.message);
      }
    }
  }

  return { executor: null, type: 'state-only' };
}

/**
 * New SyncManager-based executor adapter
 * Uses Redis for session state - no more in-memory state loss
 */
function createSyncManagerExecutorAdapter(syncManager, userId) {
  return {
    async writeFile(projectId, filePath, content) {
      try {
        const result = await syncManager.syncFiles(userId, projectId, { [filePath]: content });

        if (!result.success) {
          // Check if it was queued for retry
          if (result.queued) {
            console.log(`[Executor] File ${filePath} queued for retry (syncId: ${result.syncId})`);
            return { success: false, error: result.error, path: filePath, queued: true };
          }
          return { success: false, error: result.error, path: filePath };
        }

        return {
          success: true,
          path: filePath,
          synced: true,
          checksum: result.checksum,
          machineId: result.machineId,
        };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    },

    async syncBatch(projectId, files) {
      // Sync multiple files at once (more efficient)
      try {
        const result = await syncManager.syncFiles(userId, projectId, files);
        return result;
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    async readFile(projectId, filePath) {
      // For read operations, use the legacy manager (reads don't need session state)
      try {
        const { getFlyioPreviewManager } = await import('../../../lib/flyio/preview-manager.js');
        const flyManager = getFlyioPreviewManager();
        const result = await flyManager.executeCommand(projectId, `cat /app/project/${filePath}`);
        return { success: result.success, content: result.stdout, path: filePath };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    },

    async deleteFile(projectId, filePath) {
      try {
        const { getFlyioPreviewManager } = await import('../../../lib/flyio/preview-manager.js');
        const flyManager = getFlyioPreviewManager();
        await flyManager.executeCommand(projectId, `rm -f /app/project/${filePath}`);
        return { success: true, path: filePath };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    },

    async getStatus(projectId) {
      return syncManager.getStatus(userId, projectId);
    },
  };
}

/**
 * Legacy FlyioPreviewManager adapter (fallback)
 */
function createLegacyFlyioExecutorAdapter(flyManager) {
  return {
    async writeFile(projectId, filePath, content) {
      try {
        const result = await flyManager.syncFiles(projectId, { [filePath]: content });
        return { success: result.success, path: filePath, synced: true };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    },
    async readFile(projectId, filePath) {
      try {
        const result = await flyManager.executeCommand(projectId, `cat /app/project/${filePath}`);
        return { success: result.success, content: result.stdout, path: filePath };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    },
    async deleteFile(projectId, filePath) {
      try {
        await flyManager.executeCommand(projectId, `rm -f /app/project/${filePath}`);
        return { success: true, path: filePath };
      } catch (e) {
        return { success: false, error: e.message, path: filePath };
      }
    }
  };
}

// =============================================================================
// RATE LIMITING
// =============================================================================

const rateLimitStore = new Map();
const RATE_LIMITS = {
  free: { requests: 20, window: 3600000 },
  pro: { requests: 100, window: 3600000 },
  business: { requests: 500, window: 3600000 },
  enterprise: { requests: 2000, window: 3600000 }
};

function checkRateLimit(userId, tier = 'free') {
  const limit = RATE_LIMITS[tier] || RATE_LIMITS.free;
  const key = `ratelimit:unified:${userId}`;
  const now = Date.now();

  const current = rateLimitStore.get(key) || { count: 0, resetAt: now + limit.window };

  if (current.resetAt < now) {
    current.count = 0;
    current.resetAt = now + limit.window;
  }

  if (current.count >= limit.requests) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count++;
  rateLimitStore.set(key, current);

  return { allowed: true, remaining: limit.requests - current.count };
}

// =============================================================================
// PRE-GENERATION MACHINE CLAIMING
// v72: Uses RouteManager for distributed locking and single source of truth
// =============================================================================

/**
 * Claim a machine for generation using RouteManager with distributed locking
 *
 * v72 IMPROVEMENT:
 * - Uses RouteManager for consistent routing (prevents race conditions)
 * - Distributed lock ensures only one claim per project at a time
 * - Single source of truth for projectId → machineId mapping
 *
 * @param {string} projectId - Project identifier
 * @param {string} userId - User identifier
 * @returns {Promise<{machineId: string, url: string} | null>}
 */
async function claimMachineForGeneration(projectId, userId) {
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'https://ezcoder-main.fly.dev';
  const routeManager = getRouteManager();

  // v72: Use RouteManager for distributed locking and single source of truth
  if (routeManager.isReady()) {
    console.log(`[UnifiedChat] v72: Using RouteManager for project ${projectId}`);

    const result = await routeManager.getOrClaimRoute(projectId, userId, async (pid, uid) => {
      // This function is called inside a distributed lock
      return await doClaimMachineForGeneration(pid, uid, baseUrl);
    });

    if (result.success) {
      console.log(`[UnifiedChat] v72: RouteManager ${result.cached ? 'returned cached' : 'claimed new'} machine: ${result.machineId}`);
      return {
        machineId: result.machineId,
        url: result.url,
      };
    } else {
      console.warn(`[UnifiedChat] v72: RouteManager failed: ${result.error}`);
      // Fall through to legacy path
    }
  } else {
    console.log('[UnifiedChat] RouteManager not ready, using legacy claim path');
  }

  // Legacy fallback
  const legacyResult = await doClaimMachineForGeneration(projectId, userId, baseUrl);
  if (legacyResult.success) {
    return {
      machineId: legacyResult.machineId,
      url: legacyResult.url || `${baseUrl}/api/preview/m/${legacyResult.machineId}`,
    };
  }

  return null;
}

/**
 * Internal: Actually claim a machine (called inside RouteManager lock or legacy path)
 */
async function doClaimMachineForGeneration(projectId, userId, baseUrl) {
  // Strategy 1: Try WarmPoolManager first (fastest - direct Redis)
  try {
    const { getWarmPoolManager } = await import('../../../lib/flyio/warm-pool.js');
    const warmPool = getWarmPoolManager();

    if (warmPool.isConfigured()) {
      const result = await warmPool.claimMachine(projectId, userId);
      if (result.success && result.machineId) {
        return {
          success: true,
          machineId: result.machineId,
          url: result.url || `${baseUrl}/api/preview/m/${result.machineId}`,
        };
      }
    }
  } catch (e) {
    console.warn('[UnifiedChat] Warm pool claim failed:', e.message);
  }

  // Strategy 2: Try Pool Controller
  const poolControllerUrl = process.env.POOL_CONTROLLER_URL ||
    (process.env.FLY_APP_NAME ? 'https://ezcoder-pool-controller.fly.dev' : 'http://localhost:3002');
  const controllerSecret = process.env.POOL_CONTROLLER_SECRET || process.env.INTERNAL_API_SECRET;

  try {
    const response = await fetch(`${poolControllerUrl}/trigger/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${controllerSecret}`,
      },
      body: JSON.stringify({ projectId, userId }),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.machineId) {
        return {
          success: true,
          machineId: data.machineId,
          url: data.url || `${baseUrl}/api/preview/m/${data.machineId}`,
        };
      }
    }
  } catch (e) {
    console.warn('[UnifiedChat] Pool controller claim failed:', e.message);
  }

  // Strategy 3: Direct machine creation (slowest but most reliable)
  try {
    const { getFlyioPreviewManager } = await import('../../../lib/flyio/preview-manager.js');
    const previewManager = getFlyioPreviewManager();

    if (previewManager.isConfigured()) {
      const result = await previewManager.createPreview(projectId, userId);
      if (result.success && result.machineId) {
        return {
          success: true,
          machineId: result.machineId,
          url: result.url || `${baseUrl}/api/preview/m/${result.machineId}`,
        };
      }
    }
  } catch (e) {
    console.warn('[UnifiedChat] Direct machine creation failed:', e.message);
  }

  return { success: false, error: 'All claim methods failed' };
}

// =============================================================================
// STREAMING HELPERS
// =============================================================================

function escapeJsonString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    // Check API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'Anthropic API key not configured',
        code: 'NO_API_KEY'
      });
    }

    // Authentication
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    let userId = session.user.id;
    const userTier = normalizeTierName(session.user.subscription_tier || 'free');

    // If userId is undefined, try to get it from database by email
    if (!userId && session.user.email) {
      console.warn('[UnifiedChat] session.user.id is undefined, looking up by email');
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();

        if (user?.id) {
          userId = user.id;
        }
      } catch (e) {
        console.error('[UnifiedChat] Email lookup failed:', e.message);
      }
    }

    // Rate limiting
    const rateLimit = checkRateLimit(userId, userTier);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        resetAt: rateLimit.resetAt
      });
    }

    // Token pre-check
    const estimatedTokens = 5000;
    try {
      const userTokens = await Promise.race([
        tokenManagerV2.getUserTokens(userId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Token check timeout')), 5000)
        )
      ]);

      if (userTokens.totalAvailable < estimatedTokens) {
        return res.status(402).json({
          error: `Insufficient tokens. You have ${userTokens.totalAvailable.toLocaleString()} tokens but need approximately ${estimatedTokens.toLocaleString()}.`,
          code: 'INSUFFICIENT_TOKENS',
          available: userTokens.totalAvailable,
          upgradeUrl: '/billing'
        });
      }
    } catch (e) {
      console.warn('[UnifiedChat] Token pre-check failed:', e.message);
    }

    // Parse request
    const {
      messages,
      projectId,
      files = {},
      activeFile = null,
      tier: requestTier = null,
      mode = 'standard'
    } = req.body;

    const effectiveTier = normalizeTierName(requestTier || userTier);

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'projectId required' });
    }

    const userMessage = messages[messages.length - 1]?.content || '';
    if (!userMessage) {
      return res.status(400).json({ error: 'User message required' });
    }

    console.log(`[UnifiedChat] Request from ${userId} for project ${projectId}, tier=${effectiveTier}`);

    // =========================================================================
    // DATABASE CONNECTION (for database tools)
    // Check if user has active database connection and initialize tools
    // Always include requestDatabaseConnection tool so AI can ask for credentials
    // =========================================================================
    let supabaseConnection = null;
    let databaseTools = null;

    try {
      const {
        getActiveSupabaseConnection,
        createDatabaseTools,
        createRequestDatabaseConnectionTool
      } = await import('../../../lib/ai/database-tools.js');

      supabaseConnection = await getActiveSupabaseConnection(userId);

      if (supabaseConnection) {
        console.log(`[UnifiedChat] Database connected: ${supabaseConnection.provider} - ${supabaseConnection.project_ref || supabaseConnection.database_name}`);
        databaseTools = await createDatabaseTools(userId, supabaseConnection.id, projectId);
      } else {
        // No connection - provide requestDatabaseConnection tool so AI can ask for credentials
        console.log('[UnifiedChat] No database connection - AI can request one if needed');
        databaseTools = createRequestDatabaseConnectionTool(userId, projectId);
      }
    } catch (dbToolsError) {
      // Non-blocking - database tools are optional, but always try to provide requestDatabaseConnection
      console.warn('[UnifiedChat] Database tools init failed:', dbToolsError.message);
      try {
        const { createRequestDatabaseConnectionTool } = await import('../../../lib/ai/database-tools.js');
        databaseTools = createRequestDatabaseConnectionTool(userId, projectId);
      } catch (e) {
        console.warn('[UnifiedChat] Could not create requestDatabaseConnection tool:', e.message);
      }
    }

    // =========================================================================
    // PROMPT EXPANSION (GPT-4o-mini)
    // Expand brief prompts into detailed specifications on first message
    // Cost: ~$0.0003 per expansion
    // =========================================================================
    let expandedMessage = userMessage;
    let expansionMetadata = null;

    // Only expand on first message (no conversation history) and if prompt is brief
    const isFirstMessage = messages.length === 1;
    const isBriefPrompt = userMessage.length >= 15 && userMessage.length < 500;
    const shouldExpand = isFirstMessage && isBriefPrompt && process.env.OPENAI_API_KEY;

    if (shouldExpand) {
      try {
        console.log('[UnifiedChat] Expanding prompt with GPT-4o-mini...');

        // Import OpenAI dynamically to avoid issues if not configured
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const expansionStart = Date.now();
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 600,
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: `You are a web application specification writer. Expand brief prompts into detailed specifications.

Include:
1. Page structure and layout
2. Specific UI components needed
3. Visual style direction appropriate to the app type
4. Key features and interactions
5. Data requirements

Keep under 400 words. Output ONLY the expanded specification.`
            },
            { role: 'user', content: userMessage }
          ],
        });

        const expanded = completion.choices[0]?.message?.content?.trim();

        if (expanded && expanded.length > userMessage.length) {
          expandedMessage = expanded;
          expansionMetadata = {
            original: userMessage,
            expanded: expanded,
            tokens: completion.usage,
            duration: Date.now() - expansionStart
          };
          console.log(`[UnifiedChat] Prompt expanded in ${expansionMetadata.duration}ms (${completion.usage?.total_tokens} tokens)`);
        }
      } catch (expansionError) {
        console.warn('[UnifiedChat] Prompt expansion failed (using original):', expansionError.message);
        // Continue with original prompt - expansion is enhancement, not critical
      }
    }

    // =========================================================================
    // LAZY SCAFFOLD INJECTION (Two-Phase Initialization)
    // On first message, if scaffolds not yet initialized, detect and inject
    // =========================================================================
    let scaffoldInjectionResult = null;

    if (isFirstMessage) {
      try {
        const {
          getProjectScaffoldStatus,
          markScaffoldsInitialized,
          updateProject
        } = await import('../../../lib/database.js');
        const { getScaffoldsToInject } = await import('../../../lib/ai/scaffolds/index.js');
        const { composeScaffolds } = await import('../../../lib/ai/scaffolds/scaffold-composer.js');
        const { hasAnyScaffolds } = await import('../../../lib/ai/scaffolds/scaffold-utils.js');

        // Check if scaffolds already initialized
        const { initialized, metadata } = await getProjectScaffoldStatus(projectId);

        if (!initialized) {
          console.log(`[UnifiedChat] Project ${projectId} needs scaffold initialization`);

          // Use the expanded prompt for better detection
          const promptForDetection = expandedMessage || userMessage;

          // Quick check: does project already have scaffold files?
          const alreadyHasScaffolds = hasAnyScaffolds(files);

          if (alreadyHasScaffolds) {
            // Project has scaffolds but wasn't marked - just mark as initialized
            console.log(`[UnifiedChat] Project already has scaffold files, marking as initialized`);
            await markScaffoldsInitialized(projectId, userId, {
              detected: [],
              triggerPrompt: promptForDetection.substring(0, 500),
              method: 'existing_files',
              skipped: true,
              reason: 'Project already contained scaffold files'
            });
          } else {
            // Run AI scaffold detection
            console.log(`[UnifiedChat] Running AI scaffold detection...`);
            const detectionStart = Date.now();

            const { scaffolds, detection } = await getScaffoldsToInject(promptForDetection);

            if (scaffolds.length > 0) {
              // Compose scaffold files with interconnections
              const composed = composeScaffolds(scaffolds);

              // Inject scaffold files into project
              const injectedFiles = {};
              for (const file of composed.files) {
                files[file.path] = file.content;
                injectedFiles[file.path] = file.content;
              }

              // Update package.json with scaffold dependencies if needed
              if (composed.dependencies.length > 0 && files['package.json']) {
                try {
                  const packageJson = JSON.parse(files['package.json']);
                  // Versions should match getScaffoldDependencyVersion in ezcoder-pro-skeleton.js
                  const depVersions = {
                    '@supabase/supabase-js': '^2.39.0',
                    'stripe': '^14.0.0',
                    '@stripe/stripe-js': '^2.3.0',
                    'react-hot-toast': '^2.4.1',
                    'resend': '^2.0.0',
                    'posthog-js': '^1.96.0',
                    'react-helmet-async': '^2.0.0',
                    '@sentry/react': '^7.0.0',
                    'zod': '^3.22.0',
                  };
                  packageJson.dependencies = packageJson.dependencies || {};
                  for (const dep of composed.dependencies) {
                    if (!packageJson.dependencies[dep]) {
                      packageJson.dependencies[dep] = depVersions[dep] || 'latest';
                    }
                  }
                  files['package.json'] = JSON.stringify(packageJson, null, 2);
                  injectedFiles['package.json'] = files['package.json'];
                } catch (e) {
                  console.warn('[UnifiedChat] Failed to update package.json:', e.message);
                }
              }

              // Create .env.example if needed
              if (composed.envVars.length > 0 && !files['.env.example']) {
                const envExample = `# Required environment variables\n\n${composed.envVars.map(v => `${v}=`).join('\n')}\n`;
                files['.env.example'] = envExample;
                injectedFiles['.env.example'] = envExample;
              }

              // Save injected files to database
              await updateProject(projectId, userId, { files });

              // Record injection result for logging
              scaffoldInjectionResult = {
                scaffolds: scaffolds.map(s => s.id),
                filesInjected: Object.keys(injectedFiles).length,
                duration: Date.now() - detectionStart,
                interconnections: composed.interconnections || [],
              };

              console.log(`[UnifiedChat] Injected ${scaffolds.length} scaffolds (${Object.keys(injectedFiles).length} files) in ${scaffoldInjectionResult.duration}ms`);
            }

            // Mark as initialized (even if no scaffolds detected)
            const { alreadyInitialized } = await markScaffoldsInitialized(projectId, userId, {
              detected: scaffolds.map(s => ({
                id: s.id,
                reason: s.injectionReason,
                confidence: s.confidence
              })),
              triggerPrompt: promptForDetection.substring(0, 500),
              method: detection?.method || 'ai',
              projectType: detection?.projectType,
              aiReasoning: detection?.reasoning,
              filesInjected: scaffoldInjectionResult?.filesInjected || 0,
            });

            if (alreadyInitialized) {
              console.log(`[UnifiedChat] Scaffold initialization was handled by concurrent request`);
            }
          }
        } else {
          console.log(`[UnifiedChat] Project ${projectId} scaffolds already initialized`);
        }
      } catch (scaffoldError) {
        // Don't fail the request if scaffold injection fails
        console.error('[UnifiedChat] Scaffold injection error (continuing):', scaffoldError.message);
      }
    }

    // Get executor - now requires userId for Redis-backed session management
    const { executor, type: executorType, syncManager } = await getExecutor(userId);
    console.log(`[UnifiedChat] Executor type: ${executorType}`);

    // =========================================================================
    // V2: PRE-GENERATION MACHINE CHECK
    // Ensure a preview machine is claimed before starting generation.
    // This prevents files from being generated without a target machine.
    // Industry Best Practice: Claim resources before processing begins.
    // =========================================================================
    let machineReady = false;
    let machineClaimResult = null;

    try {
      // Check if user already has a session with a machine
      const { PreviewSessionManager } = await import('../../../lib/session/preview-session-manager.js');
      const existingSession = await PreviewSessionManager.getSession(userId, projectId);

      if (existingSession?.machineId) {
        // Validate the machine is still running
        const isValid = await PreviewSessionManager.validateMachine(existingSession.machineId);
        if (isValid) {
          machineReady = true;
          console.log(`[UnifiedChat] Pre-gen check: Existing machine ${existingSession.machineId} is ready`);
        } else {
          console.log(`[UnifiedChat] Pre-gen check: Existing machine ${existingSession.machineId} is invalid, will claim new`);
        }
      }

      // If no valid machine, attempt to claim one
      if (!machineReady) {
        console.log(`[UnifiedChat] Pre-gen check: No machine available, attempting claim...`);

        // Try to claim via session API (which includes single-phase claiming)
        try {
          const sessionResult = await PreviewSessionManager.getOrCreateSession(userId, projectId, {
            files: files || {},
            metadata: { source: 'unified-chat-precheck' },
          });

          // If session was created but no machine, try to claim one
          if (!sessionResult.machineAvailable) {
            // Import the claim function
            const claimResult = await claimMachineForGeneration(projectId, userId);
            if (claimResult?.machineId) {
              // Attach to session
              await PreviewSessionManager.attachMachine(
                sessionResult.session.id,
                claimResult.machineId,
                claimResult.url
              );
              machineReady = true;
              machineClaimResult = claimResult;
              console.log(`[UnifiedChat] Pre-gen check: Claimed machine ${claimResult.machineId}`);
            }
          } else {
            machineReady = true;
            console.log(`[UnifiedChat] Pre-gen check: Session already has machine`);
          }
        } catch (sessionErr) {
          console.warn(`[UnifiedChat] Pre-gen check: Session/claim failed: ${sessionErr.message}`);
        }
      }

      // Log status but don't block generation - files can still be queued via retry mechanism
      if (!machineReady) {
        console.warn(`[UnifiedChat] Pre-gen check: No machine available - files will be queued for sync`);
      }
    } catch (preCheckErr) {
      console.warn(`[UnifiedChat] Pre-gen machine check error (continuing): ${preCheckErr.message}`);
    }

    // Client disconnect handling
    let clientDisconnected = false;
    req.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        console.log(`[UnifiedChat] Client disconnected - continuing for project ${projectId}`);
      }
    });

    const safeWrite = (data) => {
      if (clientDisconnected || res.writableEnded) return false;
      try {
        res.write(data);
        return true;
      } catch (e) {
        clientDisconnected = true;
        return false;
      }
    };

    // Set up streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Track generated files
    const generatedFiles = { ...files };

    // Stream scaffold injection progress to client (now that safeWrite is available)
    if (scaffoldInjectionResult) {
      safeWrite(`p:${JSON.stringify({
        stage: 'scaffolds',
        status: 'complete',
        scaffolds: scaffoldInjectionResult.scaffolds,
        filesInjected: scaffoldInjectionResult.filesInjected,
        interconnections: scaffoldInjectionResult.interconnections
      })}\n`);
    }

    // Run the unified pipeline (with expanded prompt if available)
    const result = await runUnifiedPipeline({
      userMessage: expandedMessage,
      originalMessage: userMessage, // Keep original for reference
      expansionMetadata, // Pass expansion data for logging/debugging
      existingFiles: files,
      tier: effectiveTier,
      mode,
      projectId,
      userId,
      activeFile,
      conversationHistory: messages.slice(0, -1),
      executor,
      // Database tools (if Supabase connected)
      supabaseConnection,
      databaseTools,

      // Progress callback (silent stages)
      onProgress: (progress) => {
        console.log(`[UnifiedChat] Progress: ${progress.stage} - ${progress.status}`);
        safeWrite(`p:${JSON.stringify(progress)}\n`);
      },

      // Text streaming (visible)
      onTextDelta: (text) => {
        safeWrite(`0:${JSON.stringify(text)}\n`);
      },

      // Tool calls (visible)
      onToolUse: (tool) => {
        safeWrite(`9:${JSON.stringify(tool)}\n`);
      },

      // Tool results (visible)
      onToolResult: async (result) => {
        // Update generated files
        if (result.result?.path && result.result?.content) {
          generatedFiles[result.result.path] = result.result.content;
        } else if (result.result?.path && result.result?.new_content) {
          generatedFiles[result.result.path] = result.result.new_content;
        }

        // Check for PAUSE_FOR_USER_INPUT action (e.g., database connection request)
        if (result.result?.action === 'PAUSE_FOR_USER_INPUT') {
          console.log('[UnifiedChat] AI pausing for user input:', result.result.inputType);

          // Save conversation state for resume
          const conversationState = {
            messages: [...messages],
            generatedFiles,
            lastToolCall: result,
            inputType: result.result.inputType,
            prompt: result.result.prompt
          };

          const resumeToken = await saveConversationState(userId, projectId, conversationState);

          // Add resume token to the result
          result.result.resumeToken = resumeToken;

          // Send the tool result with resume token
          safeWrite(`a:${JSON.stringify(result)}\n`);

          // Send a finish event indicating pause
          safeWrite(`d:${JSON.stringify({
            finishReason: 'paused',
            pauseReason: result.result.inputType,
            resumeToken,
            message: result.result.prompt?.reason || 'AI workflow paused for user input'
          })}\n`);

          // Don't continue processing - the workflow is paused
          return { paused: true, resumeToken };
        }

        safeWrite(`a:${JSON.stringify(result)}\n`);

        // Send files_updated event
        if (result.result?.success && result.result?.path) {
          safeWrite(`e:${JSON.stringify({ filesUpdated: [result.result.path] })}\n`);
        }
      },
    });

    // Check if workflow was paused (e.g., for database connection)
    if (result.paused) {
      console.log('[UnifiedChat] Workflow paused for user input:', result.pauseReason);
      // The finish event was already sent in onToolResult, don't send another
      // End response and wait for resume
      res.end();
      return;
    }

    // Send completion
    safeWrite(`d:${JSON.stringify({
      finishReason: result.success ? 'stop' : 'error',
      usage: result.usage || {},
      filesModified: result.filesModified?.length || 0,
      iterations: result.iterations || 0
    })}\n`);

    // Send final file state
    safeWrite(`e:${JSON.stringify({
      type: 'files_updated',
      files: result.files || generatedFiles,
      modified: result.filesModified || [],
      executorType
    })}\n`);

    // v69/v70: Sync auto-fixed files to preview using SyncManager
    // This ensures files like src/components/ui/button.tsx are synced after validation
    // v70: Now uses Redis-backed SyncManager for reliable sync with retry queue
    if (result.validation?.fixesApplied > 0 && (executorType === 'flyio' || executorType === 'flyio-legacy')) {
      try {
        if (syncManager) {
          // Use new SyncManager with Redis session state
          const syncResult = await syncManager.syncFiles(userId, projectId, result.files || generatedFiles);

          if (syncResult.success) {
            console.log(`[UnifiedChat] v70: Synced ${result.validation.fixesApplied} auto-fixed files (checksum: ${syncResult.checksum})`);
          } else if (syncResult.queued) {
            console.log(`[UnifiedChat] v70: Auto-fix sync queued for retry (syncId: ${syncResult.syncId})`);
          } else {
            console.warn(`[UnifiedChat] v70: Auto-fix sync failed: ${syncResult.error}`);
          }
        } else {
          // Fallback to legacy manager
          const { getFlyioPreviewManager } = await import('../../../lib/flyio/preview-manager.js');
          const flyManager = getFlyioPreviewManager();
          const syncResult = await flyManager.syncFiles(projectId, result.files || generatedFiles);
          console.log(`[UnifiedChat] v69: Synced ${result.validation.fixesApplied} auto-fixed files (legacy):`, syncResult.success);
        }
      } catch (e) {
        console.warn('[UnifiedChat] v70: Auto-fix sync to preview failed:', e.message);
      }
    }

    // Save to database
    if (result.filesModified?.length > 0 && userId) {
      try {
        const db = await import('../../../lib/database.js');
        await db.updateProject(projectId, userId, {
          files: result.files || generatedFiles,
          updated_at: new Date().toISOString()
        });
        console.log(`[UnifiedChat] Saved ${result.filesModified.length} files to database`);
      } catch (e) {
        console.error('[UnifiedChat] Database save failed:', e.message);
      }
    }

    // Deduct tokens
    if (result.usage?.totalTokens > 0) {
      try {
        await tokenManagerV2.deductTokens(userId, result.usage.totalTokens, {
          projectId,
          operation: 'unified-chat',
          model: 'mixed'
        });
        console.log(`[UnifiedChat] Deducted ${result.usage.totalTokens} tokens`);
      } catch (e) {
        console.error('[UnifiedChat] Token deduction failed:', e.message);
      }
    }

    // End response
    if (!res.writableEnded) {
      res.end();
    }

  } catch (error) {
    console.error('[UnifiedChat] Error:', error);

    if (res.headersSent) {
      try {
        res.write(`3:${JSON.stringify({ error: error.message })}\n`);
      } catch (e) {}
      if (!res.writableEnded) {
        try { res.end(); } catch (e) {}
      }
    } else {
      res.status(500).json({
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }
}
