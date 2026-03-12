-- ============================================================
-- Migration: Add status TEXT column to attendance table
-- Also adds working_hours FLOAT if not already present.
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Add working_hours column (safe, no-op if already exists)
ALTER TABLE public.attendance
    ADD COLUMN IF NOT EXISTS working_hours FLOAT;

-- Add status column
ALTER TABLE public.attendance
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ON_TIME'
        CHECK (status IN ('ON_TIME', 'LATE'));

-- Back-fill existing records (no check_in time = unknown → ON_TIME default)
-- Back-fill working_hours for records that have both timestamps
UPDATE public.attendance
SET working_hours = EXTRACT(EPOCH FROM (check_out - check_in)) / 3600.0
WHERE check_in IS NOT NULL
  AND check_out IS NOT NULL
  AND working_hours IS NULL;

-- Verify
SELECT id, date, check_in, check_out, working_hours, status
FROM public.attendance
ORDER BY created_at DESC
LIMIT 10;
