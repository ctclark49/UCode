// pages/api/update-plan.js
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import * as database from "../../lib/database";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { plan } = req.body;

    // Canonical tiers: starter, creator, business, enterprise
    // Also accept legacy aliases: free → starter, pro → creator
    const validPlans = ['starter', 'creator', 'business', 'enterprise', 'free', 'pro'];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Normalize tier names
    const normalizedPlan = plan === 'free' ? 'starter' : (plan === 'pro' ? 'creator' : plan);

    console.log(`[Update Plan] Changing user ${session.user.email} to ${normalizedPlan} plan`);

    // Get user from database
    const user = await database.getUserByEmail(session.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update subscription using the correct function
    const updatedUser = await database.updateUserSubscription(user.id, {
      tier: normalizedPlan,
      status: 'active'
    });

    if (!updatedUser) {
      throw new Error('Failed to update subscription');
    }

    console.log(`[Update Plan] Successfully updated to ${normalizedPlan} plan`);

    return res.status(200).json({
      success: true,
      message: `Successfully updated to ${normalizedPlan} plan`,
      user: {
        subscription_tier: updatedUser.subscription_tier,
        usage_limit: updatedUser.usage_limit
      }
    });

  } catch (error) {
    console.error('[Update Plan] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to update plan',
      details: error.message 
    });
  }
}