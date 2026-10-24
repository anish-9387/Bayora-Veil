export const schema = `
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
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('blind_classification', 'timing_leakage', 'cross_tenant_access')),
    config JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Experiment results table
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

-- Indexes for performance
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
