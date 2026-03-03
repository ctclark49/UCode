// lib/tokens-v2.js - Simplified token management using database functions
// IMPORTANT: Uses PLAN_CONFIG from lib/stripe.js as the SINGLE SOURCE OF TRUTH
import { getSupabaseAdmin } from './supabase';
import { MODEL_PRICING, calculateTokenCost as calculateCost } from './token-pricing.js';
import { TOKEN_PACKAGES as STRIPE_TOKEN_PACKAGES, PLAN_CONFIG, FREE_DAILY_TOKEN_LIMIT } from './stripe.js';

/**
 * Get the start of the current UTC day (for daily token tracking)
 */
function getUTCDayStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Get tier limits from PLAN_CONFIG (single source of truth)
 * PLAN_CONFIG already has aliases: starter → free, pro → creator
 * So we just need to look up directly.
 */
function getTierLimits(tier) {
  const tierKey = (tier || 'starter').toLowerCase();
  // PLAN_CONFIG has aliases set up, so this handles starter/free/pro/creator automatically
  const planConfig = PLAN_CONFIG[tierKey] || PLAN_CONFIG.starter;
  return planConfig.limits || {};
}

/**
 * Check if tier has daily limits (free tier only)
 */
function hasDailyLimit(tier) {
  const limits = getTierLimits(tier);
  return limits.tokensDaily !== null && limits.tokensDaily !== undefined;
}

export class TokenManagerV2 {
  constructor() {
    // Lazy initialization - don't call getSupabaseAdmin() until first use
    this._supabase = null;
  }

  // Lazy getter for supabase client
  get supabase() {
    if (!this._supabase) {
      this._supabase = getSupabaseAdmin();
    }
    return this._supabase;
  }

  /**
   * Get daily token usage for free tier users
   * Queries token_usage_detailed for today's UTC usage
   */
  async getDailyTokenUsage(userId) {
    try {
      const todayStart = getUTCDayStart();

      const { data, error } = await this.supabase
        .from('token_usage_detailed')
        .select('input_tokens, output_tokens')
        .eq('user_id', userId)
        .gte('created_at', todayStart.toISOString());

      if (error) {
        console.error('[TokenManagerV2] Error getting daily usage:', error);
        return 0;
      }

      // Sum all tokens used today
      const totalToday = (data || []).reduce((sum, row) => {
        return sum + (row.input_tokens || 0) + (row.output_tokens || 0);
      }, 0);

      return totalToday;
    } catch (error) {
      console.error('[TokenManagerV2] Error calculating daily usage:', error);
      return 0;
    }
  }

  // Get user's current token balance
  async getUserTokens(userId) {
    try {
      console.log(`[TokenManagerV2] Getting tokens for user ${userId}`);

      // Use the database function
      const { data, error } = await this.supabase
        .rpc('get_token_balance', { p_user_id: userId });

      if (error) {
        console.error('[TokenManagerV2] Error getting balance:', error);
        // Fallback to direct query
        return await this.getUserTokensFallback(userId);
      }

      // CRITICAL FIX: Handle null/undefined data response
      // This can happen when the RPC function doesn't exist or returns nothing
      if (!data) {
        console.error('[TokenManagerV2] RPC returned null/undefined data');
        return await this.getUserTokensFallback(userId);
      }

      if (!data.success) {
        console.error('[TokenManagerV2] Balance check failed:', data.error);
        return await this.getUserTokensFallback(userId);
      }

      // Get the user's tier and check if they have daily limits
      const subscription = data.subscription_tier || 'free';
      const tierLimits = getTierLimits(subscription);
      const hasDailyLimits = hasDailyLimit(subscription);

      // Get daily usage if this tier has daily limits (free tier)
      let dailyTokensUsed = 0;
      let dailyTokensLimit = null;
      let dailyTokensRemaining = null;

      if (hasDailyLimits) {
        dailyTokensUsed = await this.getDailyTokenUsage(userId);
        dailyTokensLimit = tierLimits.tokensDaily;
        dailyTokensRemaining = Math.max(0, dailyTokensLimit - dailyTokensUsed);
        console.log(`[TokenManagerV2] Free tier daily usage: ${dailyTokensUsed}/${dailyTokensLimit}`);
      }

      // Handle both monthly and annual billing
      const billingCycle = data.billing_cycle || 'monthly';
      const isAnnual = billingCycle === 'annual';

      if (isAnnual) {
        // Annual users have accumulating tokens
        return {
          additionalTokens: data.purchased_tokens || 0,
          accumulatedTokens: data.accumulated_tokens || 0,
          totalAvailable: data.total_available || 0,
          subscription,
          billingCycle: 'annual',
          monthlyAllocation: data.monthly_allocation || tierLimits.tokensMonthly || 100000,
          nextMonthlyGrant: data.next_monthly_grant,
          subscriptionEndsAt: data.subscription_ends_at,
          monthsUntilReset: data.months_until_reset || 0,
          // Daily limit fields (for free tier)
          dailyTokensUsed,
          dailyTokensLimit,
          dailyTokensRemaining,
          hasDailyLimit: hasDailyLimits,
          // Legacy fields for compatibility
          monthlyTokens: 0,
          annualTokens: data.accumulated_tokens || 0,
          monthlyTokensLimit: data.monthly_allocation || tierLimits.tokensMonthly || 100000,
          monthlyTokensUsed: 0,
          nextReset: data.subscription_ends_at
        };
      } else {
        // Monthly users have resetting tokens
        return {
          additionalTokens: data.purchased_tokens || 0,
          monthlyTokens: data.monthly_available || 0,
          totalAvailable: data.total_available || 0,
          subscription,
          billingCycle: 'monthly',
          monthlyTokensLimit: data.monthly_limit || tierLimits.tokensMonthly || 100000,
          monthlyTokensUsed: data.monthly_used || 0,
          nextReset: data.next_reset,
          // Daily limit fields (for free tier)
          dailyTokensUsed,
          dailyTokensLimit,
          dailyTokensRemaining,
          hasDailyLimit: hasDailyLimits,
          // Annual fields not applicable
          accumulatedTokens: 0,
          annualTokens: 0,
          nextMonthlyGrant: null,
          subscriptionEndsAt: null
        };
      }
    } catch (error) {
      console.error('[TokenManagerV2] Error:', error);
      return await this.getUserTokensFallback(userId);
    }
  }

  // Fallback method if RPC fails
  async getUserTokensFallback(userId) {
    try {
      const { data: user, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      // CRITICAL FIX: Handle missing 'users' table gracefully
      // This can happen when database migrations haven't been run
      if (error) {
        // Check if this is a "relation does not exist" error (42P01)
        if (error.code === '42P01') {
          console.error('[TokenManagerV2] CRITICAL: "users" table does not exist! Please run database migrations.');
        } else {
          console.error('[TokenManagerV2] Fallback query failed:', error.message || error);
        }
        // Return free tier defaults when database is unavailable
        return {
          additionalTokens: 0,
          monthlyTokens: FREE_DAILY_TOKEN_LIMIT * 30,
          totalAvailable: FREE_DAILY_TOKEN_LIMIT * 30,
          subscription: 'free',
          monthlyTokensLimit: FREE_DAILY_TOKEN_LIMIT * 30,
          monthlyTokensUsed: 0,
          // Free tier daily limits
          dailyTokensUsed: 0,
          dailyTokensLimit: FREE_DAILY_TOKEN_LIMIT,
          dailyTokensRemaining: FREE_DAILY_TOKEN_LIMIT,
          hasDailyLimit: true,
          // Flag to indicate this is a fallback response
          _fallback: true,
          _error: error.code === '42P01' ? 'users_table_missing' : 'database_error'
        };
      }

      if (!user) {
        console.warn('[TokenManagerV2] User not found in database:', userId);
        return {
          additionalTokens: 0,
          monthlyTokens: FREE_DAILY_TOKEN_LIMIT * 30,
          totalAvailable: FREE_DAILY_TOKEN_LIMIT * 30,
          subscription: 'free',
          monthlyTokensLimit: FREE_DAILY_TOKEN_LIMIT * 30,
          monthlyTokensUsed: 0,
          // Free tier daily limits
          dailyTokensUsed: 0,
          dailyTokensLimit: FREE_DAILY_TOKEN_LIMIT,
          dailyTokensRemaining: FREE_DAILY_TOKEN_LIMIT,
          hasDailyLimit: true
        };
      }

      // Get the user's tier and check if they have daily limits
      const subscription = user.subscription_tier || 'free';
      const tierLimits = getTierLimits(subscription);
      const hasDailyLimits = hasDailyLimit(subscription);

      // Get daily usage if this tier has daily limits (free tier)
      let dailyTokensUsed = 0;
      let dailyTokensLimit = null;
      let dailyTokensRemaining = null;

      if (hasDailyLimits) {
        dailyTokensUsed = await this.getDailyTokenUsage(userId);
        dailyTokensLimit = tierLimits.tokensDaily;
        dailyTokensRemaining = Math.max(0, dailyTokensLimit - dailyTokensUsed);
      }

      const billingCycle = user.billing_cycle || 'monthly';
      const isAnnual = billingCycle === 'annual';

      if (isAnnual) {
        // Annual users with accumulating tokens
        const accumulated = user.accumulated_tokens || 0;
        const purchased = user.additional_tokens_purchased || 0;

        return {
          additionalTokens: purchased,
          accumulatedTokens: accumulated,
          totalAvailable: accumulated + purchased,
          subscription,
          billingCycle: 'annual',
          monthlyAllocation: user.monthly_tokens_limit || tierLimits.tokensMonthly || 100000,
          nextMonthlyGrant: user.last_token_grant_at || user.last_token_grant_date
            ? new Date(new Date(user.last_token_grant_at || user.last_token_grant_date).setMonth(new Date(user.last_token_grant_at || user.last_token_grant_date).getMonth() + 1))
            : null,
          subscriptionEndsAt: user.subscription_ends_at,
          // Daily limit fields
          dailyTokensUsed,
          dailyTokensLimit,
          dailyTokensRemaining,
          hasDailyLimit: hasDailyLimits,
          // Legacy fields
          monthlyTokens: 0,
          annualTokens: accumulated,
          monthlyTokensLimit: user.monthly_tokens_limit || tierLimits.tokensMonthly || 100000,
          monthlyTokensUsed: 0,
          nextReset: user.subscription_ends_at
        };
      } else {
        // Monthly users with resetting tokens
        const monthlyAvailable = Math.max(0,
          (user.monthly_tokens_limit || tierLimits.tokensMonthly || 100000) - (user.monthly_tokens_used || 0)
        );

        return {
          additionalTokens: user.additional_tokens_purchased || 0,
          monthlyTokens: monthlyAvailable,
          totalAvailable: monthlyAvailable + (user.additional_tokens_purchased || 0),
          subscription,
          billingCycle: 'monthly',
          monthlyTokensLimit: user.monthly_tokens_limit || tierLimits.tokensMonthly || 100000,
          monthlyTokensUsed: user.monthly_tokens_used || 0,
          nextReset: user.tokens_reset_at,
          // Daily limit fields
          dailyTokensUsed,
          dailyTokensLimit,
          dailyTokensRemaining,
          hasDailyLimit: hasDailyLimits,
          // Annual fields not applicable
          accumulatedTokens: 0,
          annualTokens: 0,
          nextMonthlyGrant: null,
          subscriptionEndsAt: null
        };
      }
    } catch (error) {
      console.error('[TokenManagerV2] Fallback error:', error);
      return {
        additionalTokens: 0,
        monthlyTokens: FREE_DAILY_TOKEN_LIMIT * 30,
        totalAvailable: FREE_DAILY_TOKEN_LIMIT * 30,
        subscription: 'free',
        monthlyTokensLimit: FREE_DAILY_TOKEN_LIMIT * 30,
        monthlyTokensUsed: 0,
        // Free tier daily limits
        dailyTokensUsed: 0,
        dailyTokensLimit: FREE_DAILY_TOKEN_LIMIT,
        dailyTokensRemaining: FREE_DAILY_TOKEN_LIMIT,
        hasDailyLimit: true
      };
    }
  }

  // Track token usage and deduct from balance
  async trackTokenUsage(userId, projectId, provider, model, tokens, prompt = '') {
    try {
      const inputTokens = tokens.input || tokens.input_tokens || tokens.prompt_tokens || 0;
      const outputTokens = tokens.output || tokens.output_tokens || tokens.completion_tokens || 0;
      const totalTokens = tokens.total || tokens.total_tokens || (inputTokens + outputTokens);
      
      console.log(`[TokenManagerV2] Tracking usage for user ${userId}`);
      console.log(`[TokenManagerV2] Tokens: input=${inputTokens}, output=${outputTokens}, total=${totalTokens}`);
      
      // Calculate cost
      const costBreakdown = calculateCost(model, inputTokens, outputTokens);
      
      // CRITICAL: Deduct tokens using database function
      const { data: deductResult, error: deductError } = await this.supabase
        .rpc('deduct_tokens', { 
          p_user_id: userId,
          p_tokens: totalTokens
        });

      if (deductError) {
        console.error('[TokenManagerV2] CRITICAL: Deduction failed:', deductError);
        // Try fallback deduction
        await this.fallbackDeduction(userId, totalTokens);
      } else if (!deductResult?.success) {
        console.error('[TokenManagerV2] Deduction unsuccessful:', deductResult);
        
        // Provide specific error messages based on error code
        const errorCode = deductResult?.error_code;
        const errorMessage = deductResult?.error || 'Failed to deduct tokens';
        
        if (errorCode === 'INSUFFICIENT_TOKENS') {
          const required = deductResult?.required || totalTokens;
          const available = deductResult?.available || 0;
          throw new Error(`Insufficient tokens: need ${required.toLocaleString()}, have ${available.toLocaleString()}`);
        } else if (errorCode === 'SUBSCRIPTION_EXPIRED') {
          throw new Error('Your subscription has expired. Please renew to continue.');
        } else if (errorCode === 'INVALID_AMOUNT') {
          throw new Error('Invalid token amount requested');
        }
        
        throw new Error(errorMessage);
      } else {
        console.log('[TokenManagerV2] Deduction successful:', deductResult);
        
        // Validate the deduction amount matches what was requested
        if (deductResult.tokens_deducted && deductResult.tokens_deducted !== totalTokens) {
          console.warn('[TokenManagerV2] WARNING: Deduction mismatch:', {
            requested: totalTokens,
            deducted: deductResult.tokens_deducted
          });
        }
      }

      // Record usage details
      const { error: usageError } = await this.supabase
        .from('token_usage_detailed')
        .insert({
          user_id: userId,
          project_id: projectId,
          provider,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          input_cost: costBreakdown.inputCost,
          output_cost: costBreakdown.outputCost,
          prompt: prompt ? prompt.substring(0, 500) : '',
          metadata: {
            timestamp: new Date().toISOString(),
            deducted_from_monthly: deductResult?.from_monthly || 0,
            deducted_from_purchased: deductResult?.from_purchased || 0
          }
        });

      if (usageError) {
        console.error('[TokenManagerV2] Failed to record usage details:', usageError);
      }

      // Get updated balance
      const updatedTokens = await this.getUserTokens(userId);

      return {
        tokensUsed: totalTokens,
        inputTokens,
        outputTokens,
        costBreakdown,
        deductedFromMonthly: deductResult?.from_monthly || 0,
        deductedFromPurchased: deductResult?.from_purchased || 0,
        remainingTokens: updatedTokens.totalAvailable
      };
    } catch (error) {
      console.error('[TokenManagerV2] Error tracking usage:', error);
      throw error;
    }
  }

  // Fallback deduction if RPC fails
  async fallbackDeduction(userId, tokens) {
    try {
      console.log(`[TokenManagerV2] Attempting fallback deduction of ${tokens} tokens`);
      
      const { data: user, error: fetchError } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (fetchError || !user) {
        throw new Error('Failed to fetch user for deduction');
      }

      const monthlyAvailable = Math.max(0, 
        (user.monthly_tokens_limit || 100000) - (user.monthly_tokens_used || 0)
      );
      
      const fromMonthly = Math.min(tokens, monthlyAvailable);
      const fromPurchased = tokens - fromMonthly;

      // Check if user has enough tokens
      if ((monthlyAvailable + (user.additional_tokens_purchased || 0)) < tokens) {
        throw new Error('Insufficient tokens');
      }

      // Update user record
      const updates = {
        monthly_tokens_used: (user.monthly_tokens_used || 0) + fromMonthly,
        additional_tokens_purchased: Math.max(0, 
          (user.additional_tokens_purchased || 0) - fromPurchased
        ),
        updated_at: new Date().toISOString()
      };

      const { error: updateError } = await this.supabase
        .from('users')
        .update(updates)
        .eq('id', userId);

      if (updateError) {
        throw new Error(`Failed to update tokens: ${updateError.message}`);
      }

      console.log(`[TokenManagerV2] Fallback deduction successful: ${fromMonthly} monthly, ${fromPurchased} purchased`);
      
      // Log transaction
      await this.supabase
        .from('token_transactions')
        .insert({
          user_id: userId,
          type: 'usage',
          amount: -tokens,
          description: `Fallback deduction: ${tokens} tokens`,
          metadata: { from_monthly: fromMonthly, from_purchased: fromPurchased }
        });

    } catch (error) {
      console.error('[TokenManagerV2] Fallback deduction failed:', error);
      throw error;
    }
  }

  // Add purchased tokens
  async addTokens(userId, tokenAmount, purchaseMethod = 'stripe') {
    try {
      console.log(`[TokenManagerV2] Adding ${tokenAmount} tokens for user ${userId}`);
      
      const { data, error } = await this.supabase
        .rpc('add_purchased_tokens', {
          p_user_id: userId,
          p_tokens: tokenAmount,
          p_purchase_method: purchaseMethod
        });

      if (error) {
        console.error('[TokenManagerV2] Failed to add tokens:', error);
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to add tokens');
      }

      console.log(`[TokenManagerV2] Successfully added ${tokenAmount} tokens`);
      return data;
    } catch (error) {
      console.error('[TokenManagerV2] Error adding tokens:', error);
      throw error;
    }
  }

  // Handle subscription upgrade
  async upgradeSubscription(userId, newTier) {
    try {
      console.log(`[TokenManagerV2] Upgrading user ${userId} to ${newTier}`);
      
      const { data, error } = await this.supabase
        .rpc('upgrade_subscription', {
          p_user_id: userId,
          p_new_tier: newTier
        });

      if (error) {
        console.error('[TokenManagerV2] Failed to upgrade:', error);
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Failed to upgrade subscription');
      }

      console.log(`[TokenManagerV2] Successfully upgraded to ${newTier}`);
      return data;
    } catch (error) {
      console.error('[TokenManagerV2] Error upgrading subscription:', error);
      throw error;
    }
  }

  // Get token packages for a tier (uses STRIPE_TOKEN_PACKAGES from stripe.js)
  getTokenPackages(tier) {
    // Convert TOKEN_PACKAGES object to array format if needed
    if (STRIPE_TOKEN_PACKAGES) {
      return Object.values(STRIPE_TOKEN_PACKAGES).map(pkg => ({
        tokens: pkg.tokens,
        price: pkg.price,
        priceId: pkg.priceId,
        discount: pkg.discount || 0,
        name: pkg.name,
        description: pkg.description,
        popular: pkg.popular
      }));
    }
    // Fallback to basic packages
    return [
      { tokens: 100000, price: 5.00, name: '100K Tokens' },
      { tokens: 500000, price: 20.00, name: '500K Tokens' },
      { tokens: 1000000, price: 35.00, name: '1M Tokens' },
      { tokens: 5000000, price: 150.00, name: '5M Tokens' }
    ];
  }

  // Calculate token cost
  calculateTokenCost(model, inputTokens, outputTokens) {
    return calculateCost(model, inputTokens, outputTokens);
  }

  // Get user credits (compatibility method)
  async getUserCredits(userId) {
    try {
      const tokens = await this.getUserTokens(userId);
      
      // Convert tokens to credit-like format for compatibility
      return {
        balance: (tokens.additionalTokens / 1000) * 0.10,
        freeCredits: (tokens.monthlyTokens / 1000) * 0.10,
        freeCreditsLimit: (tokens.monthlyTokensLimit / 1000) * 0.10,
        totalAvailable: (tokens.totalAvailable / 1000) * 0.10,
        paidCredits: (tokens.additionalTokens / 1000) * 0.10
      };
    } catch (error) {
      console.error('[TokenManagerV2] Error getting user credits:', error);
      return {
        balance: 0,
        freeCredits: 0,
        freeCreditsLimit: 10,
        totalAvailable: 0,
        paidCredits: 0
      };
    }
  }

  /**
   * Simple token deduction method (wrapper for trackTokenUsage)
   * Used by unified-chat.js and other endpoints
   */
  async deductTokens(userId, totalTokens, options = {}) {
    try {
      const { projectId = null, operation = 'api', model = 'claude-sonnet-4-20250514' } = options;

      console.log(`[TokenManagerV2] deductTokens: ${totalTokens} tokens for user ${userId}`);

      // Use the existing trackTokenUsage method
      // Estimate input/output split (70/30 is typical for generation)
      const inputTokens = Math.floor(totalTokens * 0.7);
      const outputTokens = totalTokens - inputTokens;

      return await this.trackTokenUsage(
        userId,
        projectId,
        'anthropic',
        model,
        { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens },
        operation
      );
    } catch (error) {
      console.error('[TokenManagerV2] deductTokens error:', error);
      throw error;
    }
  }

  // Get usage summary
  async getUsageSummary(userId) {
    try {
      const [balance, recentUsage, transactions] = await Promise.all([
        this.getUserTokens(userId),
        this.supabase
          .from('token_usage_detailed')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),
        this.supabase
          .from('token_transactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10)
      ]);

      return {
        balance,
        recentUsage: recentUsage.data || [],
        transactions: transactions.data || []
      };
    } catch (error) {
      console.error('[TokenManagerV2] Error getting usage summary:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const tokenManagerV2 = new TokenManagerV2();

// Also export as default for compatibility
export default tokenManagerV2;