-- Access Logs Table
-- Run this if the access_logs table does not yet exist in your Supabase project

CREATE TABLE IF NOT EXISTS access_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'failed'
                    CHECK (status IN ('success', 'failed', 'ambiguous', 'warning')),
    confidence  FLOAT,
    device_id   TEXT DEFAULT 'terminal_01',
    method      TEXT DEFAULT 'face'
                    CHECK (method IN ('face', 'fingerprint', 'rfid', 'manual')),
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for dashboard stats queries (date range scans)
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs (created_at DESC);

-- Index for per-employee log queries
CREATE INDEX IF NOT EXISTS idx_access_logs_employee_id ON access_logs (employee_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_access_logs_status ON access_logs (status);
