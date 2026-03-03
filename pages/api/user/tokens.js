/**
 * User Tokens API Endpoint
 * Returns the current user's token balance
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { tokenManagerV2 } from '../../../lib/tokens-v2';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user session
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = session.user.id;

    // Get token balance using tokenManagerV2
    const tokenBalance = await tokenManagerV2.getUserTokens(userId);

    // Return the token balance with all relevant fields
    return res.status(200).json({
      totalAvailable: tokenBalance.totalAvailable || 0,
      subscription: tokenBalance.subscription || 'free',
      billingCycle: tokenBalance.billingCycle || 'monthly',
      // Purchased/additional tokens
      additionalTokens: tokenBalance.additionalTokens || 0,
      // Monthly tokens (for monthly billing)
      monthlyTokens: tokenBalance.monthlyTokens || 0,
      monthlyTokensLimit: tokenBalance.monthlyTokensLimit || 0,
      monthlyTokensUsed: tokenBalance.monthlyTokensUsed || 0,
      nextReset: tokenBalance.nextReset,
      // Annual tokens (for annual billing)
      accumulatedTokens: tokenBalance.accumulatedTokens || 0,
      monthlyAllocation: tokenBalance.monthlyAllocation || 0,
      nextMonthlyGrant: tokenBalance.nextMonthlyGrant,
      // Daily limits (for free tier)
      hasDailyLimit: tokenBalance.hasDailyLimit || false,
      dailyTokensUsed: tokenBalance.dailyTokensUsed || 0,
      dailyTokensLimit: tokenBalance.dailyTokensLimit,
      dailyTokensRemaining: tokenBalance.dailyTokensRemaining,
      userId: userId
    });

  } catch (error) {
    console.error('Error in tokens endpoint:', error);

    // If token manager fails, return default values
    return res.status(200).json({
      totalAvailable: 0,
      subscription: 'free',
      billingCycle: 'monthly',
      additionalTokens: 0,
      monthlyTokens: 0,
      hasDailyLimit: true,
      dailyTokensRemaining: 0,
      error: 'Failed to fetch token balance'
    });
  }
}