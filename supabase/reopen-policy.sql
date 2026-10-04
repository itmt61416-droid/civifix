-- Permit a citizen to request a recheck of their own resolved report without
-- letting them change its status. Run once in Supabase SQL Editor.

alter table public.report_updates
  add column if not exists is_reopen_request boolean not null default false;

drop policy if exists "Reporters can request a recheck of their resolved report" on public.report_updates;
create policy "Reporters can request a recheck of their resolved report"
  on public.report_updates for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and is_reopen_request = true
    and old_status = 'resolved'
    and new_status is null
    and exists (
      select 1 from public.reports r
      where r.id = report_updates.report_id
        and r.reporter_id = (select auth.uid())
        and r.status = 'resolved'
    )
  );
