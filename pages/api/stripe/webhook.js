import { stripe, getPlanFromPriceId, PLAN_CONFIG, TOKEN_PACKAGES } from '../../../lib/stripe'
import { updateUserSubscription, getUserByEmail, createOrUpdateUser } from '../../../lib/database'
import { buffer } from 'micro'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Skip webhook handling during development
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.log('🚧 Webhooks not configured - skipping in development mode')
    return res.status(200).json({
      received: true,
      message: 'Webhooks will be configured after deployment'
    })
  }

  const buf = await buffer(req)
  const sig = req.headers['stripe-signature']

  let event

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  console.log(`🔔 Received webhook: ${event.type}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object)
        break

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object)
        break

      default:
        console.log(`🤷‍♂️ Unhandled event type: ${event.type}`)
    }

    res.status(200).json({ received: true })
  } catch (error) {
    console.error('❌ Webhook handler error:', error)
    res.status(500).json({ error: 'Webhook handler failed' })
  }
}

async function handleCheckoutSessionCompleted(session) {
  console.log('✅ Checkout session completed:', session.id)

  const { customer_email, metadata } = session

  try {
    // Get or create customer
    const customer = session.customer
      ? await stripe.customers.retrieve(session.customer)
      : { id: null, name: customer_email?.split('@')[0] }

    // Update user with Stripe customer ID
    let user = await getUserByEmail(customer_email)
    if (!user) {
      user = await createOrUpdateUser({
        email: customer_email,
        name: customer.name || customer_email?.split('@')[0]
      })
    }

    const purchaseType = metadata?.purchaseType

    // ===== HANDLE TOKEN PACKAGE PURCHASE =====
    if (purchaseType === 'token_package') {
      const tokenPackageKey = metadata?.tokenPackageKey
      const tokensToAdd = parseInt(metadata?.tokensToAdd || '0', 10)

      console.log(`📦 Token package purchased: ${tokenPackageKey} (${tokensToAdd} tokens)`)
      console.log(`👤 User: ${user.email} (ID: ${user.id})`)

      if (tokensToAdd > 0) {
        // Add tokens to user's account
        await addTokensToUser(user.id, tokensToAdd, {
          source: 'token_package',
          packageKey: tokenPackageKey,
          stripeSessionId: session.id,
          amount: session.amount_total / 100 // Convert from cents
        })

        console.log(`✅ Added ${tokensToAdd.toLocaleString()} tokens to user ${user.email}`)
      }

      // Update Stripe customer ID if we have one
      if (customer.id) {
        await updateUserSubscription(user.id, {
          stripeCustomerId: customer.id
        })
      }

      return
    }

    // ===== HANDLE SUBSCRIPTION PURCHASE =====
    const planKey = metadata?.planKey || user.subscriptionTier || 'starter'
    const billingCycle = metadata?.billingCycle || 'monthly'

    console.log(`📧 Subscription checkout completed - User: ${customer_email}, Plan: ${planKey}, Cycle: ${billingCycle}`)

    // Get plan config to allocate initial tokens
    const plan = PLAN_CONFIG[planKey]
    const tokensToGrant = plan?.limits?.tokensMonthly || 0

    await updateUserSubscription(user.id, {
      stripeCustomerId: customer.id,
      tier: planKey,
      status: 'active',
      billingCycle: billingCycle
    })

    // Grant initial monthly tokens for new subscriptions
    if (tokensToGrant > 0) {
      await addTokensToUser(user.id, tokensToGrant, {
        source: 'subscription_grant',
        planKey: planKey,
        billingCycle: billingCycle,
        stripeSessionId: session.id
      })
      console.log(`✅ Granted ${tokensToGrant.toLocaleString()} monthly tokens to user ${user.email}`)
    }

  } catch (error) {
    console.error('❌ Error handling checkout completion:', error)
    throw error
  }
}

/**
 * Add tokens to a user's account
 * @param {string} userId - The user's ID
 * @param {number} tokens - Number of tokens to add
 * @param {object} metadata - Additional info about the token grant
 */
async function addTokensToUser(userId, tokens, metadata = {}) {
  try {
    // Import supabase for direct database access
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // First, get current user data
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('tokens_remaining, tokens_purchased')
      .eq('id', userId)
      .single()

    if (fetchError) {
      console.error('❌ Failed to fetch user for token update:', fetchError)
      throw fetchError
    }

    const currentTokens = user?.tokens_remaining || 0
    const currentPurchased = user?.tokens_purchased || 0
    const newTotal = currentTokens + tokens

    // Update user's token balance
    const { error: updateError } = await supabase
      .from('users')
      .update({
        tokens_remaining: newTotal,
        tokens_purchased: currentPurchased + (metadata.source === 'token_package' ? tokens : 0),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (updateError) {
      console.error('❌ Failed to update user tokens:', updateError)
      throw updateError
    }

    // Log the token transaction
    const { error: logError } = await supabase
      .from('token_transactions')
      .insert({
        user_id: userId,
        amount: tokens,
        type: metadata.source === 'token_package' ? 'purchase' : 'grant',
        source: metadata.source,
        metadata: metadata,
        created_at: new Date().toISOString()
      })

    if (logError) {
      // Don't throw - transaction logging is secondary
      console.warn('⚠️ Failed to log token transaction:', logError.message)
    }

    console.log(`💰 Token update successful: ${currentTokens} → ${newTotal} (+${tokens})`)
    return { success: true, previousBalance: currentTokens, newBalance: newTotal }

  } catch (error) {
    console.error('❌ addTokensToUser failed:', error)
    throw error
  }
}

async function handleSubscriptionChange(subscription) {
  console.log('🔄 Subscription change:', subscription.id, 'Status:', subscription.status)

  try {
    const customer = await stripe.customers.retrieve(subscription.customer)
    const user = await getUserByEmail(customer.email)

    if (!user) {
      console.error('❌ User not found for subscription:', subscription.id, 'Email:', customer.email)
      return
    }

    // Get plan from price ID
    const priceId = subscription.items.data[0]?.price.id
    console.log('🔍 Looking up plan for price ID:', priceId)
    const plan = getPlanFromPriceId(priceId)

    if (!plan) {
      console.error('❌ Plan not found for price ID:', priceId)
      console.error('User email:', customer.email)
      // Don't fail - keep user on their current plan
      return
    }

    // Update user subscription
    await updateUserSubscription(user.id, {
      tier: plan.key,
      status: subscription.status,
      stripeCustomerId: customer.id,
      billingCycle: plan.billingCycle || 'monthly'
    })

    console.log(`✅ Updated user ${user.email} to ${plan.key} plan (${plan.billingCycle || 'monthly'})`)

  } catch (error) {
    console.error('❌ Error handling subscription change:', error)
    throw error
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log('❌ Subscription deleted:', subscription.id)
  
  try {
    const customer = await stripe.customers.retrieve(subscription.customer)
    const user = await getUserByEmail(customer.email)
    
    if (!user) {
      console.error('❌ User not found for deleted subscription:', subscription.id)
      return
    }
    
    // Downgrade to starter plan
    await updateUserSubscription(user.id, {
      tier: 'starter',
      status: 'canceled',
      stripeCustomerId: customer.id
    })
    
    console.log(`⬇️ Downgraded user ${user.email} to starter plan`)
    
  } catch (error) {
    console.error('❌ Error handling subscription deletion:', error)
    throw error
  }
}

async function handlePaymentSucceeded(invoice) {
  console.log('💰 Payment succeeded:', invoice.id)
  
  try {
    const customer = await stripe.customers.retrieve(invoice.customer)
    const user = await getUserByEmail(customer.email)
    
    if (!user) {
      console.error('❌ User not found for payment:', invoice.id)
      return
    }
    
    // Reset usage count on successful payment (monthly reset)
    if (user) {
      await updateUserSubscription(user.id, {
        tier: user.subscriptionTier,
        status: 'active',
        stripeCustomerId: customer.id
      })
      
      console.log(`🔄 Reset usage for user ${user.email}`)
    }
    
  } catch (error) {
    console.error('❌ Error handling payment success:', error)
    throw error
  }
}

async function handlePaymentFailed(invoice) {
  console.log('⚠️ Payment failed:', invoice.id)
  
  try {
    const customer = await stripe.customers.retrieve(invoice.customer)
    const user = await getUserByEmail(customer.email)
    
    if (!user) {
      console.error('❌ User not found for failed payment:', invoice.id)
      return
    }
    
    // Update status to past_due but don't downgrade immediately
    await updateUserSubscription(user.id, {
      tier: user.subscriptionTier,
      status: 'past_due',
      stripeCustomerId: customer.id
    })
    
    console.log(`⚠️ Marked user ${user.email} as past due`)
    
  } catch (error) {
    console.error('❌ Error handling payment failure:', error)
    throw error
  }
}