-- CiviFix starter schema for Supabase
-- Run this in Supabase Dashboard > SQL Editor for the civifix-dev project.
-- This creates the data model and role-aware row policies. It does not configure photo storage.

create extension if not exists pgcrypto;

create table if not exists public.wards (
  id uuid primary key default gen_random_uuid(),
  ward_code text not null unique,
  name text not null,
  city text not null default 'Demo City',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'citizen' check (role in ('citizen', 'supervisor', 'senior_officer')),
  ward_id uuid references public.wards(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  title text not null check (char_length(title) between 3 and 120),
  category text not null check (category in ('Road & pothole', 'Garbage', 'Drainage', 'Streetlight', 'Water leakage', 'Other')),
  description text not null check (char_length(description) between 5 and 2000),
  location_label text not null,
  latitude double precision,
  longitude double precision,
  ward_id uuid references public.wards(id) on delete set null,
  department text not null default 'Needs manual routing',
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'accepted', 'in_progress', 'resolved', 'rejected', 'duplicate')),
  photo_path text,
  reporter_id uuid not null references auth.users(id) on delete restrict,
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint reports_longitude_range check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.report_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text check (old_status is null or old_status in ('submitted', 'under_review', 'accepted', 'in_progress', 'resolved', 'rejected', 'duplicate')),
  new_status text check (new_status is null or new_status in ('submitted', 'under_review', 'accepted', 'in_progress', 'resolved', 'rejected', 'duplicate')),
  note text not null check (char_length(note) between 1 and 1000),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists reports_ward_status_idx on public.reports (ward_id, status);
create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists report_updates_report_created_idx on public.report_updates (report_id, created_at desc);

-- A profile is created with the safe default role after signup. Ward/role assignment
-- for staff must be performed by a trusted project administrator.
create or replace function public.create_civifix_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'citizen')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_civifix on auth.users;
create trigger on_auth_user_created_civifix
  after insert on auth.users
  for each row execute function public.create_civifix_profile();

-- Helper functions avoid repeating profile lookups in each policy. They only return
-- the signed-in user's own role and ward.
create or replace function public.civifix_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function public.civifix_ward_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.ward_id from public.profiles p where p.id = (select auth.uid())
$$;

alter table public.wards enable row level security;
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.report_updates enable row level security;

drop policy if exists "Signed-in users can view wards" on public.wards;
create policy "Signed-in users can view wards"
  on public.wards for select to authenticated using (true);

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Citizens and staff can view allowed reports" on public.reports;
create policy "Citizens and staff can view allowed reports"
  on public.reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or public.civifix_role() = 'senior_officer'
    or (public.civifix_role() = 'supervisor' and ward_id = public.civifix_ward_id())
  );

drop policy if exists "Signed-in users can submit as themselves" on public.reports;
create policy "Signed-in users can submit as themselves"
  on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'submitted');

drop policy if exists "Assigned staff can update reports" on public.reports;
create policy "Assigned staff can update reports"
  on public.reports for update to authenticated
  using (
    public.civifix_role() = 'senior_officer'
    or (public.civifix_role() = 'supervisor' and ward_id = public.civifix_ward_id())
  )
  with check (
    public.civifix_role() = 'senior_officer'
    or (public.civifix_role() = 'supervisor' and ward_id = public.civifix_ward_id())
  );

drop policy if exists "Users can view related public report updates" on public.report_updates;
create policy "Users can view related public report updates"
  on public.report_updates for select to authenticated
  using (
    (is_public and exists (
      select 1 from public.reports r
      where r.id = report_updates.report_id
      and (
        r.reporter_id = (select auth.uid())
        or public.civifix_role() = 'senior_officer'
        or (public.civifix_role() = 'supervisor' and r.ward_id = public.civifix_ward_id())
      )
    ))
    or (not is_public and actor_id = (select auth.uid()))
  );

drop policy if exists "Assigned staff can add report updates" on public.report_updates;
create policy "Assigned staff can add report updates"
  on public.report_updates for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and exists (
      select 1 from public.reports r
      where r.id = report_updates.report_id
      and (
        public.civifix_role() = 'senior_officer'
        or (public.civifix_role() = 'supervisor' and r.ward_id = public.civifix_ward_id())
      )
    )
  );

-- One demo ward to get the schema started. Replace with verified ward records/boundaries.
insert into public.wards (ward_code, name, city)
values ('14', 'Green Park', 'Demo City')
on conflict (ward_code) do nothing;
