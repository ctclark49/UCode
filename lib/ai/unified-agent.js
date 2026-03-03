/**
 * Unified Conversational Agent - "One Agent Facade" Pattern
 *
 * This module combines multiple specialized agents (Intent, Planner, Architect, Coder)
 * into a single conversational experience. The user sees ONE intelligent assistant
 * while internally leveraging specialized models for different tasks.
 *
 * Architecture:
 * 1. Intent Agent (Silent) - Fast classification with Haiku
 * 2. Planner Agent (Silent) - Task breakdown with tier-based model
 * 3. Architect Agent (Silent, Optional) - File structure design
 * 4. Coder Agent (VISIBLE) - Streaming code generation with real-time tools
 *
 * Enhanced with Production-Ready Generation System:
 * - Pre-generation request analysis
 * - Dependency-ordered file generation
 * - Real-time validation during generation (not after)
 * - Icon pre-injection to prevent hallucinations
 * - Enhanced system prompts with file listings
 *
 * The magic: Silent agents provide reasoning/structure, but only the Coder
 * streams to the user with visible tool calls (writeFile, readFile, etc.)
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  MODELS,
  AGENTS,
  INTENT_TYPES,
  getModelForAgent,
  getAgentConfig,
  getPipelineConfig,
  normalizeTierName,
} from './agent-config.js';

// Import existing agents (we reuse their logic)
import { classifyIntent } from './agents/intent-agent.js';
import { createPlan } from './agents/planner-agent.js';
import { createArchitecture } from './agents/architect-agent.js';

// Import error detection system (Layer 1 - Generation-time validation)
import { ErrorOrchestrator } from './error-detection/error-orchestrator.js';

// Import NEW production-ready generation modules
import { analyzeRequest, getAnalysisSummary } from './generation/request-analyzer.js';
import { DependencyResolver } from './generation/dependency-resolver.js';
import { RealtimeValidator } from './generation/realtime-validator.js';
import { IconInjector, validateIconsInContent, fixIconImports } from './generation/icon-injector.js';

// Import scaffold system for feature injection
import scaffoldRegistry from './scaffolds/index.js';
import { composeScaffolds } from './scaffolds/scaffold-composer.js';

// Import package manifest for available packages in Coder prompt
import {
  getAvailablePackagesForPrompt,
  INSTANT_FRAMEWORKS,
} from '../preview/package-manifest.js';

// =============================================================================
// PACKAGE MANIFEST CACHING
// =============================================================================
// Cache the packages prompt at module load (expensive string operations)
let _cachedPackagesSection = null;

/**
 * Build available packages section for Coder system prompt
 * Cached for performance - computed once per process lifecycle
 * @returns {string} Formatted packages section
 */
function buildAvailablePackagesSection() {
  if (!_cachedPackagesSection) {
    const packagesPrompt = getAvailablePackagesForPrompt();
    _cachedPackagesSection = `## Available Packages (Pre-installed - NO npm install needed)

All packages below are already installed in the preview environment.
Import them directly - they work immediately with no setup required.

${packagesPrompt}

IMPORTANT:
- Do NOT ask to install these packages - they are already available
- Do NOT create package installation tasks for packages in this list
- Import and use them directly in your code
- For instant startup, prefer: ${INSTANT_FRAMEWORKS.join(', ')}`;
  }
  return _cachedPackagesSection;
}

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

// =============================================================================
// PLATFORM API INTEGRATION
// =============================================================================

/**
 * Internal project token for AI generation API calls
 * This allows the AI to fetch real data during code generation
 */
const GENERATION_PROJECT_TOKEN = process.env.GENERATION_PROJECT_TOKEN || process.env.INTERNAL_API_TOKEN;

/**
 * Platform API configurations for generation-time calls
 * Mirrors the structure in pages/api/platform/[apiType].js
 */
/**
 * Platform API configurations with usage limits and alternatives
 * FREE APIs have unlimited usage (no daily limits)
 * PAID APIs have daily limits and should have alternatives
 */
const PLATFORM_API_CONFIG = {
  // ========== APIs WITH DAILY LIMITS ==========
  images: {
    description: 'Unsplash real stock photos',
    endpoints: ['search', 'random'],
    exampleParams: { search: { query: 'mountain landscape', per_page: 5 } },
    dailyLimit: 50,
    hasLimit: true,
    alternatives: ['Use https://source.unsplash.com/800x600/?{query} for direct URLs', 'Use https://picsum.photos/800/600 for random photos'],
    fallbackUrl: (params) => `https://source.unsplash.com/800x600/?${encodeURIComponent(params?.query || 'nature')}`
  },
  weather: {
    description: 'OpenWeatherMap current/forecast',
    endpoints: ['current', 'forecast'],
    exampleParams: { current: { q: 'New York' } },
    dailyLimit: 100,
    hasLimit: true,
    alternatives: ['weatheralerts (NOAA, FREE, US only)', 'Use static demo data for non-US locations']
  },
  stocks: {
    description: 'Finnhub stock data',
    endpoints: ['quote', 'search', 'profile'],
    exampleParams: { quote: { symbol: 'AAPL' } },
    dailyLimit: 50,
    hasLimit: true,
    alternatives: ['crypto (CoinGecko, FREE, unlimited)', 'Use static demo stock data']
  },
  news: {
    description: 'NewsAPI headlines',
    endpoints: ['headlines', 'everything'],
    exampleParams: { headlines: { country: 'us', category: 'technology' } },
    dailyLimit: 30,
    hasLimit: true,
    alternatives: ['hackernews (FREE, unlimited)', 'Use static headlines array']
  },
  geocoding: {
    description: 'LocationIQ coordinates',
    endpoints: ['forward', 'reverse'],
    exampleParams: { forward: { q: '1600 Pennsylvania Ave, Washington DC' } },
    dailyLimit: 50,
    hasLimit: true,
    alternatives: ['ipgeo (FREE, for IP-based location)', 'Use hardcoded coordinates for demo']
  },
  currency: {
    description: 'Exchange rates',
    endpoints: ['latest', 'pair'],
    exampleParams: { latest: { base: 'USD' } },
    dailyLimit: 50,
    hasLimit: true,
    alternatives: ['crypto (includes stablecoin prices)', 'Use static exchange rates']
  },

  // ========== FREE APIs (UNLIMITED) ==========
  crypto: {
    description: 'CoinGecko prices (FREE, UNLIMITED)',
    endpoints: ['price', 'markets', 'trending'],
    exampleParams: { price: { ids: 'bitcoin,ethereum', vs_currencies: 'usd' } },
    hasLimit: false,
    isFree: true
  },
  quotes: {
    description: 'Inspirational quotes (FREE, UNLIMITED)',
    endpoints: ['random', 'quotes'],
    exampleParams: { random: {} },
    hasLimit: false,
    isFree: true
  },
  randomuser: {
    description: 'Fake user data (FREE, UNLIMITED)',
    endpoints: ['user', 'multiple'],
    exampleParams: { multiple: { results: 10 } },
    hasLimit: false,
    isFree: true
  },
  countries: {
    description: 'Country data (FREE, UNLIMITED)',
    endpoints: ['all', 'name', 'code'],
    exampleParams: { name: { name: 'united states' } },
    hasLimit: false,
    isFree: true
  },
  wikipedia: {
    description: 'Article summaries (FREE, UNLIMITED)',
    endpoints: ['summary', 'random'],
    exampleParams: { summary: { title: 'React (software)' } },
    hasLimit: false,
    isFree: true
  },
  jokes: {
    description: 'Programming jokes (FREE, UNLIMITED)',
    endpoints: ['any', 'programming'],
    exampleParams: { programming: {} },
    hasLimit: false,
    isFree: true
  },
  hackernews: {
    description: 'Hacker News stories (FREE, UNLIMITED)',
    endpoints: ['top', 'new', 'best'],
    exampleParams: { top: {} },
    hasLimit: false,
    isFree: true
  },
  dictionary: {
    description: 'Word definitions (FREE, UNLIMITED)',
    endpoints: ['define'],
    exampleParams: { define: { word: 'programming' } },
    hasLimit: false,
    isFree: true
  },
  weatheralerts: {
    description: 'NOAA weather alerts US only (FREE, UNLIMITED)',
    endpoints: ['alerts', 'point'],
    exampleParams: { alerts: { state: 'CA' } },
    hasLimit: false,
    isFree: true
  },
  ipgeo: {
    description: 'IP geolocation (FREE, UNLIMITED)',
    endpoints: ['lookup'],
    exampleParams: { lookup: {} },
    hasLimit: false,
    isFree: true
  }
};

/**
 * Execute a Platform API call during code generation
 * Uses internal endpoint to proxy requests through our rate-limited API
 *
 * @param {string} apiType - Type of API (images, weather, stocks, etc.)
 * @param {string} endpoint - API endpoint to call
 * @param {Object} params - API parameters
 * @returns {Promise<Object>} - API response data or error
 */
async function executePlatformApiCall(apiType, endpoint, params = {}) {
  const config = PLATFORM_API_CONFIG[apiType];
  if (!config) {
    return {
      success: false,
      error: `Unknown API type: ${apiType}`,
      available: Object.keys(PLATFORM_API_CONFIG)
    };
  }

  // Build the internal API URL
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'https://ezcoder-main.fly.dev';
  const url = new URL(`${baseUrl}/api/platform/${apiType}`);

  // Add endpoint
  url.searchParams.set('endpoint', endpoint);

  // Add all params
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Project-Token': GENERATION_PROJECT_TOKEN || 'internal-generation',
        'X-Generation-Request': 'true',
        'User-Agent': 'EzCoder-Generation/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[PlatformAPI] ${apiType}/${endpoint} failed:`, response.status, errorText);

      // Return graceful fallback for common cases
      return {
        success: false,
        error: `API returned ${response.status}`,
        hint: `The ${apiType} API is temporarily unavailable. Use placeholder data instead.`
      };
    }

    const data = await response.json();
    console.log(`[PlatformAPI] ${apiType}/${endpoint} success:`, data.success);

    // Build usage info for AI awareness
    const usage = data.usage || {};
    const usageWarning = usage.remaining !== undefined && usage.remaining < 10
      ? `WARNING: Only ${usage.remaining} calls remaining today for ${apiType}. Consider using FREE alternatives.`
      : null;

    return {
      success: true,
      data: data.data,
      cached: data.cached,
      apiType,
      endpoint,
      // Include usage info so AI knows when to switch to alternatives
      usage: {
        today: usage.today || 0,
        limit: usage.limit || config.dailyLimit || 100,
        remaining: usage.remaining !== undefined ? usage.remaining : (config.dailyLimit || 100),
        isFree: config.isFree || false
      },
      usageWarning,
      alternatives: config.alternatives || null
    };

  } catch (error) {
    console.error(`[PlatformAPI] ${apiType}/${endpoint} error:`, error.message);

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout',
        hint: 'The API took too long to respond. Use placeholder data instead.'
      };
    }

    return {
      success: false,
      error: error.message,
      hint: `Could not connect to ${apiType} API. Use placeholder data instead.`
    };
  }
}

// =============================================================================
// PLACEHOLDER URL DETECTION & ENFORCEMENT
// =============================================================================

/**
 * Detect placeholder URLs in file content
 * Returns { hasPlaceholders: boolean, urls: string[], suggestions: string[] }
 */
function detectPlaceholderUrls(content, filePath) {
  const placeholderPatterns = [
    /https?:\/\/(www\.)?(via\.)?placeholder\.(com|co)[^"'`\s]*/gi,
    /https?:\/\/placehold\.(co|it)[^"'`\s]*/gi,
    /https?:\/\/picsum\.photos[^"'`\s]*/gi,
    /\/placeholder[^"'`\s]*\.(svg|png|jpg|jpeg|webp)/gi,
    /\/images\/placeholder[^"'`\s]*/gi,
    /https?:\/\/dummyimage\.com[^"'`\s]*/gi,
    /https?:\/\/fakeimg\.pl[^"'`\s]*/gi,
  ];

  const foundUrls = [];
  for (const pattern of placeholderPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      foundUrls.push(...matches);
    }
  }

  if (foundUrls.length === 0) {
    return { hasPlaceholders: false, urls: [], suggestions: [] };
  }

  // Generate suggestions for each placeholder
  const suggestions = foundUrls.map(url => {
    // Analyze context to suggest appropriate replacement
    if (url.includes('150') || url.includes('avatar') || content.includes('avatar')) {
      return 'Use platformApi({ apiType: "randomuser", endpoint: "user" }) for avatar images';
    }
    if (url.includes('1200') || url.includes('hero') || content.includes('hero')) {
      return 'Use platformApi({ apiType: "images", endpoint: "search", params: { query: "relevant-topic" } }) for hero images';
    }
    return 'Use platformApi({ apiType: "images", endpoint: "search", params: { query: "relevant-topic" } }) for real images';
  });

  return {
    hasPlaceholders: true,
    urls: [...new Set(foundUrls)], // Dedupe
    suggestions: [...new Set(suggestions)],
  };
}

// =============================================================================
// DESIGN GUIDANCE BUILDER
// =============================================================================

/**
 * Build context-aware design guidance based on project type
 * Analyzes the user's prompt to determine appropriate visual direction
 *
 * @param {string} userMessage - User's prompt
 * @param {string} projectType - Detected project type
 * @returns {string} Design guidance section for system prompt
 */
function buildDesignGuidance(userMessage, projectType) {
  const messageLower = userMessage.toLowerCase();

  // Design direction presets based on project context
  const designPresets = {
    professional: {
      description: 'Professional/Corporate',
      palette: 'Clean blues (#3B82F6), trustworthy grays (#4B5563), subtle whites',
      typography: 'Clean sans-serif (Inter, system-ui), clear hierarchy',
      components: 'Subtle shadows, generous whitespace, clear CTAs, professional imagery',
      mood: 'Trust, competence, reliability'
    },
    playful: {
      description: 'Playful/Creative',
      palette: 'Vibrant colors (#8B5CF6 purple, #EC4899 pink, #10B981 teal), gradients',
      typography: 'Rounded fonts, varied weights, fun headings',
      components: 'Rounded corners (lg), bounce animations, colorful icons, illustrations',
      mood: 'Fun, engaging, approachable'
    },
    luxury: {
      description: 'Luxury/Premium',
      palette: 'Dark backgrounds (#0F172A), gold accents (#D4AF37), cream (#FFFBEB)',
      typography: 'Elegant serif headings, refined sans-serif body, generous letter-spacing',
      components: 'Subtle borders, fade animations, high-quality imagery, minimalist layout',
      mood: 'Exclusive, sophisticated, premium'
    },
    minimal: {
      description: 'Minimal/Modern',
      palette: 'Monochrome (black, white, grays), single accent color',
      typography: 'Thin weights, large sizes, extreme contrast',
      components: 'No borders, large whitespace, subtle hover states, micro-interactions',
      mood: 'Clean, focused, modern'
    },
    warm: {
      description: 'Warm/Friendly',
      palette: 'Warm tones (#F59E0B amber, #EF4444 red, #F97316 orange), cream backgrounds',
      typography: 'Friendly rounded sans-serif, warm weights',
      components: 'Soft shadows, warm photography, welcoming CTAs, personal imagery',
      mood: 'Welcoming, approachable, personal'
    },
    tech: {
      description: 'Tech/Developer',
      palette: 'Dark mode (#1E293B), neon accents (#22D3EE cyan, #A855F7 purple)',
      typography: 'Monospace elements, clean sans-serif, code-like styling',
      components: 'Terminal aesthetics, syntax highlighting, sharp corners, glow effects',
      mood: 'Technical, innovative, cutting-edge'
    },
    nature: {
      description: 'Nature/Organic',
      palette: 'Earthy greens (#059669, #22C55E), browns (#92400E), natural tans',
      typography: 'Organic shapes, varying weights, natural feel',
      components: 'Leaf/nature motifs, texture overlays, natural imagery, flowing layouts',
      mood: 'Natural, sustainable, calming'
    },
    healthcare: {
      description: 'Healthcare/Medical',
      palette: 'Calming blues (#0EA5E9), clinical whites, soft greens (#10B981)',
      typography: 'Clear, readable, accessible sizes, high contrast',
      components: 'Rounded corners, calming imagery, clear information hierarchy, trust signals',
      mood: 'Trustworthy, caring, professional'
    }
  };

  // Detect appropriate design direction from context
  let selectedPreset = 'professional'; // Default

  // Luxury/Premium indicators
  if (/luxury|premium|exclusive|high-?end|boutique|elegant|sophisticated/i.test(messageLower)) {
    selectedPreset = 'luxury';
  }
  // Playful/Fun indicators
  else if (/fun|playful|game|kids|colorful|vibrant|creative|social|community/i.test(messageLower)) {
    selectedPreset = 'playful';
  }
  // Tech/Developer indicators
  else if (/developer|coding|tech|startup|ai|saas|api|dashboard|developer|programming/i.test(messageLower)) {
    selectedPreset = 'tech';
  }
  // Minimal/Modern indicators
  else if (/minimal|modern|clean|simple|sleek|portfolio/i.test(messageLower)) {
    selectedPreset = 'minimal';
  }
  // Warm/Friendly indicators
  else if (/friendly|warm|cozy|personal|blog|cafe|restaurant|food|bakery|home/i.test(messageLower)) {
    selectedPreset = 'warm';
  }
  // Nature/Organic indicators
  else if (/nature|organic|eco|sustainable|green|wellness|yoga|meditation|outdoor/i.test(messageLower)) {
    selectedPreset = 'nature';
  }
  // Healthcare indicators
  else if (/health|medical|clinic|doctor|hospital|care|wellness|therapy|fitness/i.test(messageLower)) {
    selectedPreset = 'healthcare';
  }
  // Professional by default for business/corporate
  else if (/business|corporate|enterprise|consulting|law|finance|insurance|agency/i.test(messageLower)) {
    selectedPreset = 'professional';
  }

  const preset = designPresets[selectedPreset];

  return `## Design Direction: ${preset.description}

**Color Palette**: ${preset.palette}
**Typography**: ${preset.typography}
**Components**: ${preset.components}
**Mood**: ${preset.mood}

IMPORTANT: Apply these design principles consistently. Do NOT use generic gray/blue defaults.
Match the visual style to the project's purpose and target audience.`;
}

// =============================================================================
// TOOL DEFINITIONS (Same as anthropic-chat.js)
// =============================================================================

const CODER_TOOLS = [
  {
    name: 'writeFile',
    description: 'Create a new file or completely overwrite an existing file. After creating a file, continue creating more files if the feature requires multiple files.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path for the file (e.g., "src/App.tsx", "components/Button.jsx")'
        },
        content: {
          type: 'string',
          description: 'Complete content to write to the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'readFile',
    description: 'Read the contents of a file. Always read files before editing them.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to read'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'editFile',
    description: 'Edit an existing file by finding and replacing specific text.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to edit'
        },
        old_string: {
          type: 'string',
          description: 'Exact text to find (must match perfectly)'
        },
        new_string: {
          type: 'string',
          description: 'Text to replace it with'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurrences (default: false)'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'deleteFile',
    description: 'Delete a file from the project.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file to delete'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'listDirectory',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path (default: root)'
        }
      },
      required: []
    }
  },
  {
    name: 'glob',
    description: 'Find files matching a pattern (e.g., "*.js", "src/**/*.tsx").',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'grep',
    description: 'Search for text patterns within files.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for'
        },
        directory: {
          type: 'string',
          description: 'Directory to search in (default: root)'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'platformApi',
    description: `Fetch real data from platform APIs during code generation. Use this to get REAL images, weather, stocks, news, etc. instead of using placeholder data.

AVAILABLE APIs (with daily limits - check usage in response):

LIMITED APIs (prefer FREE alternatives when usage is high):
- images: Unsplash photos (50/day) → Alternative: https://source.unsplash.com/800x600/?{query}
- weather: OpenWeatherMap (100/day) → Alternative: weatheralerts (FREE, US only)
- stocks: Finnhub quotes (50/day) → Alternative: crypto (FREE)
- news: NewsAPI headlines (30/day) → Alternative: hackernews (FREE)
- geocoding: LocationIQ (50/day) → Alternative: ipgeo (FREE)
- currency: Exchange rates (50/day) → Alternative: crypto stablecoins

FREE APIs (UNLIMITED - prefer these):
- crypto: CoinGecko prices (FREE)
- quotes: Inspirational quotes (FREE)
- randomuser: Fake user data (FREE)
- countries: Country data (FREE)
- wikipedia: Article summaries (FREE)
- jokes: Programming jokes (FREE)
- hackernews: HN stories (FREE)
- dictionary: Word definitions (FREE)
- weatheralerts: NOAA alerts US (FREE)
- ipgeo: IP geolocation (FREE)

USAGE AWARENESS:
- Response includes "usage" object with today/limit/remaining counts
- If remaining < 10, switch to FREE alternative
- If API returns 429 (rate limit), use fallback URL provided

WHEN TO USE:
- Hero sections: images (or source.unsplash.com if low)
- User testimonials: randomuser (FREE)
- Finance: crypto (FREE) over stocks
- News: hackernews (FREE) over news API`,
    input_schema: {
      type: 'object',
      properties: {
        apiType: {
          type: 'string',
          description: 'API to call: images, weather, stocks, news, crypto, geocoding, quotes, randomuser, countries, wikipedia, jokes, hackernews',
          enum: ['images', 'weather', 'stocks', 'news', 'crypto', 'geocoding', 'quotes', 'randomuser', 'countries', 'wikipedia', 'jokes', 'hackernews', 'currency', 'dictionary']
        },
        endpoint: {
          type: 'string',
          description: 'API endpoint to call (varies by apiType). Examples: search, random, quote, current, headlines'
        },
        params: {
          type: 'object',
          description: 'API-specific parameters. Examples: { query: "mountain landscape" } for images, { symbol: "AAPL" } for stocks',
          additionalProperties: true
        }
      },
      required: ['apiType', 'endpoint']
    }
  }
];

// =============================================================================
// DATABASE TOOLS (Conditional - only when Supabase connected)
// =============================================================================

const DATABASE_TOOLS = [
  {
    name: 'queryDatabase',
    description: 'Execute a SELECT query against the connected Supabase database. Use this to read data or check existing records before making changes.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL SELECT query to execute. Must start with SELECT.'
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return (default: 100, max: 1000)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'executeSQL',
    description: 'Execute any SQL statement (CREATE, ALTER, INSERT, UPDATE, DELETE). All operations are logged for audit and rollback. Use dryRun=true to validate without executing.',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'SQL statement to execute'
        },
        description: {
          type: 'string',
          description: 'Brief description of what this SQL does (for audit log)'
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, validate the SQL without executing'
        }
      },
      required: ['sql', 'description']
    }
  },
  {
    name: 'getSchema',
    description: 'Get database schema information including tables, columns, relationships, indexes, and RLS policies. Essential before making schema changes.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['full', 'tables', 'columns', 'relationships', 'indexes', 'rls'],
          description: 'Type of schema info to retrieve (default: full)'
        },
        tableName: {
          type: 'string',
          description: 'Get schema for a specific table only'
        }
      },
      required: []
    }
  },
  {
    name: 'generateMigration',
    description: 'Generate SQL migration based on desired changes. Returns SQL without executing - use executeSQL to apply.',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description of the migration (e.g., "add email column to users table")'
        },
        includeRollback: {
          type: 'boolean',
          description: 'Include rollback (DOWN) SQL'
        }
      },
      required: ['description']
    }
  },
  {
    name: 'runMigration',
    description: 'Execute a migration with automatic savepoint for rollback. Wraps migration in transaction when possible.',
    input_schema: {
      type: 'object',
      properties: {
        upSQL: {
          type: 'string',
          description: 'The migration SQL to execute'
        },
        downSQL: {
          type: 'string',
          description: 'Rollback SQL (stored for manual rollback)'
        },
        migrationName: {
          type: 'string',
          description: 'Name/description of the migration'
        }
      },
      required: ['upSQL', 'migrationName']
    }
  }
];

// =============================================================================
// DATABASE CONNECTION REQUEST TOOL (Always available - AI can ask for credentials)
// =============================================================================

const DATABASE_CONNECTION_TOOL = {
  name: 'requestDatabaseConnection',
  description: 'Request database credentials from the user when you need to perform database operations (create tables, store data, implement backend). Call this BEFORE attempting to design database schemas or write database code. The workflow will pause and the user will provide their Supabase or Neon connection string.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why you need database access (e.g., "To create tables for user authentication and store user data")'
      },
      requiredCapabilities: {
        type: 'array',
        items: { type: 'string' },
        description: 'What database operations you need (e.g., ["create_tables", "insert_data", "auth"])'
      },
      suggestedProvider: {
        type: 'string',
        enum: ['supabase', 'neon'],
        description: 'Suggested provider based on project needs (supabase for auth/realtime, neon for serverless)'
      },
      plannedTables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            purpose: { type: 'string' }
          }
        },
        description: 'Tables you plan to create'
      }
    },
    required: ['reason']
  }
};

// =============================================================================
// SERVER & AUTH TOOLS (Conditional - only when Supabase connected)
// =============================================================================

const SERVER_AUTH_TOOLS = [
  {
    name: 'getSupabaseConfig',
    description: 'Get Supabase project configuration (URL and anon key) for client-side integration. Use this when setting up Supabase in the generated project.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'enableAuth',
    description: 'Enable Supabase Auth with specified providers (email, google, github, etc.). Returns setup instructions and code examples.',
    input_schema: {
      type: 'object',
      properties: {
        providers: {
          type: 'array',
          items: { type: 'string', enum: ['email', 'google', 'github', 'discord', 'twitter'] },
          description: 'Auth providers to enable'
        },
        redirectUrl: {
          type: 'string',
          description: 'OAuth redirect URL'
        }
      },
      required: ['providers']
    }
  },
  {
    name: 'createRLSPolicy',
    description: 'Create a Row Level Security policy to control which rows users can access. Essential for multi-tenant apps.',
    input_schema: {
      type: 'object',
      properties: {
        tableName: { type: 'string', description: 'Table name' },
        policyName: { type: 'string', description: 'Policy name' },
        operation: { type: 'string', enum: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'] },
        using: { type: 'string', description: 'SQL expression (e.g., "auth.uid() = user_id")' },
        withCheck: { type: 'string', description: 'Check expression for INSERT/UPDATE' }
      },
      required: ['tableName', 'policyName', 'operation', 'using']
    }
  },
  {
    name: 'generateApiRoute',
    description: 'Generate Next.js API route code with Supabase integration for backend endpoints.',
    input_schema: {
      type: 'object',
      properties: {
        routePath: { type: 'string', description: 'API path (e.g., "/api/users")' },
        methods: { type: 'array', items: { type: 'string' }, description: 'HTTP methods (GET, POST, etc.)' },
        requireAuth: { type: 'boolean', description: 'Require authentication' },
        description: { type: 'string', description: 'What the API does' }
      },
      required: ['routePath', 'methods', 'description']
    }
  },
  {
    name: 'createEdgeFunction',
    description: 'Generate a Supabase Edge Function for serverless logic, webhooks, or scheduled tasks.',
    input_schema: {
      type: 'object',
      properties: {
        functionName: { type: 'string', description: 'Function name' },
        description: { type: 'string', description: 'What it does' },
        useDatabase: { type: 'boolean', description: 'Needs database access' }
      },
      required: ['functionName', 'description']
    }
  }
];

/**
 * Get tools array based on user's capabilities
 * @param {Object} options - Options including supabase connection status
 * @returns {Array} Tools array for Anthropic API
 */
function getToolsForUser(options = {}) {
  const tools = [...CODER_TOOLS];

  // Always include requestDatabaseConnection tool so AI can ask for credentials
  // This enables the AI to proactively request database access when needed
  tools.push(DATABASE_CONNECTION_TOOL);

  // Add full database and server/auth tools if user has active database connection
  if (options.hasSupabaseConnection) {
    tools.push(...DATABASE_TOOLS);
    tools.push(...SERVER_AUTH_TOOLS);
  }

  return tools;
}

// =============================================================================
// SYSTEM PROMPT BUILDER
// =============================================================================

/**
 * Build the Coder's system prompt with context from silent agents
 *
 * ENHANCED with:
 * - Complete file listings (AI knows what exists)
 * - Pre-generation analysis (predicted components/icons)
 * - Dependency order guidance
 * - Icon pre-injection (prevents hallucinated icons)
 *
 * @param {Object} intent - Intent classification result
 * @param {Object} plan - Planning result with tasks
 * @param {Object} architecture - Architecture design (optional)
 * @param {Object} existingFiles - Current project files
 * @param {Object} options - Additional options
 * @param {Object} options.requestAnalysis - Pre-generation analysis
 * @param {Object} options.iconAnalysis - Icon pre-injection analysis
 * @param {Object} options.dependencyResolution - Ordered files
 * @returns {string} - Complete system prompt for Coder
 */
function buildCoderSystemPrompt(intent, plan, architecture, existingFiles, options = {}) {
  const fileCount = Object.keys(existingFiles).length;
  const filePaths = Object.keys(existingFiles);
  const { requestAnalysis, iconAnalysis, dependencyResolution, activeFile, scaffoldContext, userMessage } = options;

  // Build understanding section from silent agents
  const understanding = [];

  if (intent?.reasoning) {
    understanding.push(`User wants: ${intent.reasoning}`);
  }

  if (plan?.summary) {
    understanding.push(`Approach: ${plan.summary}`);
  }

  if (plan?.tasks?.length > 0) {
    const fileList = plan.tasks
      .filter(t => t.targetFile)
      .map(t => t.targetFile)
      .join(', ');
    if (fileList) {
      understanding.push(`Files to create/modify: ${fileList}`);
    }
  }

  if (architecture?.overview) {
    understanding.push(`Architecture: ${architecture.overview}`);
  }

  // Build file listing section (CRITICAL - AI needs to know what exists)
  const fileListingSection = buildFileListingSection(filePaths);

  // Build pre-generation guidance from request analysis
  const preGenGuidance = requestAnalysis
    ? buildPreGenerationGuidance(requestAnalysis)
    : '';

  // Build icon injection section - CRITICAL for preventing hallucinations
  // Make this prominent and enforceable
  const iconSection = iconAnalysis?.promptSnippet
    ? `## ⚠️ ICON RULES (CRITICAL - READ BEFORE WRITING CODE)

${iconAnalysis.promptSnippet}

### STRICT ENFORCEMENT:
- ONLY use icons listed above - they are the ONLY valid lucide-react exports
- If you need an icon not listed, pick the closest match from the list
- DO NOT invent icon names - the following DO NOT EXIST:
  CowIcon, Casino, Fire, Gambling, Slot, SlotMachine, Poker, Roulette, Money, Cash
- Safe fallbacks when unsure: Check, X, Plus, Minus, Settings, User, Home, Search, Star, Heart
- Import syntax: \`import { IconName } from 'lucide-react'\`
`
    : '';

  // Build dependency order guidance
  const depOrderSection = dependencyResolution?.orderedFiles?.length > 0
    ? buildDependencyOrderSection(dependencyResolution)
    : '';

  // Build scaffold injection section (terse, ~300 tokens total)
  const scaffoldSection = scaffoldContext
    ? buildScaffoldSection(scaffoldContext)
    : '';

  // Build design guidance section (context-aware styling)
  const designGuidance = userMessage
    ? buildDesignGuidance(userMessage, requestAnalysis?.projectType || null)
    : '';

  // Build available packages section (cached for performance)
  const packagesSection = buildAvailablePackagesSection();

  // Compress file contents for context (limit to most relevant)
  const fileContexts = Object.entries(existingFiles)
    .slice(0, 8) // Limit to 8 files for context window
    .map(([path, content]) => {
      const truncated = content.length > 1500
        ? content.slice(0, 1500) + '\n... (truncated)'
        : content;
      return `### ${path}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  return `You are an expert full-stack developer in a live code editor with instant preview.
The user sees every file change immediately in the preview.

## Understanding (from analysis)
${understanding.length > 0 ? understanding.join('\n') : 'Build what the user requested.'}

${designGuidance}

${iconSection}

## EXISTING FILES IN PROJECT
${fileListingSection}

${packagesSection}

${preGenGuidance}

${depOrderSection}

${scaffoldSection}

## Your Workflow
1. Start with a brief acknowledgment (1 sentence max)
2. FIRST: Check if src/lib/utils.ts exists - CREATE IT FIRST if not
3. THEN: Create UI components in src/components/ui/ BEFORE importing them
4. Use writeFile to create files - one at a time, but keep going until done
5. Always update App.tsx to import and render new components
6. Continue until the feature is complete

## CRITICAL: Generation Order (Prevents Blank Screens)
1. Foundation files FIRST (utils.ts)
2. UI components SECOND (button.tsx, card.tsx, etc.)
3. Feature components THIRD (using the UI components)
4. App.tsx/main LAST (imports everything)

NEVER import a file you haven't created yet. The preview will show a blank screen.

## CRITICAL: Keep Creating Files Until Done
- After EACH writeFile completes, immediately create the next file
- Minimum 3 files for any feature: main component + App.tsx update + supporting files
- Do NOT stop to explain between files - just keep creating
- Only summarize AFTER you've created all necessary files

## Code Quality Rules
- Use template literals or double quotes for strings with apostrophes
- Always close all brackets, parentheses, and tags
- Check JSX syntax carefully - all tags must be properly closed
- ICONS: Only use icons from the "ICON RULES" section above - never invent names

## ⚠️ IMAGE RULES (CRITICAL - NO PLACEHOLDERS ALLOWED)

**BANNED URLs - NEVER USE THESE:**
- ❌ \`placeholder.com\`, \`via.placeholder.com\`, \`placehold.co\`
- ❌ \`/placeholder.svg\`, \`/placeholder.png\`, \`/placeholder-*.jpg\`
- ❌ \`picsum.photos\` (low quality placeholder service)
- ❌ Any URL containing "placeholder", "dummy", or "example"
- ❌ Gray boxes or colored rectangles as image substitutes

**REQUIRED: Use Real Images via platformApi:**
\`\`\`
// BEFORE writing any code with images, ALWAYS call this first:
platformApi({ apiType: "images", endpoint: "search", params: { query: "RELEVANT_QUERY", per_page: 5 } })
\`\`\`

**Image Query Examples by Section:**
| Section | Query Example |
|---------|---------------|
| Hero background | "modern office workspace", "abstract gradient", "nature landscape" |
| Team/About | "professional headshot", "business portrait" |
| Products | "product photography white background", "ecommerce product" |
| Testimonials | Use \`randomuser\` API for realistic avatars |
| Blog/News | "technology", "business meeting", "startup" |
| Food/Restaurant | "gourmet food plating", "restaurant interior" |
| Real Estate | "modern house exterior", "luxury apartment interior" |
| Fitness | "gym workout", "fitness training" |

**Fallback Pattern (if platformApi fails):**
Use Unsplash Source URLs with relevant queries:
\`\`\`
https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=800&q=80
// OR dynamic:
https://source.unsplash.com/800x600/?office,modern
\`\`\`

## Platform APIs (Fetch Real Data)

**For Better Looking Websites:**
- \`platformApi({ apiType: "images", endpoint: "search", params: { query: "mountain landscape", per_page: 3 } })\`
  → Get real Unsplash photos for hero sections, cards, galleries
- \`platformApi({ apiType: "randomuser", endpoint: "multiple", params: { results: 5 } })\`
  → Get realistic user avatars and names for testimonials, team pages

**For Real Data Demos:**
- \`platformApi({ apiType: "weather", endpoint: "current", params: { q: "New York" } })\`
- \`platformApi({ apiType: "stocks", endpoint: "quote", params: { symbol: "AAPL" } })\`
- \`platformApi({ apiType: "crypto", endpoint: "price", params: { ids: "bitcoin", vs_currencies: "usd" } })\`
- \`platformApi({ apiType: "news", endpoint: "headlines", params: { country: "us" } })\`

## Environment-Specific Rules
- Do NOT modify vite.config.ts unless explicitly asked - it's pre-configured
- If you must create vite.config.ts:
  - Use port 3002 (port 3001 is reserved for daemon API, port 3000 for preview proxy)
  - Always set hmr: false (required for the preview environment)
  - Set host: "0.0.0.0" for container compatibility

## Current File Contents (${fileCount} files)
${fileContexts || '(empty project - start fresh!)'}

${activeFile ? `Currently editing: ${activeFile}` : ''}

Start creating files now. Be conversational but concise.`;
}

/**
 * Build file listing section for system prompt
 */
function buildFileListingSection(filePaths) {
  if (filePaths.length === 0) {
    return '**No files exist yet** - This is a new project. Start fresh!';
  }

  const sections = ['**These files already exist - import them, do NOT recreate:**\n'];

  // Group by directory
  const byDir = {};
  for (const path of filePaths) {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const file = parts.pop();
    const dir = parts.join('/') || 'root';
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(file);
  }

  // Output grouped
  for (const [dir, files] of Object.entries(byDir).sort()) {
    sections.push(`**${dir}/**`);
    for (const file of files.slice(0, 15)) {
      sections.push(`  - ${file}`);
    }
    if (files.length > 15) {
      sections.push(`  - ... and ${files.length - 15} more`);
    }
  }

  // Highlight critical files
  const hasUtils = filePaths.some(f => f.includes('lib/utils'));
  if (hasUtils) {
    sections.push('\n**utils.ts EXISTS** - use: `import { cn } from "@/lib/utils"`');
  } else {
    sections.push('\n**WARNING: No utils.ts** - CREATE IT FIRST before any UI components');
  }

  return sections.join('\n');
}

/**
 * Build pre-generation guidance from request analysis
 */
function buildPreGenerationGuidance(analysis) {
  const sections = ['## Pre-Generation Analysis'];

  if (analysis.projectType) {
    sections.push(`**Project Type**: ${analysis.projectType} (${analysis.complexity} complexity)`);
  }

  if (analysis.missingComponents.length > 0) {
    sections.push(`\n**Components to CREATE** (in this order):`);
    for (const comp of analysis.generationOrder.slice(0, 10)) {
      const missing = analysis.missingComponents.includes(comp);
      sections.push(`  ${missing ? 'CREATE' : 'EXISTS'}: ${comp}`);
    }
  }

  if (analysis.features.length > 0) {
    sections.push(`\n**Features Detected**: ${analysis.features.join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Build dependency order section
 */
function buildDependencyOrderSection(resolution) {
  const sections = ['## File Creation Order (FOLLOW THIS)'];

  // Foundations first
  if (resolution.foundations.length > 0) {
    sections.push('\n**1. Create Foundations FIRST:**');
    for (const f of resolution.foundations) {
      sections.push(`   - ${f.path} (${f.reason})`);
    }
  }

  // Then ordered files
  if (resolution.orderedFiles.length > 0) {
    sections.push('\n**2. Then Create in This Order:**');
    for (let i = 0; i < Math.min(resolution.orderedFiles.length, 10); i++) {
      const file = resolution.orderedFiles[i];
      sections.push(`   ${i + 1}. ${file.path}`);
    }
  }

  return sections.join('\n');
}

/**
 * Build scaffold injection section (TRIMMED - ~140 tokens budget)
 * Provides minimal context about scaffold files that AI should import, not recreate.
 *
 * Token budget breakdown:
 * - Header: ~10 tokens
 * - Per scaffold import line: ~15 tokens
 * - Utils note: ~15 tokens
 * - Integration hints: ~20 tokens each
 * - Footer: ~15 tokens
 */
function buildScaffoldSection(scaffoldContext) {
  if (!scaffoldContext || !scaffoldContext.scaffoldsToInject?.length) {
    return '';
  }

  const parts = ['## Pre-built Scaffolds (DO NOT recreate)'];

  const alwaysOn = scaffoldContext.scaffoldsToInject.filter(s => s.injectionReason === 'always-on');
  const triggered = scaffoldContext.scaffoldsToInject.filter(s => s.injectionReason === 'triggered');

  // Triggered scaffolds - only list key imports, not all files
  if (triggered.length > 0) {
    for (const scaffold of triggered) {
      // Extract just the key import paths (hooks, contexts, main components)
      const keyImports = (scaffold.files || [])
        .filter(f => f.path.includes('context') || f.path.includes('hook') || f.path.includes('lib/'))
        .map(f => `\`@/${f.path.replace('src/', '')}\``)
        .slice(0, 3);

      if (keyImports.length > 0) {
        parts.push(`- **${scaffold.id}**: import from ${keyImports.join(', ')}`);
      }
    }
  }

  // Always-on - just mention they exist
  if (alwaysOn.length > 0) {
    parts.push(`- **utils**: SEO components, ErrorBoundary, analytics hooks pre-installed`);
  }

  // Interconnections - brief
  if (scaffoldContext.interconnections?.length > 0) {
    parts.push(`- **wired**: ${scaffoldContext.interconnections.join(', ')}`);
  }

  // Only critical integration notes (no verbose descriptions)
  if (triggered.some(s => s.id === 'auth')) {
    parts.push('Auth: useAuth() from @/contexts/auth-context, ProtectedRoute component');
  }
  if (triggered.some(s => s.id === 'payments')) {
    parts.push('Payments: useSubscription() hook, BuyButton/PricingTable components');
  }

  parts.push('');
  parts.push('Import these. Do not recreate auth, payments, or analytics infrastructure.');

  return parts.join('\n');
}

// =============================================================================
// TOOL EXECUTION (With Real-Time Validation)
// =============================================================================

/**
 * Execute a tool call with REAL-TIME VALIDATION
 *
 * Key enhancement: After each writeFile, we immediately validate the file
 * and auto-fix any issues (missing imports, bad icons, etc.) BEFORE
 * proceeding to the next file. This prevents cascading errors.
 *
 * @param {string} toolName - The tool to execute
 * @param {Object} args - Tool arguments
 * @param {Object} fileState - Current file state
 * @param {Object} executor - Optional executor for syncing
 * @param {string} projectId - Project ID
 * @param {RealtimeValidator} realtimeValidator - Real-time validator instance
 */
async function executeToolCall(toolName, args, fileState, executor, projectId, realtimeValidator = null) {
  console.log(`[UnifiedAgent] Executing tool: ${toolName}`, args?.file_path || '');

  switch (toolName) {
    case 'writeFile': {
      const { file_path, content } = args;

      // =====================================================================
      // PLACEHOLDER URL ENFORCEMENT: Reject files with placeholder images
      // =====================================================================
      const placeholderCheck = detectPlaceholderUrls(content, file_path);
      if (placeholderCheck.hasPlaceholders) {
        console.warn(`[UnifiedAgent] Placeholder URLs detected in ${file_path}:`, placeholderCheck.urls);

        // Return error with guidance on how to fix
        return {
          success: false,
          error: 'PLACEHOLDER_URLS_NOT_ALLOWED',
          path: file_path,
          message: `File contains ${placeholderCheck.urls.length} placeholder image URL(s). Use platformApi to get real images instead.`,
          placeholderUrls: placeholderCheck.urls.slice(0, 5), // Show first 5
          suggestions: placeholderCheck.suggestions,
          hint: 'Before writing this file, call platformApi({ apiType: "images", endpoint: "search", params: { query: "relevant-topic" } }) to get real Unsplash image URLs, then use those URLs in your code.',
        };
      }

      // =====================================================================
      // REAL-TIME VALIDATION: Validate and auto-fix IMMEDIATELY
      // =====================================================================
      let finalContent = content;
      let validationApplied = false;

      if (realtimeValidator) {
        try {
          const validation = await realtimeValidator.validateFile(file_path, content, fileState);

          if (!validation.valid && validation.autoFixes?.length > 0) {
            console.log(`[UnifiedAgent] Real-time validation: ${validation.autoFixes.length} fixes for ${file_path}`);

            // Apply fixes
            for (const fix of validation.autoFixes) {
              if (fix.fixedContent) {
                finalContent = fix.fixedContent;
                validationApplied = true;
              }
              // If fix created new files (like utils.ts), add them to state
              if (fix.createdFiles) {
                for (const created of fix.createdFiles) {
                  fileState[created.path] = created.content;
                  console.log(`[UnifiedAgent] Auto-created dependency: ${created.path}`);
                }
              }
            }
          }

          // Also fix any invalid icons
          const iconFix = fixIconImports(finalContent);
          if (iconFix.fixed) {
            finalContent = iconFix.content;
            console.log(`[UnifiedAgent] Fixed ${iconFix.changes.length} invalid icons in ${file_path}`);
            validationApplied = true;
          }
        } catch (validationError) {
          console.warn(`[UnifiedAgent] Real-time validation failed (non-blocking):`, validationError.message);
          // Continue with original content if validation fails
        }
      }

      // Save the (potentially fixed) content
      fileState[file_path] = finalContent;

      // Sync to executor if available
      if (executor?.writeFile) {
        try {
          await executor.writeFile(projectId, file_path, finalContent);
        } catch (e) {
          console.warn(`[UnifiedAgent] Executor sync failed: ${e.message}`);
        }
      }

      return {
        success: true,
        path: file_path,
        content: finalContent,
        size: finalContent.length,
        message: `Created ${file_path} (${finalContent.length} chars)`,
        validationApplied,
        originalSize: content.length,
      };
    }

    case 'readFile': {
      const { file_path } = args;
      if (fileState[file_path]) {
        return {
          success: true,
          path: file_path,
          content: fileState[file_path],
          source: 'local-state'
        };
      }
      return {
        success: false,
        error: `File not found: ${file_path}`
      };
    }

    case 'editFile': {
      const { file_path, old_string, new_string, replace_all = false } = args;
      let content = fileState[file_path];

      if (!content) {
        return {
          success: false,
          error: `File not found: ${file_path}`,
          hint: 'Use writeFile to create the file first.'
        };
      }

      let changes = 0;
      if (replace_all) {
        const regex = new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        changes = (content.match(regex) || []).length;
        content = content.replace(regex, new_string);
      } else if (content.includes(old_string)) {
        content = content.replace(old_string, new_string);
        changes = 1;
      }

      if (changes === 0) {
        return {
          success: false,
          error: 'String not found in file',
          hint: 'Consider using writeFile to replace the entire file.'
        };
      }

      fileState[file_path] = content;
      return {
        success: true,
        path: file_path,
        new_content: content,
        changes,
        message: `Replaced ${changes} occurrence(s)`
      };
    }

    case 'deleteFile': {
      const { file_path } = args;
      delete fileState[file_path];
      return { success: true, path: file_path };
    }

    case 'listDirectory': {
      const { directory = '' } = args;
      const prefix = directory ? directory + '/' : '';
      const items = new Set();

      for (const path of Object.keys(fileState)) {
        if (directory && !path.startsWith(prefix)) continue;
        const relative = directory ? path.slice(prefix.length) : path;
        const firstPart = relative.split('/')[0];
        items.add(firstPart);
      }

      return { success: true, files: Array.from(items), count: items.size };
    }

    case 'glob': {
      const { pattern } = args;
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      const regex = new RegExp(`^${regexPattern}$`);
      const matches = Object.keys(fileState).filter(p => regex.test(p));
      return { success: true, files: matches, count: matches.length };
    }

    case 'grep': {
      const { pattern, directory = '' } = args;
      const matches = [];
      const regex = new RegExp(pattern, 'gi');

      for (const [filePath, content] of Object.entries(fileState)) {
        if (directory && !filePath.startsWith(directory)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({
              file: filePath,
              line: i + 1,
              content: lines[i].trim().slice(0, 200)
            });
          }
          regex.lastIndex = 0;
        }
      }

      return { success: true, matches, total_matches: matches.length };
    }

    case 'platformApi': {
      const { apiType, endpoint, params = {} } = args;

      console.log(`[UnifiedAgent] Platform API call: ${apiType}/${endpoint}`, params);

      // Get config for alternatives info
      const apiConfig = PLATFORM_API_CONFIG[apiType];

      // Execute the platform API call
      const result = await executePlatformApiCall(apiType, endpoint, params);

      if (!result.success) {
        // Return graceful error with hints for fallback
        return {
          success: false,
          apiType,
          endpoint,
          error: result.error,
          hint: result.hint || `Use placeholder data for ${apiType} content instead.`,
          // Provide fallback suggestions based on API type
          fallback: getPlatformApiFallback(apiType, endpoint, params),
          // Include alternatives so AI can try a different approach
          alternatives: apiConfig?.alternatives || null,
          fallbackUrl: apiConfig?.fallbackUrl ? apiConfig.fallbackUrl(params) : null
        };
      }

      // Format response based on API type for AI consumption
      const response = {
        success: true,
        apiType,
        endpoint,
        data: result.data,
        cached: result.cached,
        hint: formatPlatformApiHint(apiType, endpoint, result.data),
        // Include usage info so AI knows when limits are approaching
        usage: result.usage
      };

      // Add warning if usage is getting low
      if (result.usageWarning) {
        response.usageWarning = result.usageWarning;
        response.alternatives = result.alternatives;
      }

      return response;
    }

    // =========================================================================
    // DATABASE TOOLS (require Supabase connection)
    // =========================================================================

    case 'queryDatabase':
    case 'executeSQL':
    case 'getSchema':
    case 'generateMigration':
    case 'runMigration': {
      // These tools require the databaseTools to be passed in context
      // We'll handle this in the calling code that has access to databaseTools
      return {
        success: false,
        error: 'DATABASE_TOOL_CONTEXT_REQUIRED',
        message: 'Database tools must be executed with proper context'
      };
    }

    // =========================================================================
    // SERVER/AUTH TOOLS (require Supabase connection)
    // =========================================================================

    case 'getSupabaseConfig':
    case 'enableAuth':
    case 'createRLSPolicy':
    case 'generateApiRoute':
    case 'createEdgeFunction': {
      // These tools require the serverAuthTools to be passed in context
      return {
        success: false,
        error: 'SERVER_AUTH_TOOL_CONTEXT_REQUIRED',
        message: 'Server/Auth tools must be executed with proper context'
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Execute database tool with proper context
 * Called from the streaming loop when database tools are used
 */
async function executeDatabaseTool(toolName, args, databaseTools) {
  if (!databaseTools) {
    return {
      success: false,
      error: 'No Supabase connection',
      message: 'Connect your Supabase account in Settings to use database tools'
    };
  }

  const tool = databaseTools[toolName];
  if (!tool || !tool.execute) {
    return {
      success: false,
      error: `Database tool not found: ${toolName}`
    };
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute requestDatabaseConnection tool
 * This pauses the workflow and asks the user for database credentials
 *
 * @param {Object} args - Tool arguments (reason, requiredCapabilities, etc.)
 * @param {Object} databaseTools - Existing database tools (may include requestDatabaseConnection)
 * @param {string} projectId - Current project ID
 * @returns {Object} - Result with action: 'PAUSE_FOR_USER_INPUT'
 */
async function executeDatabaseConnectionRequest(args, databaseTools, projectId) {
  // Check if we have the tool in databaseTools (from database-tools.js)
  if (databaseTools?.requestDatabaseConnection?.execute) {
    try {
      return await databaseTools.requestDatabaseConnection.execute(args);
    } catch (error) {
      console.error('[UnifiedAgent] requestDatabaseConnection error:', error);
      return {
        action: 'PAUSE_FOR_USER_INPUT',
        inputType: 'database_connection',
        prompt: {
          reason: args.reason || 'Database access needed',
          requiredCapabilities: args.requiredCapabilities || [],
          suggestedProvider: args.suggestedProvider || 'supabase',
          plannedTables: args.plannedTables || [],
          projectId
        }
      };
    }
  }

  // Fallback - return PAUSE_FOR_USER_INPUT directly
  console.log('[UnifiedAgent] Returning PAUSE_FOR_USER_INPUT for database connection');
  return {
    action: 'PAUSE_FOR_USER_INPUT',
    inputType: 'database_connection',
    prompt: {
      reason: args.reason || 'Database access needed',
      requiredCapabilities: args.requiredCapabilities || [],
      suggestedProvider: args.suggestedProvider || 'supabase',
      plannedTables: args.plannedTables || [],
      projectId
    }
  };
}

/**
 * Get fallback suggestions when Platform API fails
 */
function getPlatformApiFallback(apiType, endpoint, params) {
  const fallbacks = {
    images: {
      message: 'Use Unsplash direct URLs as fallback',
      example: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
      pattern: `https://source.unsplash.com/800x600/?${params.query || 'nature'}`
    },
    weather: {
      message: 'Use static weather data for demo',
      example: { temp: 72, condition: 'Sunny', humidity: 45 }
    },
    stocks: {
      message: 'Use mock stock data for demo',
      example: { symbol: params.symbol || 'AAPL', price: 178.50, change: '+2.35%' }
    },
    news: {
      message: 'Use placeholder headlines',
      example: [
        { title: 'Breaking: Technology Advances', source: 'Tech News' },
        { title: 'Market Update: Stocks Rise', source: 'Finance Daily' }
      ]
    },
    randomuser: {
      message: 'Use static user data',
      example: {
        name: 'John Doe',
        email: 'john@example.com',
        avatar: 'https://i.pravatar.cc/150?img=1'
      }
    },
    quotes: {
      message: 'Use classic quotes',
      example: { content: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' }
    }
  };

  return fallbacks[apiType] || { message: 'Use placeholder content' };
}

/**
 * Format API response hint for AI to use the data effectively
 */
function formatPlatformApiHint(apiType, endpoint, data) {
  const hints = {
    images: () => {
      if (data?.results?.length > 0) {
        const img = data.results[0];
        return `Use this image URL: ${img.urls?.regular || img.urls?.small}. Alt text: "${img.alt_description || 'Photo'}"`;
      }
      if (data?.urls) {
        return `Use this image URL: ${data.urls?.regular || data.urls?.small}`;
      }
      return 'Image data received - extract URLs from data.results[].urls.regular';
    },
    weather: () => {
      if (data?.main) {
        return `Weather: ${Math.round(data.main.temp)}°F, ${data.weather?.[0]?.description || 'clear'}`;
      }
      return 'Weather data received - use data.main.temp and data.weather[0].description';
    },
    stocks: () => {
      if (data?.c) {
        return `Stock price: $${data.c} (change: ${data.dp > 0 ? '+' : ''}${data.dp?.toFixed(2)}%)`;
      }
      return 'Stock data received - use data.c for current price';
    },
    randomuser: () => {
      if (data?.results?.length > 0) {
        const user = data.results[0];
        return `User: ${user.name?.first} ${user.name?.last}, avatar: ${user.picture?.large}`;
      }
      return 'User data received - use data.results[0].name and data.results[0].picture';
    },
    quotes: () => {
      if (data?.content) {
        return `Quote: "${data.content}" - ${data.author}`;
      }
      return 'Quote data received - use data.content and data.author';
    },
    crypto: () => {
      if (typeof data === 'object') {
        const coin = Object.keys(data)[0];
        if (coin && data[coin]?.usd) {
          return `${coin}: $${data[coin].usd.toLocaleString()}`;
        }
      }
      return 'Crypto data received - prices in data.{coin}.usd format';
    }
  };

  const formatter = hints[apiType];
  if (formatter) {
    try {
      return formatter();
    } catch (e) {
      return `${apiType} data received successfully`;
    }
  }
  return `${apiType} data received - use the data object in your code`;
}

// =============================================================================
// AGENTIC LOOP (VISIBLE CODER)
// =============================================================================

/**
 * Run the visible Coder agent with streaming + REAL-TIME VALIDATION
 *
 * Enhanced: Each writeFile is validated immediately, with auto-fixes
 * applied before proceeding. This prevents cascading import errors.
 */
async function runCoderWithStreaming(options) {
  const {
    messages,
    systemPrompt,
    model,
    fileState,
    executor,
    projectId,
    onTextDelta,
    onToolUse,
    onToolResult,
    userId,
    realtimeValidator, // NEW: Real-time validation during generation
    // Database tools support
    supabaseConnection, // User's active Supabase connection (if any)
    databaseTools, // Pre-initialized database tools (if supabase connected)
  } = options;

  const client = getClient();
  const MAX_ITERATIONS = 20;
  let iteration = 0;
  let totalToolCalls = 0;
  const filesModified = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[UnifiedAgent] Coder iteration ${iteration}`);

    // Get tools based on user capabilities
    const tools = getToolsForUser({
      hasSupabaseConnection: !!supabaseConnection
    });

    // Stream from Claude
    const stream = await client.messages.stream({
      model,
      max_tokens: 8000,
      system: systemPrompt,
      messages,
      tools
    });

    // Collect tool uses
    const toolUsesInIteration = [];
    let currentToolUse = null;
    let inputJsonBuffer = '';

    // Stream events
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: {}
          };
          inputJsonBuffer = '';

          onToolUse?.({
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
            args: {},
            status: 'starting'
          });
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          onTextDelta?.(event.delta.text);
        } else if (event.delta.type === 'input_json_delta') {
          inputJsonBuffer += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          try {
            if (inputJsonBuffer) {
              currentToolUse.input = JSON.parse(inputJsonBuffer);
            }
          } catch (e) {
            currentToolUse.input = {};
          }

          toolUsesInIteration.push(currentToolUse);

          onToolUse?.({
            toolCallId: currentToolUse.id,
            toolName: currentToolUse.name,
            args: currentToolUse.input,
            status: 'complete'
          });

          currentToolUse = null;
          inputJsonBuffer = '';
        }
      }
    }

    // Get final message
    const finalMessage = await stream.finalMessage();

    // Track tokens
    if (finalMessage.usage) {
      totalInputTokens += finalMessage.usage.input_tokens || 0;
      totalOutputTokens += finalMessage.usage.output_tokens || 0;
    }

    // No tools = done
    if (toolUsesInIteration.length === 0) {
      console.log(`[UnifiedAgent] Coder finished (no tools), iteration ${iteration}`);
      break;
    }

    // Execute tools with REAL-TIME VALIDATION
    const toolResults = [];
    const DATABASE_TOOL_NAMES = ['queryDatabase', 'executeSQL', 'getSchema', 'generateMigration', 'runMigration'];
    const SERVER_AUTH_TOOL_NAMES = ['getSupabaseConfig', 'enableAuth', 'createRLSPolicy', 'generateApiRoute', 'createEdgeFunction'];

    for (const toolUse of toolUsesInIteration) {
      let result;

      // Handle requestDatabaseConnection - this pauses the workflow
      if (toolUse.name === 'requestDatabaseConnection') {
        console.log('[UnifiedAgent] AI requesting database connection:', toolUse.input);
        result = await executeDatabaseConnectionRequest(toolUse.input, databaseTools, projectId);
      }
      // Handle database tools separately (they need databaseTools context)
      else if (DATABASE_TOOL_NAMES.includes(toolUse.name)) {
        result = await executeDatabaseTool(toolUse.name, toolUse.input, databaseTools);
      } else if (SERVER_AUTH_TOOL_NAMES.includes(toolUse.name)) {
        // Handle server/auth tools (they share databaseTools context for Supabase access)
        result = await executeDatabaseTool(toolUse.name, toolUse.input, databaseTools);
      } else {
        result = await executeToolCall(
          toolUse.name,
          toolUse.input,
          fileState,
          executor,
          projectId,
          realtimeValidator // Pass validator for real-time validation
        );
      }

      // Track modified files
      if (['writeFile', 'editFile'].includes(toolUse.name) && result.success) {
        filesModified.push(result.path);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });

      // Call the onToolResult callback and check for pause signal
      const callbackResult = await onToolResult?.({
        toolCallId: toolUse.id,
        toolName: toolUse.name,
        result
      });

      totalToolCalls++;

      // Check if we should pause for user input (e.g., database connection request)
      if (result.action === 'PAUSE_FOR_USER_INPUT' || callbackResult?.paused) {
        console.log(`[UnifiedAgent] Pausing for user input: ${result.inputType || 'unknown'}`);
        return {
          paused: true,
          pauseReason: result.inputType,
          resumeToken: callbackResult?.resumeToken || result.resumeToken,
          filesModified: [...new Set(filesModified)],
          files: Object.fromEntries([...fileState.entries()]),
          totalToolCalls,
          iterations: iteration,
          conversationHistory: messages
        };
      }
    }

    // Add to conversation
    messages.push({
      role: 'assistant',
      content: finalMessage.content
    });
    messages.push({
      role: 'user',
      content: toolResults
    });

    // Continue if tools were used
    if (finalMessage.stop_reason === 'end_turn' && toolUsesInIteration.length > 0) {
      console.log(`[UnifiedAgent] Coder used tools, continuing...`);
      continue;
    }

    if (finalMessage.stop_reason === 'end_turn') {
      break;
    }
  }

  console.log(`[UnifiedAgent] Coder complete: ${iteration} iterations, ${totalToolCalls} tools, ${filesModified.length} files`);

  return {
    filesModified: [...new Set(filesModified)],
    totalToolCalls,
    iterations: iteration,
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens
    }
  };
}

// =============================================================================
// MAIN UNIFIED ORCHESTRATION
// =============================================================================

/**
 * Run the unified conversational pipeline
 *
 * Enhanced Production-Ready Pipeline:
 * 0. PRE-GENERATION: Analyze request, predict components, resolve dependencies
 * 1. Silent agents analyze (Intent, Plan, Architecture)
 * 2. Inject reasoning + file listings + icons into Coder's system prompt
 * 3. Coder streams with visible tool calls + REAL-TIME VALIDATION
 * 4. Post-generation validation as safety net
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - Result with files and usage
 */
export async function runUnifiedPipeline(options) {
  const {
    userMessage,
    existingFiles = {},
    tier = 'free',
    mode = 'standard',
    projectId,
    userId,
    activeFile,
    conversationHistory = [],
    executor,
    onTextDelta,
    onToolUse,
    onToolResult,
    onProgress,
    // Supabase connection for database tools
    supabaseConnection = null,
    databaseTools = null,
  } = options;

  const normalizedTier = normalizeTierName(tier);
  const agentConfig = getAgentConfig(normalizedTier, mode);

  console.log(`[UnifiedAgent] Starting ENHANCED pipeline for tier=${normalizedTier}, mode=${mode}`);
  console.log(`[UnifiedAgent] Models: intent=${agentConfig.models.intent}, planner=${agentConfig.models.planner}, coder=${agentConfig.models.coder}`);

  // =========================================================================
  // STAGE 0: PRE-GENERATION ANALYSIS (NEW - $0 cost, pure static analysis)
  // =========================================================================
  onProgress?.({ stage: 'analyzing', status: 'starting' });

  // Analyze request to predict components, icons, and dependencies
  const requestAnalysis = analyzeRequest(userMessage, existingFiles);
  console.log(`[UnifiedAgent] Request Analysis:`, getAnalysisSummary(requestAnalysis));

  // Pre-inject valid icons based on request
  const iconInjector = new IconInjector();
  const iconAnalysis = iconInjector.analyze(userMessage);
  console.log(`[UnifiedAgent] Icon Analysis: ${iconAnalysis.categories.length} categories, ${iconAnalysis.allIcons.length} icons`);

  // Initialize real-time validator (will add scaffold protection after injection)
  const realtimeValidator = new RealtimeValidator({ debug: true });

  // If we have planned tasks from the planner, resolve dependencies
  let dependencyResolution = null;

  // Track token usage across all stages
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const fileState = { ...existingFiles };

  // =========================================================================
  // STAGE 0.5: SCAFFOLD CONTEXT (Files now pre-injected in project skeleton)
  // =========================================================================
  // Note: Scaffold files are now merged at project initialization in
  // ezcoder-pro-skeleton.js via getSkeletonWithScaffolds(). This stage only
  // builds the system prompt context to tell AI about existing scaffold files.
  // =========================================================================
  let scaffoldContext = null;
  const scaffoldFilePaths = [];

  if (requestAnalysis.scaffoldsToInject?.length > 0) {
    onProgress?.({ stage: 'scaffolds', status: 'detecting' });

    try {
      const scaffoldIds = requestAnalysis.scaffoldsToInject.map(s => s.id);
      const composition = composeScaffolds(scaffoldIds);

      console.log(`[UnifiedAgent] Scaffold Context: ${scaffoldIds.length} scaffolds (${composition.interconnections.length} interconnections)`);

      // Collect scaffold file paths (already in project from skeleton)
      // These files were pre-injected at project creation, not here
      for (const scaffold of requestAnalysis.scaffoldsToInject) {
        if (scaffold.files && Array.isArray(scaffold.files)) {
          for (const file of scaffold.files) {
            scaffoldFilePaths.push(file.path);
          }
        }
      }

      // Collect composed/interconnection file paths
      for (const file of composition.files) {
        scaffoldFilePaths.push(file.path);
      }

      // Build scaffold context for system prompt
      // Note: scaffold.envVars is an array of strings, not an object
      const allEnvVars = [];
      for (const scaffold of requestAnalysis.scaffoldsToInject) {
        if (scaffold.envVars && Array.isArray(scaffold.envVars)) {
          for (const envVar of scaffold.envVars) {
            if (!allEnvVars.includes(envVar)) {
              allEnvVars.push(envVar);
            }
          }
        }
      }
      // composition.envVars is also an array of strings
      if (composition.envVars && Array.isArray(composition.envVars)) {
        for (const envVar of composition.envVars) {
          if (!allEnvVars.includes(envVar)) {
            allEnvVars.push(envVar);
          }
        }
      }

      scaffoldContext = {
        scaffoldsToInject: requestAnalysis.scaffoldsToInject,
        interconnections: composition.interconnections,
        compositionPrompt: composition.systemPromptAddition,
        envVars: allEnvVars,
        scaffoldFiles: scaffoldFilePaths,
        narration: composition.narration,
      };

      // Log for telemetry
      console.log(`[UnifiedAgent] Scaffold context built for: ${scaffoldIds.join(', ')}`);
      if (composition.interconnections.length > 0) {
        console.log(`[UnifiedAgent] Interconnections: ${composition.interconnections.join(', ')}`);
      }

      // Protect scaffold files from being overwritten by AI during generation
      // This works even if files were pre-injected - we still protect them
      if (scaffoldFilePaths.length > 0) {
        realtimeValidator.protectScaffoldFiles(scaffoldFilePaths);
      }

      onProgress?.({
        stage: 'scaffolds',
        status: 'complete',
        scaffolds: scaffoldIds,
        interconnections: composition.interconnections,
        scaffoldFiles: scaffoldFilePaths.length,
      });
    } catch (scaffoldError) {
      console.warn(`[UnifiedAgent] Scaffold context failed (non-blocking):`, scaffoldError.message);
      // Continue without scaffolds - not a fatal error
    }
  }

  // =========================================================================
  // STAGE 1: SILENT INTENT CLASSIFICATION
  // =========================================================================
  onProgress?.({ stage: 'understanding', status: 'starting' });

  let intent;
  try {
    const intentResult = await classifyIntent({
      userMessage,
      conversationHistory,
      existingFiles,
      tier: normalizedTier,
      mode,
    });
    // Extract nested classification from result
    intent = intentResult.classification || intentResult;
    console.log(`[UnifiedAgent] Intent: ${intent.intentType}, confidence=${intent.confidence}`);
  } catch (e) {
    console.warn(`[UnifiedAgent] Intent classification failed:`, e.message);
    intent = {
      intentType: INTENT_TYPES.NEW_FEATURE,
      confidence: 0.5,
      reasoning: 'build what was requested',
      requiresCodeGeneration: true,
    };
  }

  // Check if we should skip full pipeline
  const pipelineConfig = getPipelineConfig(intent.intentType);

  // =========================================================================
  // STAGE 2: SILENT PLANNING
  // =========================================================================
  let plan = null;

  if (!pipelineConfig.skipPipeline && !pipelineConfig.directResponse) {
    onProgress?.({ stage: 'planning', status: 'starting' });

    try {
      const planResult = await createPlan({
        userMessage,
        intentClassification: intent,
        existingFiles,
        tier: normalizedTier,
        mode,
      });
      // Extract nested plan from result
      plan = planResult.plan || planResult;
      console.log(`[UnifiedAgent] Plan: ${plan.tasks?.length || 0} tasks`);

      // =====================================================================
      // NEW: Resolve dependencies for planned tasks (topological sort)
      // =====================================================================
      if (plan?.tasks?.length > 0) {
        const depResolver = new DependencyResolver({ debug: true });
        dependencyResolution = depResolver.resolve(plan.tasks, existingFiles);
        console.log(`[UnifiedAgent] Dependency Resolution: ${dependencyResolution.orderedFiles.length} files ordered, ${dependencyResolution.foundations.length} foundations needed`);

        // Auto-inject foundation files if missing
        if (dependencyResolution.foundations.length > 0) {
          for (const foundation of dependencyResolution.foundations) {
            if (!fileState[foundation.path]) {
              fileState[foundation.path] = foundation.content;
              console.log(`[UnifiedAgent] Pre-injected foundation: ${foundation.path}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[UnifiedAgent] Planning failed:`, e.message);
      plan = {
        summary: 'Build the requested feature',
        tasks: [],
      };
    }
  }

  // =========================================================================
  // STAGE 3: SILENT ARCHITECTURE (Optional)
  // =========================================================================
  let architecture = null;

  if (!pipelineConfig.skipPipeline && !pipelineConfig.skipArchitect && plan?.tasks?.length > 2) {
    onProgress?.({ stage: 'designing', status: 'starting' });

    try {
      const archResult = await createArchitecture({
        plan,
        userMessage,
        intentClassification: intent,
        existingFiles,
        tier: normalizedTier,
        mode,
      });
      // Extract nested architecture from result
      architecture = archResult.architecture || archResult;
      console.log(`[UnifiedAgent] Architecture: ${architecture.fileStructure?.length || 0} files`);
    } catch (e) {
      console.warn(`[UnifiedAgent] Architecture failed:`, e.message);
    }
  }

  // =========================================================================
  // STAGE 4: VISIBLE CODER (Streaming with Tools + Real-Time Validation)
  // =========================================================================
  onProgress?.({ stage: 'generating', status: 'starting' });

  // Build ENHANCED system prompt with:
  // - Context from silent agents
  // - Complete file listings
  // - Pre-generation analysis
  // - Icon pre-injection
  // - Dependency order guidance
  // - Design guidance (context-aware styling)
  const systemPrompt = buildCoderSystemPrompt(intent, plan, architecture, fileState, {
    activeFile,
    requestAnalysis,
    iconAnalysis,
    dependencyResolution,
    scaffoldContext,
    userMessage, // Added for design guidance
  });

  // Convert conversation history to Anthropic format
  const messages = conversationHistory.map(m => ({
    role: m.role,
    content: m.content
  }));

  // Add current user message
  messages.push({
    role: 'user',
    content: userMessage
  });

  // Run the visible coder with REAL-TIME VALIDATION
  const coderResult = await runCoderWithStreaming({
    messages,
    systemPrompt,
    model: agentConfig.models.coder,
    fileState,
    executor,
    projectId,
    userId,
    onTextDelta,
    onToolUse,
    onToolResult,
    realtimeValidator, // NEW: Pass validator for real-time validation during generation
    // Database tools support
    supabaseConnection,
    databaseTools,
  });

  // Accumulate usage
  totalUsage.inputTokens += coderResult.tokenUsage.inputTokens;
  totalUsage.outputTokens += coderResult.tokenUsage.outputTokens;
  totalUsage.totalTokens += coderResult.tokenUsage.totalTokens;

  // =========================================================================
  // STAGE 5: IMPORT VALIDATION & AUTO-FIX (Layer 1 Error Detection)
  // =========================================================================
  // Validate generated code BEFORE syncing to preview to catch missing imports
  // This prevents blank screens from unresolved imports like @/components/ui/card
  onProgress?.({ stage: 'validating', status: 'starting' });

  let validationResult = null;
  try {
    const errorOrchestrator = new ErrorOrchestrator({
      autoFixEnabled: true,
      // No AI fixer - only use quick fixes (shadcn components, icon replacements)
      // This keeps costs at $0 for validation
    });

    validationResult = await errorOrchestrator.validateAndFix(fileState);

    if (!validationResult.valid && validationResult.errors?.length > 0) {
      console.log(`[UnifiedAgent] Found ${validationResult.errors.length} import issues`);

      // If fixes were applied, update the file state
      if (validationResult.fixes?.fixedFiles?.length > 0) {
        console.log(`[UnifiedAgent] Applied ${validationResult.fixes.fixedFiles.length} quick-fixes`);

        for (const fixed of validationResult.fixes.fixedFiles) {
          fileState[fixed.path] = fixed.content;
          // Track as modified
          if (!coderResult.filesModified.includes(fixed.path)) {
            coderResult.filesModified.push(fixed.path);
          }
        }

        // Notify about auto-fixes via progress
        onProgress?.({
          stage: 'auto-fix',
          status: 'applied',
          fixes: validationResult.fixes.fixedFiles.map(f => ({
            path: f.path,
            change: f.change,
          })),
        });
      }
    } else {
      console.log(`[UnifiedAgent] Validation passed - no import issues`);
    }
  } catch (validationError) {
    console.warn(`[UnifiedAgent] Validation failed (non-blocking):`, validationError.message);
    // Don't fail the pipeline if validation errors - proceed with original files
  }

  // =========================================================================
  // STAGE 5.5: ICON VALIDATION & AUTO-FIX (Zero-cost static analysis)
  // =========================================================================
  // Validate lucide-react icon imports and fix hallucinated icon names
  // This catches icons like "CowIcon", "Casino", "Gambling" that don't exist
  try {
    let iconFixCount = 0;
    const iconFixDetails = [];

    for (const [path, content] of Object.entries(fileState)) {
      // Only check files that might have lucide-react imports
      if ((path.endsWith('.tsx') || path.endsWith('.jsx') || path.endsWith('.js')) &&
          content.includes('lucide-react')) {

        const iconFix = fixIconImports(content);

        if (iconFix.fixed && iconFix.changes.length > 0) {
          // Update file state with fixed content
          fileState[path] = iconFix.content;
          iconFixCount += iconFix.changes.length;

          // Log each fix for debugging
          console.log(`[UnifiedAgent] Fixed ${iconFix.changes.length} invalid icon(s) in ${path}:`);
          iconFix.changes.forEach(change => {
            console.log(`  └─ ${change.from} → ${change.to} (${change.reason})`);
            iconFixDetails.push({ path, ...change });
          });

          // Track as modified file
          if (!coderResult.filesModified.includes(path)) {
            coderResult.filesModified.push(path);
          }

          // Add to validation result for reporting
          if (!validationResult) {
            validationResult = { valid: true, errors: [], fixes: { fixedFiles: [] } };
          }
          if (!validationResult.fixes) {
            validationResult.fixes = { fixedFiles: [] };
          }
          validationResult.fixes.fixedFiles.push({
            path,
            change: `Fixed icons: ${iconFix.changes.map(c => `${c.from}→${c.to}`).join(', ')}`,
            content: iconFix.content,
            type: 'icon-fix',
          });
        }
      }
    }

    if (iconFixCount > 0) {
      console.log(`[UnifiedAgent] Icon validation complete: fixed ${iconFixCount} invalid icon(s)`);

      // Notify about icon fixes via progress
      onProgress?.({
        stage: 'icon-fix',
        status: 'applied',
        fixes: iconFixDetails,
        count: iconFixCount,
      });
    }
  } catch (iconValidationError) {
    console.warn(`[UnifiedAgent] Icon validation failed (non-blocking):`, iconValidationError.message);
    // Don't fail the pipeline - icon issues will show in preview but won't crash build
  }

  // =========================================================================
  // STAGE 5.6: PLACEHOLDER IMAGE REPLACEMENT (Zero-cost static analysis)
  // =========================================================================
  // Replace placeholder image URLs with real Unsplash images
  // This catches URLs like placeholder.com, via.placeholder.com, /placeholder.svg
  try {
    let placeholderFixCount = 0;
    const placeholderFixDetails = [];

    // Patterns for placeholder URLs that should be replaced
    // Each pattern captures the full quoted string including both quotes
    const PLACEHOLDER_PATTERNS = [
      /"https?:\/\/(www\.)?(via\.)?placeholder\.(com|co)[^"]*"/gi,
      /'https?:\/\/(www\.)?(via\.)?placeholder\.(com|co)[^']*'/gi,
      /`https?:\/\/(www\.)?(via\.)?placeholder\.(com|co)[^`]*`/gi,
      /"https?:\/\/placehold\.(co|it)[^"]*"/gi,
      /'https?:\/\/placehold\.(co|it)[^']*'/gi,
      /"https?:\/\/picsum\.photos[^"]*"/gi,
      /'https?:\/\/picsum\.photos[^']*'/gi,
      /"\/placeholder[^"]*\.(svg|png|jpg|jpeg|webp)"/gi,
      /'\/placeholder[^']*\.(svg|png|jpg|jpeg|webp)'/gi,
      /"\/images\/placeholder[^"]*"/gi,
      /'\/images\/placeholder[^']*'/gi,
    ];

    // Real image URL templates by context (from Unsplash)
    const REAL_IMAGE_URLS = {
      hero: [
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80', // modern office
        'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=1200&q=80', // workspace
        'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=1200&q=80', // business
      ],
      product: [
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80', // product
        'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80', // headphones
        'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&q=80', // camera
      ],
      avatar: [
        'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&q=80', // man
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&q=80', // woman
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&q=80', // person
      ],
      general: [
        'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=800&q=80', // laptop
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&q=80', // coding
        'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80', // dashboard
      ],
    };

    for (const [path, content] of Object.entries(fileState)) {
      // Only check files that might have image URLs
      if (path.endsWith('.tsx') || path.endsWith('.jsx') || path.endsWith('.js') ||
          path.endsWith('.html') || path.endsWith('.css')) {

        let updatedContent = content;
        let fileHasPlaceholders = false;

        for (const pattern of PLACEHOLDER_PATTERNS) {
          const matches = content.match(pattern);
          if (matches) {
            fileHasPlaceholders = true;

            for (const match of matches) {
              // Determine context from surrounding code
              const context = content.includes('avatar') || content.includes('user') || content.includes('profile')
                ? 'avatar'
                : content.includes('hero') || content.includes('banner') || match.includes('1200')
                  ? 'hero'
                  : content.includes('product') || content.includes('item') || content.includes('card')
                    ? 'product'
                    : 'general';

              // Get a real image URL
              const urls = REAL_IMAGE_URLS[context];
              const realUrl = urls[Math.floor(Math.random() * urls.length)];

              // The match includes quotes on both sides (e.g., "url" or 'url')
              // Extract the quote character from the first position
              const quoteChar = match[0]; // Will be ", ', or `

              // Validate it's actually a quote character
              if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== '`') {
                console.warn(`[UnifiedAgent] Unexpected match format, skipping: ${match.substring(0, 50)}...`);
                continue;
              }

              // Build replacement with same quote style
              const replacement = quoteChar + realUrl + quoteChar;

              updatedContent = updatedContent.replace(match, replacement);

              placeholderFixDetails.push({
                path,
                from: match.slice(1, -1), // Remove quotes for logging
                to: realUrl,
                context,
              });
            }
          }
        }

        if (fileHasPlaceholders && updatedContent !== content) {
          fileState[path] = updatedContent;
          placeholderFixCount++;

          console.log(`[UnifiedAgent] Replaced placeholder images in ${path}`);

          // Track as modified file
          if (!coderResult.filesModified.includes(path)) {
            coderResult.filesModified.push(path);
          }
        }
      }
    }

    if (placeholderFixCount > 0) {
      console.log(`[UnifiedAgent] Placeholder replacement complete: fixed ${placeholderFixDetails.length} placeholder URL(s) in ${placeholderFixCount} file(s)`);
      placeholderFixDetails.forEach(fix => {
        console.log(`  └─ ${fix.path}: ${fix.from.substring(0, 40)}... → ${fix.context} image`);
      });

      // Notify about placeholder fixes via progress
      onProgress?.({
        stage: 'placeholder-fix',
        status: 'applied',
        fixes: placeholderFixDetails,
        count: placeholderFixDetails.length,
      });
    }
  } catch (placeholderError) {
    console.warn(`[UnifiedAgent] Placeholder replacement failed (non-blocking):`, placeholderError.message);
    // Don't fail the pipeline - placeholder images will still work, just won't look as nice
  }

  onProgress?.({ stage: 'complete', status: 'success', filesModified: coderResult.filesModified.length });

  return {
    success: true,
    files: fileState,
    filesModified: coderResult.filesModified,
    intent,
    plan,
    architecture,
    usage: totalUsage,
    iterations: coderResult.iterations,
    totalToolCalls: coderResult.totalToolCalls,
    // Post-generation validation (safety net)
    validation: validationResult ? {
      valid: validationResult.valid,
      errorsFound: validationResult.errors?.length || 0,
      fixesApplied: validationResult.fixes?.fixedFiles?.length || 0,
      iconFixesApplied: validationResult.fixes?.fixedFiles?.filter(f => f.type === 'icon-fix').length || 0,
    } : null,
    // NEW: Pre-generation analysis data
    preGeneration: {
      requestAnalysis: getAnalysisSummary(requestAnalysis),
      iconCategories: iconAnalysis.categories,
      dependencyOrder: dependencyResolution?.orderedFiles?.map(f => f.path) || [],
      foundationsInjected: dependencyResolution?.foundations?.map(f => f.path) || [],
    },
    // Scaffold context data (files pre-injected in skeleton, context used for AI prompt)
    scaffolds: scaffoldContext ? {
      detected: scaffoldContext.scaffoldsToInject?.map(s => s.id) || [],
      interconnections: scaffoldContext.interconnections || [],
      scaffoldFiles: scaffoldContext.scaffoldFiles || [],
      envVarsRequired: scaffoldContext.envVars || [],
    } : null,
  };
}

export default {
  runUnifiedPipeline,
  buildCoderSystemPrompt,
  CODER_TOOLS,
  DATABASE_TOOLS,
  getToolsForUser,
};
