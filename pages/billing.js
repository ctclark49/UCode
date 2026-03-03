// pages/billing.js - Full-featured billing page with token balance and purchase options
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useSession, signIn } from "next-auth/react";
import { modernTheme } from '../lib/theme';

// Token packages for one-time purchases
const TOKEN_PACKAGES = [
  { id: 'small', name: '100K Tokens', tokens: 100000, price: 5.00, discount: 0, description: 'Good for small projects' },
  { id: 'medium', name: '500K Tokens', tokens: 500000, price: 20.00, discount: 20, description: 'Best for regular use' },
  { id: 'large', name: '1M Tokens', tokens: 1000000, price: 35.00, discount: 30, description: 'Great value for heavy users', popular: true },
  { id: 'xlarge', name: '5M Tokens', tokens: 5000000, price: 150.00, discount: 40, description: 'Maximum savings for teams' }
];

// Subscription plans
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: ['7,500 tokens per day', '3 projects maximum', 'Basic templates', 'Claude Haiku 4.5'],
    tokensMonthly: 225000,
    color: modernTheme.colors.textLight
  },
  creator: {
    name: 'Creator',
    price: 25,
    features: ['500K tokens/month', 'Unlimited projects', 'Premium templates', 'Claude Sonnet 4', 'Deep Think mode', '5% token discount'],
    tokensMonthly: 500000,
    color: modernTheme.colors.primary,
    popular: true
  },
  business: {
    name: 'Business',
    price: 45,
    features: ['2M tokens/month', 'Unlimited projects', 'All AI models', 'Max Mode (All Opus)', 'API access', '10% token discount'],
    tokensMonthly: 2000000,
    color: modernTheme.colors.secondary
  }
};

export default function BillingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [tokenBalance, setTokenBalance] = useState({
    totalAvailable: 0,
    monthlyTokens: 0,
    additionalTokens: 0,
    monthlyTokensLimit: 0,
    monthlyTokensUsed: 0,
    subscription: 'free',
    hasDailyLimit: false,
    dailyTokensRemaining: 0,
    dailyTokensLimit: 0
  });
  const [userStats, setUserStats] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(null);
  const [upgradeLoading, setUpgradeLoading] = useState(null);
  const [error, setError] = useState(null);
  const [billingCycle, setBillingCycle] = useState('monthly');

  // Check authentication
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      signIn();
      return;
    }
    loadUserData();
  }, [session, status]);

  // Scroll to buy-tokens section if hash is present
  useEffect(() => {
    if (router.asPath.includes('#buy-tokens') && !loading) {
      setTimeout(() => {
        document.getElementById('buy-tokens')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [router.asPath, loading]);

  const loadUserData = async () => {
    try {
      const [tokensResponse, statsResponse] = await Promise.all([
        fetch('/api/user/tokens'),
        fetch('/api/user/stats')
      ]);

      if (tokensResponse.ok) {
        const tokensData = await tokensResponse.json();
        setTokenBalance(tokensData);
      }

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setUserStats(statsData.stats);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      setError('Failed to load account data');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchaseTokens = async (packageId) => {
    setPurchaseLoading(packageId);
    setError(null);

    try {
      const pkg = TOKEN_PACKAGES.find(p => p.id === packageId);
      if (!pkg) {
        setError('Invalid token package');
        setPurchaseLoading(null);
        return;
      }

      // Use checkout API with token package
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planKey: getCurrentPlanKey() === 'free' ? 'creator' : getCurrentPlanKey(),
          billingCycle,
          tokenPackage: {
            tokens: pkg.tokens,
            price: pkg.price
          }
        })
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else if (data.redirect) {
        router.push(data.redirect);
      } else {
        setError(data.error || 'Failed to create checkout session');
      }
    } catch (err) {
      setError('Failed to initiate purchase');
      console.error('Purchase error:', err);
    } finally {
      setPurchaseLoading(null);
    }
  };

  const handleUpgrade = async (planKey) => {
    setUpgradeLoading(planKey);
    setError(null);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planKey,
          billingCycle
        })
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else if (data.redirect) {
        router.push(data.redirect);
      } else {
        setError(data.error || 'Failed to create checkout session');
      }
    } catch (err) {
      setError('Failed to initiate upgrade');
      console.error('Upgrade error:', err);
    } finally {
      setUpgradeLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const response = await fetch('/api/stripe/customer-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/billing`
        })
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to open billing portal');
      }
    } catch (err) {
      setError('Failed to open billing portal');
      console.error('Portal error:', err);
    }
  };

  const getTokenStatusColor = () => {
    if (tokenBalance.totalAvailable > 100000) return modernTheme.colors.success;
    if (tokenBalance.totalAvailable > 10000) return modernTheme.colors.primary;
    if (tokenBalance.totalAvailable > 1000) return modernTheme.colors.warning;
    return modernTheme.colors.error;
  };

  const formatTokens = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
    return num?.toLocaleString() || '0';
  };

  const getCurrentPlanKey = () => {
    const tier = (tokenBalance.subscription || userStats?.subscription_tier || 'free').toLowerCase();
    if (tier === 'starter') return 'free';
    if (tier === 'pro') return 'creator';
    return tier;
  };

  if (status === "loading" || loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <p>Loading billing information...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const currentPlan = getCurrentPlanKey();
  const showSuccess = router.query.success;

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <button onClick={() => router.push("/projects")} style={styles.backButton}>
            ← Back to Projects
          </button>
          <h1 style={styles.headerTitle}>Billing & Tokens</h1>
          <div style={styles.userEmail}>{session.user.email}</div>
        </div>
      </header>

      {/* Success Message */}
      {showSuccess && (
        <div style={styles.successBanner}>
          {showSuccess === 'tokens' ? 'Tokens added successfully!' : 'Subscription updated successfully!'}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div style={styles.errorBanner}>
          {error}
          <button onClick={() => setError(null)} style={styles.dismissButton}>×</button>
        </div>
      )}

      <main style={styles.main}>
        {/* Token Balance Card - Prominent Display */}
        <section style={styles.tokenBalanceSection}>
          <div style={styles.tokenBalanceCard}>
            <div style={styles.tokenBalanceHeader}>
              <div style={styles.tokenIcon}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={getTokenStatusColor()} strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div>
                <h2 style={styles.tokenBalanceTitle}>Token Balance</h2>
                <p style={styles.tokenBalanceSubtitle}>Available for AI generation</p>
              </div>
            </div>

            <div style={styles.tokenBalanceMain}>
              <span style={{...styles.tokenBalanceNumber, color: getTokenStatusColor()}}>
                {formatTokens(tokenBalance.totalAvailable)}
              </span>
              <span style={styles.tokenBalanceLabel}>tokens</span>
            </div>

            <div style={styles.tokenBreakdown}>
              {tokenBalance.hasDailyLimit ? (
                <div style={styles.tokenBreakdownItem}>
                  <span style={styles.tokenBreakdownLabel}>Daily Remaining:</span>
                  <span style={styles.tokenBreakdownValue}>
                    {formatTokens(tokenBalance.dailyTokensRemaining)} / {formatTokens(tokenBalance.dailyTokensLimit)}
                  </span>
                </div>
              ) : (
                <>
                  <div style={styles.tokenBreakdownItem}>
                    <span style={styles.tokenBreakdownLabel}>Monthly:</span>
                    <span style={styles.tokenBreakdownValue}>
                      {formatTokens(tokenBalance.monthlyTokens)} / {formatTokens(tokenBalance.monthlyTokensLimit)}
                    </span>
                  </div>
                  <div style={styles.tokenBreakdownItem}>
                    <span style={styles.tokenBreakdownLabel}>Purchased:</span>
                    <span style={styles.tokenBreakdownValue}>{formatTokens(tokenBalance.additionalTokens)}</span>
                  </div>
                </>
              )}
              <div style={styles.tokenBreakdownItem}>
                <span style={styles.tokenBreakdownLabel}>Plan:</span>
                <span style={{...styles.tokenBreakdownValue, textTransform: 'capitalize', color: PLANS[currentPlan]?.color || modernTheme.colors.text}}>
                  {PLANS[currentPlan]?.name || currentPlan}
                </span>
              </div>
            </div>

            {tokenBalance.totalAvailable < 10000 && (
              <a href="#buy-tokens" style={styles.lowTokensWarning}>
                Low on tokens! Add more below ↓
              </a>
            )}
          </div>
        </section>

        {/* Buy Tokens Section */}
        <section id="buy-tokens" style={styles.section}>
          <h2 style={styles.sectionTitle}>Buy Token Packs</h2>
          <p style={styles.sectionSubtitle}>One-time purchases. Tokens never expire.</p>

          <div style={styles.tokenPackagesGrid}>
            {TOKEN_PACKAGES.map((pkg) => (
              <div key={pkg.id} style={{
                ...styles.tokenPackageCard,
                ...(pkg.popular && styles.popularCard)
              }}>
                {pkg.popular && <div style={styles.popularBadge}>Most Popular</div>}
                <h3 style={styles.packageName}>{pkg.name}</h3>
                <div style={styles.packagePrice}>
                  <span style={styles.priceAmount}>${pkg.price}</span>
                </div>
                <p style={styles.packageDescription}>{pkg.description}</p>
                {pkg.discount > 0 && (
                  <div style={styles.discountBadge}>{pkg.discount}% savings</div>
                )}
                <button
                  onClick={() => handlePurchaseTokens(pkg.id)}
                  disabled={purchaseLoading === pkg.id}
                  style={{
                    ...styles.purchaseButton,
                    ...(pkg.popular && styles.purchaseButtonPopular)
                  }}
                >
                  {purchaseLoading === pkg.id ? 'Processing...' : 'Buy Now'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Subscription Plans Section */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Subscription Plans</h2>
          <p style={styles.sectionSubtitle}>Get more tokens monthly and unlock premium features</p>

          {/* Billing Cycle Toggle */}
          <div style={styles.billingToggle}>
            <button
              onClick={() => setBillingCycle('monthly')}
              style={{
                ...styles.billingToggleButton,
                ...(billingCycle === 'monthly' && styles.billingToggleActive)
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              style={{
                ...styles.billingToggleButton,
                ...(billingCycle === 'yearly' && styles.billingToggleActive)
              }}
            >
              Yearly (Save 20%)
            </button>
          </div>

          <div style={styles.plansGrid}>
            {Object.entries(PLANS).map(([key, plan]) => {
              const isCurrentPlan = currentPlan === key;
              const yearlyPrice = key === 'free' ? 0 : Math.round(plan.price * 12 * 0.8);
              const displayPrice = billingCycle === 'yearly' ? yearlyPrice : plan.price;

              return (
                <div key={key} style={{
                  ...styles.planCard,
                  ...(plan.popular && styles.popularPlanCard),
                  ...(isCurrentPlan && styles.currentPlanCard)
                }}>
                  {plan.popular && <div style={styles.popularBadge}>Recommended</div>}
                  {isCurrentPlan && <div style={styles.currentBadge}>Current Plan</div>}

                  <h3 style={{...styles.planName, color: plan.color}}>{plan.name}</h3>

                  <div style={styles.planPrice}>
                    <span style={styles.planPriceAmount}>${displayPrice}</span>
                    <span style={styles.planPricePeriod}>/{billingCycle === 'yearly' ? 'year' : 'month'}</span>
                  </div>

                  <div style={styles.planTokens}>
                    {formatTokens(plan.tokensMonthly)} tokens/month
                  </div>

                  <ul style={styles.featuresList}>
                    {plan.features.map((feature, idx) => (
                      <li key={idx} style={styles.featureItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={modernTheme.colors.success} strokeWidth="2" style={{flexShrink: 0}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {isCurrentPlan ? (
                    <button
                      onClick={handleManageSubscription}
                      style={styles.manageButton}
                    >
                      Manage Subscription
                    </button>
                  ) : key === 'free' ? (
                    <button style={styles.disabledButton} disabled>
                      Free Plan
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(key)}
                      disabled={upgradeLoading === key}
                      style={{
                        ...styles.upgradeButton,
                        ...(plan.popular && styles.upgradeButtonPopular)
                      }}
                    >
                      {upgradeLoading === key ? 'Processing...' : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Usage History Link */}
        <section style={styles.section}>
          <div style={styles.usageLink}>
            <h3>View Usage History</h3>
            <p>Track your token usage and AI generation history</p>
            <button onClick={() => router.push('/analytics')} style={styles.viewUsageButton}>
              View Analytics →
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: modernTheme.colors.bgPrimary,
    color: modernTheme.colors.text,
    fontFamily: modernTheme.typography.fontFamily.sans,
    minHeight: "100vh"
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    gap: "1rem"
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: `3px solid ${modernTheme.colors.border}`,
    borderTop: `3px solid ${modernTheme.colors.primary}`,
    borderRadius: "50%",
    animation: "spin 1s linear infinite"
  },
  header: {
    backgroundColor: modernTheme.colors.bgSecondary,
    borderBottom: `1px solid ${modernTheme.colors.border}`,
    padding: "1rem 0",
    position: "sticky",
    top: 0,
    zIndex: 100
  },
  headerContent: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  backButton: {
    backgroundColor: "transparent",
    color: modernTheme.colors.primary,
    border: `2px solid ${modernTheme.colors.primary}`,
    padding: "0.5rem 1rem",
    cursor: "pointer",
    fontFamily: "inherit",
    borderRadius: modernTheme.borderRadius.full,
    fontWeight: modernTheme.typography.fontWeight.medium
  },
  headerTitle: {
    margin: 0,
    background: modernTheme.gradients.primary,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text"
  },
  userEmail: {
    color: modernTheme.colors.textLight,
    fontSize: modernTheme.typography.fontSize.sm
  },
  successBanner: {
    backgroundColor: `${modernTheme.colors.success}20`,
    color: modernTheme.colors.success,
    padding: "1rem",
    textAlign: "center",
    fontWeight: modernTheme.typography.fontWeight.medium
  },
  errorBanner: {
    backgroundColor: `${modernTheme.colors.error}20`,
    color: modernTheme.colors.error,
    padding: "1rem",
    textAlign: "center",
    fontWeight: modernTheme.typography.fontWeight.medium,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "1rem"
  },
  dismissButton: {
    background: "none",
    border: "none",
    color: modernTheme.colors.error,
    fontSize: "1.5rem",
    cursor: "pointer",
    padding: "0 0.5rem"
  },
  main: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "2rem"
  },
  tokenBalanceSection: {
    marginBottom: "3rem"
  },
  tokenBalanceCard: {
    background: modernTheme.gradients.dark,
    borderRadius: modernTheme.borderRadius['2xl'],
    padding: "2rem",
    color: modernTheme.colors.textOnDark,
    boxShadow: modernTheme.shadows.xl
  },
  tokenBalanceHeader: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1.5rem"
  },
  tokenIcon: {
    padding: "0.5rem",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: modernTheme.borderRadius.lg
  },
  tokenBalanceTitle: {
    margin: 0,
    fontSize: modernTheme.typography.fontSize['2xl'],
    fontWeight: modernTheme.typography.fontWeight.bold
  },
  tokenBalanceSubtitle: {
    margin: 0,
    color: "rgba(255,255,255,0.7)",
    fontSize: modernTheme.typography.fontSize.sm
  },
  tokenBalanceMain: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.5rem",
    marginBottom: "1.5rem"
  },
  tokenBalanceNumber: {
    fontSize: "4rem",
    fontWeight: modernTheme.typography.fontWeight.bold,
    lineHeight: 1
  },
  tokenBalanceLabel: {
    fontSize: modernTheme.typography.fontSize.xl,
    color: "rgba(255,255,255,0.7)"
  },
  tokenBreakdown: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2rem",
    paddingTop: "1rem",
    borderTop: "1px solid rgba(255,255,255,0.2)"
  },
  tokenBreakdownItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem"
  },
  tokenBreakdownLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: modernTheme.typography.fontSize.sm
  },
  tokenBreakdownValue: {
    fontSize: modernTheme.typography.fontSize.lg,
    fontWeight: modernTheme.typography.fontWeight.semibold
  },
  lowTokensWarning: {
    display: "block",
    marginTop: "1.5rem",
    padding: "0.75rem 1rem",
    backgroundColor: `${modernTheme.colors.warning}30`,
    color: modernTheme.colors.warning,
    borderRadius: modernTheme.borderRadius.lg,
    textAlign: "center",
    textDecoration: "none",
    fontWeight: modernTheme.typography.fontWeight.medium
  },
  section: {
    marginBottom: "3rem"
  },
  sectionTitle: {
    fontSize: modernTheme.typography.fontSize['3xl'],
    fontWeight: modernTheme.typography.fontWeight.bold,
    marginBottom: "0.5rem"
  },
  sectionSubtitle: {
    color: modernTheme.colors.textLight,
    marginBottom: "2rem"
  },
  tokenPackagesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "1.5rem"
  },
  tokenPackageCard: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.xl,
    padding: "1.5rem",
    textAlign: "center",
    position: "relative"
  },
  popularCard: {
    border: `2px solid ${modernTheme.colors.primary}`,
    boxShadow: modernTheme.shadows.glow
  },
  popularBadge: {
    position: "absolute",
    top: "-12px",
    left: "50%",
    transform: "translateX(-50%)",
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    padding: "0.25rem 1rem",
    borderRadius: modernTheme.borderRadius.full,
    fontSize: modernTheme.typography.fontSize.xs,
    fontWeight: modernTheme.typography.fontWeight.bold
  },
  currentBadge: {
    position: "absolute",
    top: "-12px",
    right: "1rem",
    backgroundColor: modernTheme.colors.success,
    color: modernTheme.colors.textOnDark,
    padding: "0.25rem 0.75rem",
    borderRadius: modernTheme.borderRadius.full,
    fontSize: modernTheme.typography.fontSize.xs,
    fontWeight: modernTheme.typography.fontWeight.bold
  },
  packageName: {
    fontSize: modernTheme.typography.fontSize.xl,
    fontWeight: modernTheme.typography.fontWeight.bold,
    marginBottom: "0.5rem"
  },
  packagePrice: {
    marginBottom: "0.5rem"
  },
  priceAmount: {
    fontSize: modernTheme.typography.fontSize['3xl'],
    fontWeight: modernTheme.typography.fontWeight.bold,
    color: modernTheme.colors.primary
  },
  packageDescription: {
    color: modernTheme.colors.textLight,
    fontSize: modernTheme.typography.fontSize.sm,
    marginBottom: "1rem"
  },
  discountBadge: {
    display: "inline-block",
    backgroundColor: `${modernTheme.colors.success}20`,
    color: modernTheme.colors.success,
    padding: "0.25rem 0.75rem",
    borderRadius: modernTheme.borderRadius.full,
    fontSize: modernTheme.typography.fontSize.xs,
    fontWeight: modernTheme.typography.fontWeight.medium,
    marginBottom: "1rem"
  },
  purchaseButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.text,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.lg,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.semibold,
    transition: modernTheme.transitions.base
  },
  purchaseButtonPopular: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none"
  },
  billingToggle: {
    display: "flex",
    justifyContent: "center",
    gap: "0.5rem",
    marginBottom: "2rem",
    padding: "0.25rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    borderRadius: modernTheme.borderRadius.full,
    width: "fit-content",
    margin: "0 auto 2rem"
  },
  billingToggleButton: {
    padding: "0.5rem 1.5rem",
    backgroundColor: "transparent",
    color: modernTheme.colors.textLight,
    border: "none",
    borderRadius: modernTheme.borderRadius.full,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.medium,
    transition: modernTheme.transitions.base
  },
  billingToggleActive: {
    backgroundColor: modernTheme.colors.bgSecondary,
    color: modernTheme.colors.text,
    boxShadow: modernTheme.shadows.sm
  },
  plansGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "1.5rem"
  },
  planCard: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.xl,
    padding: "2rem",
    position: "relative"
  },
  popularPlanCard: {
    border: `2px solid ${modernTheme.colors.primary}`,
    boxShadow: modernTheme.shadows.glow
  },
  currentPlanCard: {
    borderColor: modernTheme.colors.success
  },
  planName: {
    fontSize: modernTheme.typography.fontSize['2xl'],
    fontWeight: modernTheme.typography.fontWeight.bold,
    marginBottom: "0.5rem"
  },
  planPrice: {
    marginBottom: "0.5rem"
  },
  planPriceAmount: {
    fontSize: modernTheme.typography.fontSize['4xl'],
    fontWeight: modernTheme.typography.fontWeight.bold
  },
  planPricePeriod: {
    color: modernTheme.colors.textLight,
    fontSize: modernTheme.typography.fontSize.base
  },
  planTokens: {
    color: modernTheme.colors.primary,
    fontWeight: modernTheme.typography.fontWeight.semibold,
    marginBottom: "1.5rem"
  },
  featuresList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 1.5rem 0"
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.75rem",
    fontSize: modernTheme.typography.fontSize.sm
  },
  upgradeButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.text,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.lg,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.semibold,
    transition: modernTheme.transitions.base
  },
  upgradeButtonPopular: {
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none"
  },
  manageButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: "transparent",
    color: modernTheme.colors.primary,
    border: `2px solid ${modernTheme.colors.primary}`,
    borderRadius: modernTheme.borderRadius.lg,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.semibold
  },
  disabledButton: {
    width: "100%",
    padding: "0.75rem",
    backgroundColor: modernTheme.colors.bgTertiary,
    color: modernTheme.colors.textLight,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.lg,
    cursor: "not-allowed",
    fontFamily: "inherit"
  },
  usageLink: {
    backgroundColor: modernTheme.colors.bgSecondary,
    border: `1px solid ${modernTheme.colors.border}`,
    borderRadius: modernTheme.borderRadius.xl,
    padding: "2rem",
    textAlign: "center"
  },
  viewUsageButton: {
    marginTop: "1rem",
    padding: "0.75rem 2rem",
    background: modernTheme.gradients.primary,
    color: modernTheme.colors.textOnDark,
    border: "none",
    borderRadius: modernTheme.borderRadius.full,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: modernTheme.typography.fontWeight.semibold
  }
};
