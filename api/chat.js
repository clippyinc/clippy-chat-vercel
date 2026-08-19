-- Clippy OS Permanent Memory - Organized via Make
-- Enable pgvector for documents
create extension if not exists vector;

-- 1. Memories (general knowledge)
create table memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  type text default 'general',
  business_id text,
  source text default 'manual',
  created_at timestamptz default now()
);

-- 2. Goals
create table goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text default 'active',
  business_id text,
  created_at timestamptz default now()
);

-- 3. Schedules (from Calendar via Make)
create table schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_time timestamptz,
  end_time timestamptz,
  source text default 'make',
  created_at timestamptz default now()
);

-- 4. Tasks (from Gmail / Make)
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text default 'pending',
  priority text default 'medium',
  business_id text,
  source text default 'make',
  created_at timestamptz default now()
);

-- 5. Financial Records (from Xero/Sheets via Make)
create table financial_records (
  id uuid primary key default gen_random_uuid(),
  business_id text,
  amount numeric,
  type text,
  description text,
  source text default 'make',
  created_at timestamptz default now()
);

-- 6. Business Data (Shopify, sales via Make)
create table business_data (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  metric text not null,
  value jsonb,
  date date default current_date,
  source text default 'make',
  created_at timestamptz default now()
);

-- 7. Documents (from + button)
create table documents (
  id uuid primary key default gen_random_uuid(),
  filename text,
  content text,
  business_id text,
  source text default 'manual',
  created_at timestamptz default now()
);

-- 8. Notifications (Make → Clippy overlay)
create table notifications (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  message text not null,
  business_id text,
  priority text default 'medium',
  read boolean default false,
  created_at timestamptz default now()
);

-- Enable RLS but allow anon (for now, we secure later)
alter table memories enable row level security;
alter table goals enable row level security;
alter table schedules enable row level security;
alter table tasks enable row level security;
alter table financial_records enable row level security;
alter table business_data enable row level security;
alter table documents enable row level security;
alter table notifications enable row level security;

create policy "allow all for anon" on memories for all using (true) with check (true);
create policy "allow all for anon" on goals for all using (true) with check (true);
create policy "allow all for anon" on schedules for all using (true) with check (true);
create policy "allow all for anon" on tasks for all using (true) with check (true);
create policy "allow all for anon" on financial_records for all using (true) with check (true);
create policy "allow all for anon" on business_data for all using (true) with check (true);
create policy "allow all for anon" on documents for all using (true) with check (true);
create policy "allow all for anon" on notifications for all using (true) with check (true);
