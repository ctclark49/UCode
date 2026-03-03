// lib/stripe.js
// Industry best practice: Centralized Stripe configuration with proper price management
// SINGLE SOURCE OF TRUTH for all subscription tiers, limits, and AI modes
import Stripe from 'stripe';

/**
 * AI Mode Constants
 * These modes determine which models power each agent in the multi-agent pipeline.
 * Import from lib/ai/agent-config.js for the full configuration.
 */
export const AI_MODES = {
  STANDARD: 'standard',    // Default mode - balanced performance
  DEEP_THINK: 'deep_think', // Pro tier only - Opus planning → Sonnet 4.5 coding
  MAX: 'max',              // Business tier only - All Opus models
};

// Initialize Stripe with your secret key
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

/**
 * ============================================================================
 * UNIFIED SUBSCRIPTION CONFIGURATION - SINGLE SOURCE OF TRUTH
 * ============================================================================
 *
 * Tier Structure:
 * - Free:       $0/mo  - 7,500 tokens/day (< $0.25/day cost), 3 projects max
 * - Pro:        $25/mo - 500K tokens/month, unlimited projects
 * - Business:   $45/mo - 2M tokens/month, unlimited projects + team features
 * - Enterprise: Custom - 10M+ tokens/month, unlimited everything
 *
 * Free Tier Cost Analysis (ensures < $0.25/day):
 * - Using Claude Haiku: $0.80/$4.00 per 1M tokens (base) × 3.5x markup
 * - Our cost per 1K tokens: ~$0.0084 (weighted 40/60 input/output)
 * - 7,500 tokens/day × $0.0084/1K = ~$0.063/day actual cost
 * - This gives us 75% margin even at peak usage
 *
 * Token Packages (one-time purchases):
 * - 100K tokens: $5
 * - 500K tokens: $20 (20% discount)
 * - 1M tokens: $35 (30% discount)
 * - 5M tokens: $150 (40% discount)
 */

// Daily token limit for free tier (ensures < $0.25/day cost)
export const FREE_DAILY_TOKEN_LIMIT = 7500;

// Monthly equivalent for free tier (7,500 × 30 = 225,000)
export const FREE_MONTHLY_TOKEN_LIMIT = 225000;

export const PLAN_CONFIG = {
  // ===== FREE TIER =====
  // Cost-controlled: < $0.25/day maximum
  free: {
    name: 'Free',
    description: 'Get started with AI-powered coding',
    priceMonthly: 0,
    priceYearly: 0,
    priceIdMonthly: null, // Free plan - no Stripe price
    priceIdYearly: null,
    features: [
      '7,500 tokens per day (resets daily)',
      '3 projects maximum',
      'Basic templates',
      'Community support',
      'Claude Haiku 4.5 AI model',
      'Full multi-agent pipeline'
    ],
    limits: {
      projects: 3,
      tokensDaily: FREE_DAILY_TOKEN_LIMIT,
      tokensMonthly: FREE_MONTHLY_TOKEN_LIMIT,
      maxTokensPerRequest: 2000,
      tokenDiscount: 0,
      aiModel: 'claude-haiku-4-5-20251001',
      allowedModels: ['claude-3-haiku', 'claude-haiku-4-5-20251001'],
      rateLimit: 10, // requests per minute
      teamMembers: 1
    },
    // AI Mode Configuration
    aiModes: {
      available: [AI_MODES.STANDARD],
      default: AI_MODES.STANDARD,
      // All agents use Haiku 4.5 for cost efficiency
      models: {
        [AI_MODES.STANDARD]: {
          intent: 'claude-haiku-4-5-20251001',
          planner: 'claude-haiku-4-5-20251001',
          architect: 'claude-haiku-4-5-20251001',
          coder: 'claude-haiku-4-5-20251001'
        }
      }
    }
  },

  // ===== CREATOR TIER ($25/month) =====
  // NOTE: "pro" is aliased to "creator" at the bottom of this file
  // For creators and small teams
  creator: {
    name: 'Creator',
    description: 'For creators and small teams',
    priceMonthly: 25,
    priceYearly: 240, // 20% discount ($25 × 12 = $300, 20% off = $240)
    // Use actual Stripe price IDs from stripe-products.json, with env var override option
    priceIdMonthly: process.env.STRIPE_PRICE_CREATOR_MONTHLY || 'price_1SoYndHJaRQTV4Czp8HABNYM',
    priceIdYearly: process.env.STRIPE_PRICE_CREATOR_YEARLY || 'price_1SoYneHJaRQTV4CzPKgf0F5R',
    features: [
      '500K tokens included monthly',
      'Unlimited projects',
      'Premium templates',
      'Custom domains',
      'Priority support',
      'Version history',
      'Claude Sonnet 4 AI model',
      'Deep Think mode (Opus planning)',
      '5% discount on token add-ons',
      'Team collaboration (up to 3)'
    ],
    limits: {
      projects: -1, // Unlimited
      tokensDaily: null, // No daily limit
      tokensMonthly: 500000,
      maxTokensPerRequest: 16000,
      tokenDiscount: 5,
      aiModel: 'claude-sonnet-4-20250514',
      allowedModels: ['claude-3-haiku', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
      rateLimit: 120, // requests per minute
      teamMembers: 3 // Creator gets 3 team members
    },
    popular: true,
    // AI Mode Configuration
    aiModes: {
      available: [AI_MODES.STANDARD, AI_MODES.DEEP_THINK],
      default: AI_MODES.STANDARD,
      models: {
        // Standard: Haiku planning → Sonnet 4 coding
        [AI_MODES.STANDARD]: {
          intent: 'claude-haiku-4-5-20251001',
          planner: 'claude-haiku-4-5-20251001',
          architect: 'claude-haiku-4-5-20251001',
          coder: 'claude-sonnet-4-20250514'
        },
        // Deep Think: Opus planning → Sonnet 4.5 coding
        [AI_MODES.DEEP_THINK]: {
          intent: 'claude-haiku-4-5-20251001',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-sonnet-4-5-20250929'
        }
      }
    }
  },

  // ===== BUSINESS TIER ($45/month) =====
  // For teams and power users
  business: {
    name: 'Business',
    description: 'For teams and power users',
    priceMonthly: 45,
    priceYearly: 432, // 20% discount ($45 × 12 = $540, 20% off = $432)
    // Use actual Stripe price IDs from stripe-products.json, with env var override option
    priceIdMonthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY || 'price_1SoYneHJaRQTV4Cz7iQi6hna',
    priceIdYearly: process.env.STRIPE_PRICE_BUSINESS_YEARLY || 'price_1SoYneHJaRQTV4CzOtgCNR15',
    features: [
      '2M tokens included monthly',
      'Unlimited projects',
      'Unlimited team collaboration',
      'All AI models access',
      'Claude Opus 4 planning',
      'Intelligent task escalation',
      'Max Mode (All Opus)',
      'API access',
      'Priority phone support',
      'White label options',
      '10% discount on token add-ons'
    ],
    limits: {
      projects: -1, // Unlimited
      tokensDaily: null, // No daily limit
      tokensMonthly: 2000000, // 2M tokens as shown in billing UI
      maxTokensPerRequest: 32000,
      tokenDiscount: 10,
      aiModel: 'claude-opus-4-20250514',
      allowedModels: ['all'], // Access to all models
      rateLimit: 300, // requests per minute
      teamMembers: -1 // Unlimited team members
    },
    // AI Mode Configuration
    aiModes: {
      available: [AI_MODES.STANDARD, AI_MODES.MAX],
      default: AI_MODES.STANDARD,
      models: {
        // Standard: Opus planning → Sonnet 4.5 coding (with escalation)
        [AI_MODES.STANDARD]: {
          intent: 'claude-haiku-4-5-20251001',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-sonnet-4-5-20250929',
          // Intelligent Escalation: Planner can flag tasks for Opus Coder
          allowEscalation: true,
          escalatedCoder: 'claude-opus-4-20250514'
        },
        // Max Mode: All Opus for complex projects
        [AI_MODES.MAX]: {
          intent: 'claude-opus-4-20250514',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-opus-4-20250514'
        }
      }
    }
  },

  // ===== ENTERPRISE TIER (Custom) =====
  // Custom solutions for large organizations
  enterprise: {
    name: 'Enterprise',
    description: 'Custom solutions for large organizations',
    priceMonthly: null, // Custom pricing
    priceYearly: null,
    priceIdMonthly: null, // Created per-customer
    priceIdYearly: null,
    isCustomPricing: true,
    contactSales: true,
    features: [
      'Custom token allocation (10M+ monthly)',
      'All AI models (Haiku, Sonnet, Opus)',
      'Token rollover (unused tokens carry over)',
      'All Opus multi-agent pipeline',
      'All modes available',
      'Priority processing',
      'Dedicated account manager',
      'SLA guarantees (99.9% uptime)',
      'Priority 24/7 support',
      'SSO/SAML authentication',
      'Custom integrations & webhooks',
      'Advanced analytics & audit logs',
      'IP allowlist & security controls',
      'Volume discounts (up to 40% off)',
      'White label & custom branding',
      'Dedicated resources option'
    ],
    limits: {
      projects: -1, // Unlimited
      tokensDaily: null, // No daily limit
      tokensMonthly: 10000000, // Default 10M, can be customized
      maxTokensPerRequest: null, // No limit
      tokenDiscount: 20, // Default 20%, can be higher
      aiModel: 'all', // Access to all models
      allowedModels: ['all'],
      rateLimit: null, // No limit
      teamMembers: -1 // Unlimited
    },
    // AI Mode Configuration - All Opus, all modes available
    aiModes: {
      available: [AI_MODES.STANDARD, AI_MODES.DEEP_THINK, AI_MODES.MAX],
      default: AI_MODES.STANDARD,
      models: {
        // All modes use Opus for everything at Enterprise
        [AI_MODES.STANDARD]: {
          intent: 'claude-opus-4-20250514',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-opus-4-20250514'
        },
        [AI_MODES.DEEP_THINK]: {
          intent: 'claude-opus-4-20250514',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-opus-4-20250514'
        },
        [AI_MODES.MAX]: {
          intent: 'claude-opus-4-20250514',
          planner: 'claude-opus-4-20250514',
          architect: 'claude-opus-4-20250514',
          coder: 'claude-opus-4-20250514'
        }
      }
    }
  }
};

// Legacy aliases for backwards compatibility
PLAN_CONFIG.starter = PLAN_CONFIG.free;  // starter → free (same tier)
PLAN_CONFIG.pro = PLAN_CONFIG.creator;   // pro → creator (same tier, same price IDs)

/**
 * Token Package Configuration
 * One-time purchases for additional tokens
 */
export const TOKEN_PACKAGES = {
  small: {
    name: '100K Tokens',
    tokens: 100000,
    price: 5.00,
    priceId: process.env.STRIPE_PRICE_TOKENS_100K,
    discount: 0,
    description: 'Good for small projects'
  },
  medium: {
    name: '500K Tokens',
    tokens: 500000,
    price: 20.00,
    priceId: process.env.STRIPE_PRICE_TOKENS_500K,
    discount: 20, // 20% off vs buying 5x small
    description: 'Best for regular use'
  },
  large: {
    name: '1M Tokens',
    tokens: 1000000,
    price: 35.00,
    priceId: process.env.STRIPE_PRICE_TOKENS_1M,
    discount: 30, // 30% off
    description: 'Great value for heavy users',
    popular: true
  },
  xlarge: {
    name: '5M Tokens',
    tokens: 5000000,
    price: 150.00,
    priceId: process.env.STRIPE_PRICE_TOKENS_5M,
    discount: 40, // 40% off
    description: 'Maximum savings for teams'
  }
};

// Helper function to get plan by key
export function getPlanByKey(planKey) {
  return PLAN_CONFIG[planKey?.toLowerCase()] || null;
}

// Helper function to get plan from price ID
// Checks both monthly and yearly price IDs
export function getPlanFromPriceId(priceId) {
  if (!priceId) return null;

  for (const [key, plan] of Object.entries(PLAN_CONFIG)) {
    // Check monthly price
    if (plan.priceIdMonthly === priceId) {
      return { key, billingCycle: 'monthly', ...plan };
    }
    // Check yearly price
    if (plan.priceIdYearly === priceId) {
      return { key, billingCycle: 'yearly', ...plan };
    }
  }

  console.error(`[getPlanFromPriceId] No plan found for price ID: ${priceId}`);
  console.error('Available price IDs:', Object.entries(PLAN_CONFIG).map(([k, v]) => ({
    plan: k,
    monthly: v.priceIdMonthly,
    yearly: v.priceIdYearly
  })));

  return null;
}

// Helper function to validate webhook signature
export function validateWebhookSignature(payload, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.warn('No webhook secret configured');
    return true; // In development, allow webhooks without signature
  }
  
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    return event;
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return null;
  }
}