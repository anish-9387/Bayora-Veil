export const schema = `
CREATE TABLE IF NOT EXISTS tenants (id UUID PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO tenants VALUES ('00000000-0000-4000-8000-000000000001', 'Local demonstration') ON CONFLICT DO NOTHING;
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'red', 'blue', 'auditor', 'orchestrator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'COMMITTED', 'RUNNING', 'EVALUATED', 'CLOSED', 'VERIFIED')),
    policy_version VARCHAR(100) NOT NULL,
    model_adapter VARCHAR(100) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    config JSONB
);

-- Payload commitments table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES tenants(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(lower(email));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES tenants(id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS timeout_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_leases (id UUID PRIMARY KEY, tenant_id UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS request_metrics (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id UUID NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS request_metrics_tenant_time ON request_metrics(tenant_id, created_at);
CREATE TABLE IF NOT EXISTS evidence_access (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id UUID NOT NULL, run_id UUID NOT NULL, phase TEXT NOT NULL, granted BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS payload_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    commitment_hash VARCHAR(71) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reveal_after_close BOOLEAN NOT NULL DEFAULT TRUE,
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    revealed_at TIMESTAMPTZ
);

-- Observations table (sanitized, released data)
CREATE TABLE IF NOT EXISTS observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    case_id VARCHAR(100) NOT NULL,
    outcome VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    category VARCHAR(50) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence_digest VARCHAR(71) NOT NULL,
    released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_after_phase VARCHAR(50) NOT NULL
);

-- Evidence artifacts table (raw, restricted data)
CREATE TABLE IF NOT EXISTS evidence_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    artifact_type VARCHAR(50) NOT NULL CHECK (artifact_type IN ('prompt', 'response', 'defense_rule', 'stack_trace', 'tool_trace', 'timing', 'other')),
    storage_key VARCHAR(255) NOT NULL,
    digest VARCHAR(71) NOT NULL,
    access_class VARCHAR(20) NOT NULL CHECK (access_class IN ('public', 'red_private', 'blue_private', 'target_private', 'auditor_only', 'raw_evidence')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit events table (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    actor VARCHAR(50) NOT NULL,
    payload_digest VARCHAR(71) NOT NULL,
    previous_event_hash VARCHAR(71) NOT NULL,
    event_hash VARCHAR(71) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, sequence)
);

-- Run manifests table
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS canonical_payload TEXT;
CREATE TABLE IF NOT EXISTS run_manifests (
    run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    merkle_root VARCHAR(71) NOT NULL,
    final_chain_hash VARCHAR(71) NOT NULL,
    signature VARCHAR(128) NOT NULL,
    public_key_id VARCHAR(100) NOT NULL,
    event_count BIGINT NOT NULL DEFAULT 0,
    policy_version VARCHAR(100) NOT NULL,
    model_adapter VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Experiments table
ALTER TABLE run_manifests ADD COLUMN IF NOT EXISTS dataset_version TEXT;
ALTER TABLE run_manifests ADD COLUMN IF NOT EXISTS model_version TEXT;
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('blind_classification', 'timing_leakage', 'cross_tenant_access')),
    config JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Experiment results table
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES tenants(id);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES runs(id);
CREATE TABLE IF NOT EXISTS experiment_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(10,4) NOT NULL,
    sample_count BIGINT NOT NULL,
    method VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade existing tables: sha256: plus 64 hex characters requires 71 characters.
ALTER TABLE payload_commitments ALTER COLUMN commitment_hash TYPE VARCHAR(71);
ALTER TABLE observations ALTER COLUMN evidence_digest TYPE VARCHAR(71);
ALTER TABLE evidence_artifacts ALTER COLUMN digest TYPE VARCHAR(71);
ALTER TABLE audit_events
    ALTER COLUMN payload_digest TYPE VARCHAR(71),
    ALTER COLUMN previous_event_hash TYPE VARCHAR(71),
    ALTER COLUMN event_hash TYPE VARCHAR(71);
ALTER TABLE run_manifests
    ALTER COLUMN merkle_root TYPE VARCHAR(71),
    ALTER COLUMN final_chain_hash TYPE VARCHAR(71);

ALTER TABLE evidence_artifacts ADD COLUMN IF NOT EXISTS content JSONB;
CREATE TABLE IF NOT EXISTS access_denials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID,
    actor VARCHAR(50) NOT NULL,
    route TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
ALTER TABLE access_denials ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE INDEX IF NOT EXISTS access_denials_tenant ON access_denials(tenant_id);
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
DROP TRIGGER IF EXISTS run_manifests_immutable ON run_manifests;
CREATE TRIGGER run_manifests_immutable BEFORE UPDATE OR DELETE ON run_manifests FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE OR REPLACE FUNCTION protect_closed_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM runs WHERE id = COALESCE(NEW.run_id, OLD.run_id) AND status IN ('CLOSED', 'VERIFIED')) THEN
    RAISE EXCEPTION 'Closed artifacts are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS evidence_frozen ON evidence_artifacts;
CREATE TRIGGER evidence_frozen BEFORE INSERT OR UPDATE OR DELETE ON evidence_artifacts FOR EACH ROW EXECUTE FUNCTION protect_closed_artifact();
DROP TRIGGER IF EXISTS observations_frozen ON observations;
CREATE TRIGGER observations_frozen BEFORE INSERT OR UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION protect_closed_artifact();
DROP TRIGGER IF EXISTS commitments_frozen ON payload_commitments;
CREATE TRIGGER commitments_frozen BEFORE INSERT OR UPDATE OR DELETE ON payload_commitments FOR EACH ROW EXECUTE FUNCTION protect_closed_artifact();
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created_by ON runs(created_by);
CREATE INDEX IF NOT EXISTS idx_payload_commitments_run_id ON payload_commitments(run_id);
CREATE INDEX IF NOT EXISTS idx_observations_run_id ON observations(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_run_id ON evidence_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_artifacts_access_class ON evidence_artifacts(access_class);
CREATE INDEX IF NOT EXISTS idx_audit_events_run_id ON audit_events(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_sequence ON audit_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiment_results_experiment_id ON experiment_results(experiment_id);
`;

export const seedData = `
-- Insert demo users
INSERT INTO users (id, display_name, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Red Team Operator', 'red'),
    ('22222222-2222-2222-2222-222222222222', 'Blue Team Operator', 'blue'),
    ('33333333-3333-3333-3333-333333333333', 'Auditor', 'auditor'),
    ('44444444-4444-4444-4444-444444444444', 'Orchestrator', 'orchestrator')
ON CONFLICT (id) DO NOTHING;
`;
