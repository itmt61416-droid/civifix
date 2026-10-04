-- Private photo storage for CiviFix report evidence.
-- Run once in Supabase Dashboard > SQL Editor after schema.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('civifix-reports', 'civifix-reports', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Reporters upload their own report photos" on storage.objects;
create policy "Reporters upload their own report photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'civifix-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Reporters and assigned staff read report photos" on storage.objects;
create policy "Reporters and assigned staff read report photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'civifix-reports'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.reports r
        where r.photo_path = storage.objects.name
        and (
          r.reporter_id = (select auth.uid())
          or public.civifix_role() = 'senior_officer'
          or (public.civifix_role() = 'supervisor' and r.ward_id = public.civifix_ward_id())
        )
      )
    )
  );

drop policy if exists "Reporters can remove their own report photos" on storage.objects;
create policy "Reporters can remove their own report photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'civifix-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
