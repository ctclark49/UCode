// pages/api/analytics/collect.js
import { analyticsService } from '../../../lib/services/AnalyticsService';
import { loggingService } from '../../../lib/services/LoggingService';

// User event types that need special handling
const USER_EVENT_TYPES = ['user_login', 'user_signup', 'user_logout', 'user_session'];

export default async function handler(req, res) {
  // Enable CORS for deployed sites
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      type,
      projectId,
      subdomain,
      sessionId,
      visitorId,
      userId,
      userEmail,
      url,
      pathname,
      referrer,
      userAgent,
      screenResolution,
      viewport,
      timeOnPage,
      eventName,
      metadata,
      timestamp,
      isReturning
    } = req.body;

    // Validate required fields
    if (!type || !projectId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get client IP
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Prepare analytics event
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: `site_${type}`, // Prefix with site_ to distinguish from platform events
      project_id: projectId,
      session_id: sessionId,
      timestamp: timestamp || new Date().toISOString(),
      metadata: {
        subdomain,
        visitorId,
        userId: userId || null,
        userEmail: userEmail || null,
        url,
        pathname,
        referrer,
        userAgent,
        screenResolution,
        viewport,
        timeOnPage,
        eventName,
        ip: hashIP(ip), // Hash IP for privacy
        isReturning: isReturning || false,
        ...metadata
      },
      metrics: {
        timeOnPage: timeOnPage || 0
      }
    };

    // Track the event (AnalyticsService now persists to database)
    await analyticsService.trackEvent(event);

    // Handle user-specific events (login, signup, logout, session)
    if (USER_EVENT_TYPES.includes(type) && userId) {
      await handleUserEvent(type, projectId, userId, userEmail, metadata);
    }

    // Log high-level activity
    if (type === 'page_view') {
      await loggingService.info('Site page view', {
        projectId,
        subdomain,
        pathname,
        type: 'site_analytics',
        hasUser: !!userId
      });
    } else if (type === 'user_signup') {
      await loggingService.info('New user signup on deployed site', {
        projectId,
        subdomain,
        type: 'site_user_signup'
      });
    } else if (type === 'user_login') {
      await loggingService.info('User login on deployed site', {
        projectId,
        subdomain,
        type: 'site_user_login'
      });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Analytics collection error:', error);
    return res.status(500).json({
      error: 'Failed to track analytics',
      message: error.message
    });
  }
}

// Handle user events - upsert to deployed_site_users table
async function handleUserEvent(type, projectId, userId, userEmail, metadata) {
  try {
    // Use AnalyticsService's upsertSiteUser method
    if (type === 'user_login' || type === 'user_signup' || type === 'user_session') {
      await analyticsService.upsertSiteUser({
        project_id: projectId,
        external_user_id: userId,
        email: userEmail,
        auth_provider: metadata?.provider || 'email',
        name: metadata?.name || null,
        is_signup: type === 'user_signup'
      });
    }
  } catch (error) {
    console.error('[Analytics] Error handling user event:', error);
    // Don't throw - we don't want to fail the request for this
  }
}

// Hash IP for privacy
function hashIP(ip) {
  if (!ip) return 'unknown';
  
  // Simple hash for privacy (in production, use proper hashing)
  const parts = ip.split('.');
  if (parts.length === 4) {
    // Keep first two octets, hash last two
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
  }
  return 'hashed';
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};