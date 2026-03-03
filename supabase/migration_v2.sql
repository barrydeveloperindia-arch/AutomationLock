-- migration_v2.sql: Production-Ready Database Schema for Smart Door Lock

-- 1. EXTENSIONS
create extension if not exists vector;

-- 2. DEDUPLICATION STRATEGY (SAFE CLEANUP)
-- Identifies duplicate employee_id and keeps the one with the most recent created_at
with duplicates as (
    select id, employee_id,
           row_number() over (partition by employee_id order by created_at desc) as rn
    from public.employees
)
delete from public.employees
where id in (select id from duplicates where rn > 1);

-- 3. SCHEMA EVOLUTION (EMPLOYEES)
alter table public.employees 
add column if not exists status text default 'Active' check (status in ('Active', 'Disabled', 'Deleted')),
add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now());

-- Add strict unique constraint on name to prevent display confusion
alter table public.employees add constraint unique_employee_name unique (name);

-- 4. NORMALIZED BIOMETRICS TABLES
-- Face Encodings
create table if not exists public.face_encodings (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null references public.employees(employee_id) on delete cascade,
    embedding vector(128) not null,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(employee_id) -- Move to 1:1 for now as per requirement, remove unique for 1:N
);

-- Fingerprints
create table if not exists public.fingerprints (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null references public.employees(employee_id) on delete cascade,
    finger_index int check (finger_index >= 0 and finger_index <= 9),
    template_data text not null, -- Sensor specific format
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RFID Tags
create table if not exists public.rfid_tags (
    tag_id text primary key,
    employee_id text not null references public.employees(employee_id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. DATA MIGRATION (Move face embeddings to dedicated table)
insert into public.face_encodings (employee_id, embedding)
select employee_id, face_embedding from public.employees
where face_embedding is not null
on conflict (employee_id) do nothing;

-- Clean up old column from employees (Optional, but cleaner)
-- alter table public.employees drop column face_embedding;

-- 6. AUTOMATION (Updated At)
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger update_employees_updated_at
    before update on public.employees
    for each row
    execute function update_updated_at_column();

-- 7. SOFT-DELETE & PURGE LOGIC
create or replace function purge_biometrics_on_delete()
returns trigger as $$
begin
    if new.status = 'Deleted' then
        -- Clear face embeddings
        update public.face_encodings set embedding = null where employee_id = new.employee_id;
        -- Clear other biometrics
        delete from public.fingerprints where employee_id = new.employee_id;
        delete from public.rfid_tags where employee_id = new.employee_id;
        -- Clear old column if it still exists
        new.face_embedding = null;
        new.image_url = null;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger tr_purge_biometrics
    before update on public.employees
    for each row
    when (new.status = 'Deleted' and old.status <> 'Deleted')
    execute function purge_biometrics_on_delete();

-- 8. PERFORMANCE INDEXES
create index if not exists idx_employees_active_not_deleted on public.employees (status, is_deleted);
create index if not exists idx_face_embedding_cosine on public.face_encodings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_logs_created_at on public.access_logs (created_at desc);

-- 8. SECURITY (RLS Policies for new tables)
alter table public.face_encodings enable row level security;
alter table public.fingerprints enable row level security;
alter table public.rfid_tags enable row level security;

create policy "Allow internal access to biometrics" on public.face_encodings using (true);
create policy "Allow internal access to fingerprints" on public.fingerprints using (true);
create policy "Allow internal access to rfid" on public.rfid_tags using (true);
