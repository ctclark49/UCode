-- Migration 045: Deployed Site Analytics & User Tracking
-- Comprehensive analytics for deployed sites with both anonymous and authenticated user tracking

-- ============================================================================
-- 1. DEPLOYED SITE EVENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS deployed_site_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id VARCHAR(255) NOT NULL,
    subdomain TEXT,

    -- Event type
    event_type TEXT NOT NULL,  -- page_view, page_exit, custom_event, user_login, user_signup, user_logout, user_session
    event_name TEXT,           -- For custom events

    -- Visitor tracking (anonymous)
    visitor_id TEXT NOT NULL,
    session_id TEXT,

    -- User tracking (authenticated)
    user_id TEXT,              -- From customer's Supabase auth
    user_email TEXT,

    -- Page info
    url TEXT,
    pathname TEXT,
    referrer TEXT,

    -- Device info
    user_agent TEXT,
    screen_resolution TEXT,
    viewport TEXT,
    ip_hash TEXT,

    -- Metrics
    time_on_page INTEGER,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_site_events_project ON deployed_site_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_visitor ON deployed_site_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_site_events_user ON deployed_site_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_events_type ON deployed_site_events(event_type);
CREATE INDEX IF NOT EXISTS idx_site_events_subdomain ON deployed_site_events(subdomain);
CREATE INDEX IF NOT EXISTS idx_site_events_date ON deployed_site_events(DATE(created_at), project_id);

-- ============================================================================
-- 2. DEPLOYED SITE USERS TABLE (Registered users on customer sites)
-- ============================================================================
CREATE TABLE IF NOT EXISTS deployed_site_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id VARCHAR(255) NOT NULL,

    -- User identity (from customer's Supabase auth)
    external_user_id TEXT NOT NULL,
    email TEXT,
    name TEXT,

    -- Auth metadata
    auth_provider TEXT,        -- google, github, email

    -- Stats
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    total_sessions INTEGER DEFAULT 1,
    total_page_views INTEGER DEFAULT 0,

    -- Additional metadata
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_deployed_users_project ON deployed_site_users(project_id);
CREATE INDEX IF NOT EXISTS idx_deployed_users_email ON deployed_site_users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deployed_users_last_seen ON deployed_site_users(last_seen DESC);

-- ============================================================================
-- 3. DAILY AGGREGATES TABLE (For fast dashboard queries)
-- ============================================================================
CREATE TABLE IF NOT EXISTS deployed_site_daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id VARCHAR(255) NOT NULL,
    date DATE NOT NULL,

    -- Visitor metrics
    total_page_views INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    unique_sessions INTEGER DEFAULT 0,

    -- User metrics
    registered_user_views INTEGER DEFAULT 0,
    new_signups INTEGER DEFAULT 0,
    logins INTEGER DEFAULT 0,

    -- Engagement metrics
    total_time_on_site INTEGER DEFAULT 0,  -- seconds
    avg_time_per_session DECIMAL(10,2),

    -- Top pages (stored as JSONB for flexibility)
    top_pages JSONB DEFAULT '[]',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_project ON deployed_site_daily_stats(project_id, date DESC);

-- ============================================================================
-- 4. RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE deployed_site_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployed_site_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployed_site_daily_stats ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for analytics collection from deployed sites)
CREATE POLICY deployed_site_events_service_role ON deployed_site_events
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY deployed_site_users_service_role ON deployed_site_users
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY deployed_site_daily_stats_service_role ON deployed_site_daily_stats
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Users can view analytics for their own projects
-- (requires join to projects table to verify ownership)
CREATE POLICY deployed_site_events_select_own ON deployed_site_events
    FOR SELECT TO authenticated
    USING (
        project_id IN (
            SELECT id::text FROM projects WHERE user_id = auth.uid()::text
        )
    );

CREATE POLICY deployed_site_users_select_own ON deployed_site_users
    FOR SELECT TO authenticated
    USING (
        project_id IN (
            SELECT id::text FROM projects WHERE user_id = auth.uid()::text
        )
    );

CREATE POLICY deployed_site_daily_stats_select_own ON deployed_site_daily_stats
    FOR SELECT TO authenticated
    USING (
        project_id IN (
            SELECT id::text FROM projects WHERE user_id = auth.uid()::text
        )
    );

-- ============================================================================
-- 5. HELPER FUNCTION: Aggregate Daily Stats (for cron job)
-- ============================================================================
CREATE OR REPLACE FUNCTION aggregate_daily_site_stats(p_date DATE DEFAULT CURRENT_DATE - INTERVAL '1 day')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
    v_project RECORD;
BEGIN
    -- Get all projects with events on this date
    FOR v_project IN (
        SELECT DISTINCT project_id
        FROM deployed_site_events
        WHERE DATE(created_at) = p_date
    ) LOOP
        -- Upsert daily stats for this project
        INSERT INTO deployed_site_daily_stats (
            project_id,
            date,
            total_page_views,
            unique_visitors,
            unique_sessions,
            registered_user_views,
            new_signups,
            logins,
            total_time_on_site
        )
        SELECT
            v_project.project_id,
            p_date,
            COUNT(*) FILTER (WHERE event_type = 'page_view'),
            COUNT(DISTINCT visitor_id),
            COUNT(DISTINCT session_id),
            COUNT(*) FILTER (WHERE event_type = 'page_view' AND user_id IS NOT NULL),
            COUNT(*) FILTER (WHERE event_type = 'user_signup'),
            COUNT(*) FILTER (WHERE event_type = 'user_login'),
            COALESCE(SUM(time_on_page) FILTER (WHERE event_type = 'page_exit'), 0)
        FROM deployed_site_events
        WHERE project_id = v_project.project_id
          AND DATE(created_at) = p_date
        ON CONFLICT (project_id, date) DO UPDATE SET
            total_page_views = EXCLUDED.total_page_views,
            unique_visitors = EXCLUDED.unique_visitors,
            unique_sessions = EXCLUDED.unique_sessions,
            registered_user_views = EXCLUDED.registered_user_views,
            new_signups = EXCLUDED.new_signups,
            logins = EXCLUDED.logins,
            total_time_on_site = EXCLUDED.total_time_on_site,
            updated_at = NOW();

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- ============================================================================
-- 6. COMMENTS
-- ============================================================================
COMMENT ON TABLE deployed_site_events IS 'Raw event stream from deployed EzCoder sites. Includes page views, custom events, and auth events.';
COMMENT ON TABLE deployed_site_users IS 'Registered users on deployed customer sites. Tracked via auth hooks when customer connects Supabase.';
COMMENT ON TABLE deployed_site_daily_stats IS 'Pre-aggregated daily statistics for fast dashboard queries.';
COMMENT ON FUNCTION aggregate_daily_site_stats IS 'Aggregates raw events into daily stats. Run via cron job daily.';
