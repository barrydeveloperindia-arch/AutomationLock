-- SQL Migration Script for Smart Lock Terminal
-- Run this in your Supabase SQL Editor

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Disabled', 'Deleted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Attendance Table
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in TIMESTAMP WITH TIME ZONE NOT NULL,
    check_out TIMESTAMP WITH TIME ZONE,
    status TEXT CHECK (status IN ('ON_TIME', 'LATE')),
    method TEXT,
    device_id TEXT,
    working_hours NUMERIC
);

-- 3. Access Logs Table (Granular Audit)
CREATE TABLE IF NOT EXISTS public.access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT REFERENCES public.employees(employee_id) ON DELETE SET NULL,
    status TEXT NOT NULL, -- success, denied, warning
    method TEXT, -- face, fingerprint, rfid
    device_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable Realtime for Employees
ALTER PUBLICATION supabase_realtime ADD TABLE public.employees;

-- 5. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(date);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON public.access_logs(created_at);
