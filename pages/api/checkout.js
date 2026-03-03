// pages/api/checkout.js
// Industry best practice: Unified checkout for subscriptions and token packages
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth/[...nextauth]';
import * as db from '../../lib/database';
import { PLAN_CONFIG, TOKEN_PACKAGES } from '../../lib/stripe';

// Only import Stripe if configured
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });
}

/**
 * Calculate token package price with subscription-based discount
 * @param {object} tokenPkg - Token package from TOKEN_PACKAGES
 * @param {string} userTier - User's subscription tier
 * @returns {object} - { originalPrice, discount, finalPrice }
 */
function calculateTokenPrice(tokenPkg, userTier) {
  const planConfig = PLAN_CONFIG[userTier?.toLowerCase()] || PLAN_CONFIG.free;
  const tierDiscount = planConfig.limits?.tokenDiscount || 0;

  const originalPrice = tokenPkg.price;
  const discountAmount = originalPrice * (tierDiscount / 100);
  const finalPrice = Math.round((originalPrice - discountAmount) * 100) / 100;

  return {
    originalPrice,
    tierDiscount,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalPrice
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const {
    planKey,                    // 'free', 'creator', 'business'
    billingCycle = 'monthly',   // 'monthly' or 'yearly'
    tokenPackage,               // { id: 'small', tokens: 100000, price: 5 }
    tokenOnly = false           // If true, only purchase tokens (no subscription change)
  } = req.body;

  console.log('[Checkout] Request:', { planKey, billingCycle, tokenPackage, tokenOnly });

  try {
    // Get or create user
    let user = await db.getUserByEmail(session.user.email.toLowerCase());
    if (!user) {
      user = await db.createOrUpdateUser({
        email: session.user.email.toLowerCase(),
        name: session.user.name || session.user.email.split('@')[0]
      });
    }

    // Get user's current subscription tier for discount calculation
    const userStats = await db.getUserUsageStats(user.id);
    const currentTier = userStats?.subscription_tier || 'free';

    // ===== TOKEN-ONLY PURCHASE =====
    if (tokenOnly && tokenPackage) {
      return await handleTokenOnlyPurchase(req, res, user, tokenPackage, currentTier);
    }

    // ===== SUBSCRIPTION PURCHASE =====
    // Canonical tiers: starter (free), creator, business, enterprise
    // Legacy aliases: free → starter, pro → creator
    const validPlans = ['free', 'starter', 'creator', 'business', 'pro', 'enterprise'];
    if (!planKey || !validPlans.includes(planKey)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Normalize tier names to canonical form
    // starter/free → 'starter' (stored in DB), creator/pro → 'creator'
    const normalizedPlanKey = planKey === 'free' ? 'starter' : (planKey === 'pro' ? 'creator' : planKey);

    // Check if we're in test mode (no Stripe configured)
    if (!stripe || !process.env.STRIPE_SECRET_KEY) {
      console.log('[Checkout] No Stripe configured - using test mode');

      // For test mode, directly update the subscription
      const updatedUser = await db.updateUserSubscription(user.id, {
        tier: normalizedPlanKey,
        status: 'active'
      });

      if (!updatedUser) {
        throw new Error('Failed to update subscription');
      }

      return res.status(200).json({
        success: true,
        testMode: true,
        message: `Successfully switched to ${planKey.toUpperCase()} plan (Test Mode)`,
        redirect: '/billing?success=true'
      });
    }

    // Handle free/starter tier - no Stripe checkout needed
    if (normalizedPlanKey === 'starter') {
      const updatedUser = await db.updateUserSubscription(user.id, {
        tier: 'starter',
        status: 'active'
      });

      if (!updatedUser) {
        throw new Error('Failed to update subscription');
      }

      return res.status(200).json({
        success: true,
        message: 'Successfully switched to Starter plan',
        redirect: '/billing?success=true'
      });
    }

    // Get the price ID for the selected plan (use normalizedPlanKey for PLAN_CONFIG lookup)
    const plan = PLAN_CONFIG[normalizedPlanKey];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan configuration' });
    }

    const priceId = billingCycle === 'yearly' ? plan.priceIdYearly : plan.priceIdMonthly;

    if (!priceId) {
      console.error(`[Checkout] Price ID not found for plan: ${normalizedPlanKey}, cycle: ${billingCycle}`);
      return res.status(400).json({
        error: 'Price configuration error. Please contact support.',
        details: `Missing price ID for ${normalizedPlanKey} ${billingCycle}`
      });
    }

    // Create or retrieve Stripe customer
    let stripeCustomerId = user.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.name || undefined,
        metadata: {
          userId: user.id.toString(),
          source: 'ezcoder'
        }
      });

      stripeCustomerId = customer.id;

      await db.updateUserSubscription(user.id, {
        stripeCustomerId: stripeCustomerId
      });
    }

    // Build line items
    const lineItems = [
      {
        price: priceId,
        quantity: 1,
      },
    ];

    // Build metadata (use normalizedPlanKey for consistency)
    const metadata = {
      userId: user.id.toString(),
      planKey: normalizedPlanKey,
      billingCycle: billingCycle,
      purchaseType: 'subscription'
    };

    // Add token package if selected with subscription
    if (tokenPackage && tokenPackage.tokens) {
      const tokenPkg = Object.values(TOKEN_PACKAGES).find(
        pkg => pkg.tokens === tokenPackage.tokens
      );

      if (tokenPkg) {
        // Calculate discounted price based on the NEW plan they're subscribing to
        const newPlanConfig = PLAN_CONFIG[normalizedPlanKey];
        const tierDiscount = newPlanConfig?.limits?.tokenDiscount || 0;
        const discountedPrice = Math.round(tokenPkg.price * (1 - tierDiscount / 100) * 100) / 100;

        metadata.tokenPackage = JSON.stringify({
          tokens: tokenPackage.tokens,
          originalPrice: tokenPkg.price,
          discount: tierDiscount,
          finalPrice: discountedPrice
        });

        // If we have a Stripe price ID for tokens, add it
        if (tokenPkg.priceId) {
          lineItems.push({
            price: tokenPkg.priceId,
            quantity: 1
          });
        } else {
          // Create a one-time price for the token package
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: {
                name: `${tokenPkg.name} Add-on`,
                description: `${tokenPackage.tokens.toLocaleString()} additional tokens${tierDiscount > 0 ? ` (${tierDiscount}% subscriber discount)` : ''}`
              },
              unit_amount: Math.round(discountedPrice * 100) // Convert to cents
            },
            quantity: 1
          });
        }

        console.log(`[Checkout] Token package added: ${tokenPkg.name} at $${discountedPrice} (${tierDiscount}% off)`);
      }
    }

    // Create Stripe checkout session
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${process.env.NEXTAUTH_URL}/billing?success=true&plan=${normalizedPlanKey}`,
      cancel_url: `${process.env.NEXTAUTH_URL}/billing?canceled=true`,
      metadata: metadata,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        metadata: {
          planKey: normalizedPlanKey,
          billingCycle: billingCycle
        }
      }
    });

    console.log(`[Checkout] Created session: ${checkoutSession.id}`);

    res.status(200).json({
      success: true,
      url: checkoutSession.url
    });

  } catch (error) {
    console.error('[Checkout] Error:', error);

    if (error.type === 'StripeAuthenticationError' || error.message?.includes('Stripe')) {
      return res.status(200).json({
        success: false,
        testMode: true,
        error: 'Stripe not properly configured. Please contact support.',
      });
    }

    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
}

/**
 * Handle token-only purchases (no subscription change)
 */
async function handleTokenOnlyPurchase(req, res, user, tokenPackage, currentTier) {
  console.log(`[Checkout] Token-only purchase for user ${user.id}, tier: ${currentTier}`);

  // Find the token package
  const tokenPkg = Object.entries(TOKEN_PACKAGES).find(
    ([key, pkg]) => pkg.tokens === tokenPackage.tokens || key === tokenPackage.id
  );

  if (!tokenPkg) {
    return res.status(400).json({ error: 'Invalid token package' });
  }

  const [packageKey, pkg] = tokenPkg;

  // Calculate price with subscription discount
  const pricing = calculateTokenPrice(pkg, currentTier);

  console.log(`[Checkout] Token pricing:`, pricing);

  // Check if Stripe is configured
  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    // Test mode - directly add tokens
    console.log('[Checkout] Test mode - adding tokens directly');

    // In test mode, we'd need to update the user's token balance
    // This would typically be done via the webhook, but for testing:
    return res.status(200).json({
      success: true,
      testMode: true,
      message: `Would purchase ${pkg.tokens.toLocaleString()} tokens for $${pricing.finalPrice}`,
      pricing: pricing
    });
  }

  // Create or retrieve Stripe customer
  let stripeCustomerId = user.stripe_customer_id;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: {
        userId: user.id.toString(),
        source: 'ezcoder'
      }
    });

    stripeCustomerId = customer.id;

    await db.updateUserSubscription(user.id, {
      stripeCustomerId: stripeCustomerId
    });
  }

  // Create checkout session for one-time token purchase
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    mode: 'payment', // One-time payment, not subscription
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: pkg.name,
            description: `${pkg.tokens.toLocaleString()} tokens for your EzCoder account${pricing.tierDiscount > 0 ? ` (${pricing.tierDiscount}% ${currentTier} discount applied)` : ''}`
          },
          unit_amount: Math.round(pricing.finalPrice * 100) // Convert to cents
        },
        quantity: 1
      }
    ],
    success_url: `${process.env.NEXTAUTH_URL}/billing?success=tokens`,
    cancel_url: `${process.env.NEXTAUTH_URL}/billing?canceled=true`,
    metadata: {
      userId: user.id.toString(),
      purchaseType: 'token_package',
      tokenPackageKey: packageKey,
      tokensToAdd: pkg.tokens.toString(),
      originalPrice: pricing.originalPrice.toString(),
      discount: pricing.tierDiscount.toString(),
      finalPrice: pricing.finalPrice.toString()
    }
  });

  console.log(`[Checkout] Created token purchase session: ${checkoutSession.id}`);

  return res.status(200).json({
    success: true,
    url: checkoutSession.url,
    pricing: pricing
  });
}
