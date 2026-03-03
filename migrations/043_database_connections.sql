-- Migration 043: Database Connections (Dual-Mode: Direct + OAuth-Ready)
-- Supports both Supabase and Neon via direct connection strings
-- OAuth support ready for when Supabase partner approval is granted

-- 1. DATABASE CONNECTIONS (User's external databases)
CREATE TABLE IF NOT EXISTS database_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Provider & Method
    provider VARCHAR(50) NOT NULL,           -- 'supabase' | 'neon'
    connection_method VARCHAR(20) NOT NULL DEFAULT 'direct',  -- 'direct' | 'oauth'
    connection_name VARCHAR(255) NOT NULL,

    -- Direct Mode: Connection String (AES-256-GCM encrypted)
    connection_string_encrypted TEXT,

    -- OAuth Mode: Tokens (encrypted) - for future Supabase OAuth
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    oauth_expires_at TIMESTAMPTZ,
    oauth_scopes TEXT[],

    -- Shared: Encryption fields
    encryption_iv TEXT NOT NULL,
    encryption_salt TEXT NOT NULL,

    -- Metadata (display only, not sensitive - parsed from connection string)
    host VARCHAR(255),
    database_name VARCHAR(255),
    project_ref VARCHAR(255),                -- Supabase project ref (from OAuth or parsed)

    -- Linked EzCoder project (optional - multiple projects can share one DB connection)
    ezcoder_project_id VARCHAR(255),

    -- Status
    status VARCHAR(50) DEFAULT 'active',     -- active, failed, disconnected
    last_verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(user_id, connection_name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_database_connections_user_id ON database_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_database_connections_project_id ON database_connections(ezcoder_project_id);
CREATE INDEX IF NOT EXISTS idx_database_connections_status ON database_connections(status);

-- 2. Update schema_audit_log to reference new table (if exists)
-- Note: Original table referenced supabase_connections, update to database_connections
DO $$
BEGIN
    -- Check if schema_audit_log exists and has old foreign key
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'schema_audit_log_connection_id_fkey'
    ) THEN
        -- Drop old constraint and add new one
        ALTER TABLE schema_audit_log DROP CONSTRAINT schema_audit_log_connection_id_fkey;
        ALTER TABLE schema_audit_log
            ADD CONSTRAINT schema_audit_log_connection_id_fkey
            FOREIGN KEY (connection_id) REFERENCES database_connections(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Update schema_snapshots to reference new table (if exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'schema_snapshots_connection_id_fkey'
    ) THEN
        ALTER TABLE schema_snapshots DROP CONSTRAINT schema_snapshots_connection_id_fkey;
        ALTER TABLE schema_snapshots
            ADD CONSTRAINT schema_snapshots_connection_id_fkey
            FOREIGN KEY (connection_id) REFERENCES database_connections(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4. RLS Policies for database_connections
ALTER TABLE database_connections ENABLE ROW LEVEL SECURITY;

-- Users can only see their own connections
CREATE POLICY database_connections_select_own ON database_connections
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid()::text);

-- Users can only insert their own connections
CREATE POLICY database_connections_insert_own ON database_connections
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

-- Users can only update their own connections
CREATE POLICY database_connections_update_own ON database_connections
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

-- Users can only delete their own connections
CREATE POLICY database_connections_delete_own ON database_connections
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid()::text);

-- Service role bypass for admin operations
CREATE POLICY database_connections_service_role ON database_connections
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE database_connections IS 'User database connections supporting direct credentials (Supabase/Neon) and future OAuth';
COMMENT ON COLUMN database_connections.connection_method IS 'direct = connection string, oauth = Supabase Management API tokens';
COMMENT ON COLUMN database_connections.connection_string_encrypted IS 'AES-256-GCM encrypted PostgreSQL connection string for direct mode';
COMMENT ON COLUMN database_connections.oauth_scopes IS 'Granted OAuth scopes for oauth mode: database.read, database.write, etc.';
