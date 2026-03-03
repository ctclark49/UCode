// lib/services/AnalyticsService.js
// Analytics service with Supabase persistence for deployed site events

import { getSupabaseAdmin } from '../supabase.js';

class AnalyticsService {
  constructor() {
    this.events = []; // In-memory buffer for non-site events
    this.sessionId = null;
  }

  /**
   * Track an analytics event
   * Site events (from deployed projects) are persisted to database
   * Other events are kept in memory for debugging
   */
  async trackEvent(event) {
    const enrichedEvent = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
      sessionId: event.session_id || this.getSessionId()
    };

    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[Analytics]', event.type, event);
    }

    // Site events from deployed projects should be persisted
    if (event.type?.startsWith('site_') || this.isSiteEvent(event.type)) {
      await this.persistSiteEvent(enrichedEvent);
    } else {
      // Non-site events stored in memory only
      this.events.push(enrichedEvent);
    }
  }

  /**
   * Check if event type is a site event that should be persisted
   */
  isSiteEvent(type) {
    const siteEventTypes = [
      'page_view', 'page_exit', 'custom_event',
      'user_login', 'user_signup', 'user_logout', 'user_session',
      'form_submit', 'outbound_link_click'
    ];
    return siteEventTypes.includes(type);
  }

  /**
   * Persist site event to database
   */
  async persistSiteEvent(event) {
    try {
      const supabase = getSupabaseAdmin();
      if (!supabase) {
        console.warn('[Analytics] Supabase not available, event not persisted');
        this.events.push(event); // Fallback to in-memory
        return;
      }

      // Extract event type (remove 'site_' prefix if present)
      const eventType = event.type?.replace('site_', '') || 'unknown';

      // Build event record
      const eventRecord = {
        project_id: event.project_id,
        subdomain: event.metadata?.subdomain,
        event_type: eventType,
        event_name: event.metadata?.eventName || null,
        visitor_id: event.metadata?.visitorId || 'unknown',
        session_id: event.session_id,
        user_id: event.metadata?.userId || event.userId || null,
        user_email: event.metadata?.userEmail || event.userEmail || null,
        url: event.metadata?.url,
        pathname: event.metadata?.pathname,
        referrer: event.metadata?.referrer,
        user_agent: event.metadata?.userAgent,
        screen_resolution: event.metadata?.screenResolution,
        viewport: event.metadata?.viewport,
        ip_hash: event.metadata?.ip,
        time_on_page: event.metadata?.timeOnPage || event.metrics?.timeOnPage || null,
        metadata: event.metadata || {},
        created_at: event.timestamp
      };

      const { error } = await supabase
        .from('deployed_site_events')
        .insert(eventRecord);

      if (error) {
        console.error('[Analytics] Failed to persist event:', error);
        this.events.push(event); // Fallback to in-memory
      }

      // Also update deployed_site_users if this is a user event
      if (['user_login', 'user_signup', 'user_session'].includes(eventType)) {
        await this._upsertSiteUserInternal(supabase, event);
      }

    } catch (err) {
      console.error('[Analytics] Error persisting event:', err);
      this.events.push(event); // Fallback to in-memory
    }
  }

  /**
   * Upsert a deployed site user record (internal - called from persistSiteEvent)
   */
  async _upsertSiteUserInternal(supabase, event) {
    const userId = event.metadata?.userId || event.userId;
    const projectId = event.project_id;

    if (!userId || !projectId) return;

    try {
      const userRecord = {
        project_id: projectId,
        external_user_id: userId,
        email: event.metadata?.userEmail || event.userEmail || null,
        auth_provider: event.metadata?.provider || null,
        last_seen: new Date().toISOString()
      };

      const { error } = await supabase
        .from('deployed_site_users')
        .upsert(userRecord, {
          onConflict: 'project_id,external_user_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('[Analytics] Failed to upsert site user:', error);
      }
    } catch (err) {
      console.error('[Analytics] Error upserting site user:', err);
    }
  }

  /**
   * Upsert a deployed site user record (public API)
   * Called directly from collect.js for user events
   */
  async upsertSiteUser(userData) {
    const { project_id, external_user_id, email, auth_provider, name, is_signup } = userData;

    if (!external_user_id || !project_id) return;

    try {
      const supabase = getSupabaseAdmin();
      if (!supabase) {
        console.warn('[Analytics] Supabase not available for user upsert');
        return;
      }

      const userRecord = {
        project_id,
        external_user_id,
        email: email || null,
        name: name || null,
        auth_provider: auth_provider || 'email',
        last_seen: new Date().toISOString()
      };

      // For signups, also set first_seen
      if (is_signup) {
        userRecord.first_seen = new Date().toISOString();
      }

      const { error } = await supabase
        .from('deployed_site_users')
        .upsert(userRecord, {
          onConflict: 'project_id,external_user_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('[Analytics] Failed to upsert site user:', error);
      }

      // Update session/pageview counts
      if (!is_signup) {
        await this._incrementUserStats(supabase, project_id, external_user_id);
      }

    } catch (err) {
      console.error('[Analytics] Error upserting site user:', err);
    }
  }

  /**
   * Increment user session/pageview stats
   */
  async _incrementUserStats(supabase, projectId, externalUserId) {
    try {
      // Increment total_sessions
      await supabase.rpc('increment_user_sessions', {
        p_project_id: projectId,
        p_external_user_id: externalUserId
      });
    } catch (err) {
      // RPC might not exist yet, that's okay
    }
  }

  /**
   * Track an error event
   */
  async trackError(error) {
    await this.trackEvent({
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        ...error
      }
    });
  }

  /**
   * Track preview metrics
   */
  async trackPreviewMetrics(projectId, metrics) {
    await this.trackEvent({
      type: 'preview_metrics',
      project_id: projectId,
      metrics
    });
  }

  /**
   * Get or create session ID
   */
  getSessionId() {
    if (!this.sessionId) {
      this.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
    return this.sessionId;
  }

  /**
   * Get recent in-memory events (for debugging)
   */
  getRecentEvents(limit = 100) {
    return this.events.slice(-limit);
  }

  /**
   * Clear in-memory events
   */
  clearEvents() {
    this.events = [];
  }

  /**
   * Get analytics data for a project
   */
  async getProjectAnalytics(projectId, options = {}) {
    const { timeRange = '7d', limit = 1000 } = options;

    try {
      const supabase = getSupabaseAdmin();
      if (!supabase) return null;

      // Calculate date range
      const now = new Date();
      const startDate = new Date(now);
      switch (timeRange) {
        case '1h': startDate.setHours(now.getHours() - 1); break;
        case '24h': startDate.setDate(now.getDate() - 1); break;
        case '7d': startDate.setDate(now.getDate() - 7); break;
        case '30d': startDate.setDate(now.getDate() - 30); break;
        case '90d': startDate.setDate(now.getDate() - 90); break;
        default: startDate.setDate(now.getDate() - 7);
      }

      // Fetch events
      const { data: events, error: eventsError } = await supabase
        .from('deployed_site_events')
        .select('*')
        .eq('project_id', projectId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit);

      if (eventsError) {
        console.error('[Analytics] Error fetching events:', eventsError);
        return null;
      }

      // Fetch registered users
      const { data: users, error: usersError } = await supabase
        .from('deployed_site_users')
        .select('*')
        .eq('project_id', projectId)
        .order('last_seen', { ascending: false })
        .limit(100);

      if (usersError) {
        console.error('[Analytics] Error fetching users:', usersError);
      }

      // Calculate metrics
      const pageViews = events?.filter(e => e.event_type === 'page_view') || [];
      const uniqueVisitors = new Set(events?.map(e => e.visitor_id) || []).size;
      const uniqueSessions = new Set(events?.map(e => e.session_id) || []).size;
      const registeredUsers = users?.length || 0;

      // Calculate time on site
      const exitEvents = events?.filter(e => e.event_type === 'page_exit') || [];
      const totalTimeOnSite = exitEvents.reduce((sum, e) => sum + (e.time_on_page || 0), 0);

      return {
        summary: {
          totalPageViews: pageViews.length,
          uniqueVisitors,
          uniqueSessions,
          registeredUsers,
          totalTimeOnSite,
          avgTimePerSession: uniqueSessions > 0 ? Math.round(totalTimeOnSite / uniqueSessions) : 0
        },
        events: events || [],
        users: users || [],
        timeRange
      };

    } catch (err) {
      console.error('[Analytics] Error getting project analytics:', err);
      return null;
    }
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
