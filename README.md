# drms-portal
Digital Results Management System-Results Portal

## Supabase Storage setup

The administrator upload uses a private storage bucket named `results`. Create it in the Supabase dashboard under **Storage**, using the exact name `results`, then run the policies below in the Supabase SQL Editor. The application stores files under each uploader's user ID.

For the public learner portal to create signed download URLs, also add a `SELECT` policy that permits access to the stored result files. A simple policy for this project is:

```sql
create policy "Authenticated users can upload result files"
on storage.objects for insert
to authenticated
with check (
	bucket_id = 'results'
	and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Anyone can read result files"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'results');

drop policy if exists "Authenticated users can create upload records" on public.result_uploads;

create policy "Authenticated users can create upload records"
on public.result_uploads for insert
to authenticated
with check (
	uploaded_by = (select auth.uid())
	and exists (
		select 1
		from public.schools
		where schools.id = school_id
		and (
			schools.created_by = (select auth.uid())
			or lower(schools.administrator_email) = lower((select auth.jwt() ->> 'email'))
		)
	)
);

create policy "Anyone can read upload records"
on public.result_uploads for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated users can delete their upload records" on public.result_uploads;

create policy "Authenticated users can delete their upload records"
on public.result_uploads for delete
to authenticated
using (uploaded_by = (select auth.uid()));
```

The bucket must be created before running these policies. If policies with these names already exist, delete or rename the existing policies first. The browser's publishable Supabase key cannot create buckets or bypass RLS automatically.

## School upload organization

Add upload-level term, grade, and assessment metadata so files can be organized as School -> Term -> Grade -> Assessment 1, 2, or 3:

```sql
alter table public.result_uploads
add column if not exists term text;

alter table public.result_uploads
add column if not exists grade text;

alter table public.result_uploads
add column if not exists assessment_period smallint;
```

Run this migration to connect each uploaded file to the school selected by the administrator:

```sql
alter table public.result_uploads
add column if not exists school_id uuid references public.schools(id);

alter table public.schools
add column if not exists administrator_email text;
```

The owner account is `bert36766@gmail.com`. Add each school administrator's Supabase Auth email in the school form. Administrators can then select only their assigned school, upload results, and view only files they uploaded. The owner can view all uploads and manage schools. Existing uploads without a `school_id` appear as `Unassigned`.

Do not invite school administrators as Supabase organization or project members. Create them as Supabase Auth users only, then assign their exact Auth email to a school. They should receive only the portal URL and their login details. Never share the project's service-role key.

The application hides school management for school administrators, but database RLS policies are the security boundary. Verify that `schools` INSERT, UPDATE, and DELETE policies are owner-only, and that `result_uploads` SELECT is restricted to the uploader or the project owner. Do not use a public `result_uploads` SELECT policy in production if upload metadata should remain private; the public learner portal uses the RPC and does not need direct upload-record access.

Before assigning an administrator to a school, create that person's account in Supabase Dashboard under **Authentication > Users** with the same email and password you give them. The school form only stores the email-to-school assignment; passwords are handled by Supabase Auth and are never stored in this application. An authenticated account cannot open the dashboard until its email is assigned to at least one school.

## Spreadsheet upload format

Excel uploads are imported into the `learners` and `results` tables so the public portal can search them by assessment number and term. The first worksheet must contain one learner per row and `assessment_number` and `term` columns. The importer also recognizes `learner_name`, `grade`, `class`, `mathematics`, `english`, `kiswahili`, `integrated_science`, `social_studies`, `cre_ire`, `agriculture`, `creative_arts_sports`, `pre_technical_studies`, `aggregate_points`, and `aggregate_rubric`. Use values such as `Term 1`, `Term 2`, and `Term 3` in the `term` column.

The importer assigns the selected school's `school_id` to both the learner and result records. Ensure both tables contain this column before importing:

```sql
alter table public.learners
add column if not exists school_id uuid references public.schools(id);

alter table public.results
add column if not exists school_id uuid references public.schools(id);
```

Column names may use spaces or capitalization, such as `Assessment Number` or `Learner Name`. PDF files are stored for viewing and downloading, but their contents are not automatically imported into searchable learner records.

## Learner search setup

Before importing termly results, add the term column and unique constraint:

```sql
alter table public.results add column if not exists term text;
alter table public.results drop constraint if exists results_learner_id_key;
alter table public.results add constraint results_learner_id_term_key unique (learner_id, term);
```

The public portal searches learner data through a database function named `search_learner_result`. That function must exist in Supabase and must be executable by the anonymous role. For multi-school support, the lookup must also be filtered by the selected school:

```sql
alter table public.learners
  add column if not exists school_id uuid references public.schools(id);

alter table public.results
  add column if not exists school_id uuid references public.schools(id);

create index if not exists learners_school_assessment_idx
  on public.learners (school_id, assessment_number);

create index if not exists results_school_term_idx
  on public.results (school_id, term);

create or replace function public.search_learner_result(
  search_assessment_number text,
  search_term text,
  search_school_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(result_row)
  from (
    select
      l.assessment_number,
      l.learner_name,
      l.grade,
      l.class,
      r.term,
      r.mathematics,
      r.english,
      r.kiswahili,
      r.integrated_science,
      r.social_studies,
      r.cre_ire,
      r.agriculture,
      r.creative_arts_sports,
      r.pre_technical_studies,
      r.aggregate_points,
      r.aggregate_rubric as aggregate_rubrics
    from public.learners l
    join public.results r on r.learner_id = l.id
    where l.school_id = search_school_id
      and l.assessment_number = search_assessment_number
      and lower(r.term) = lower(search_term)
    limit 1
  ) as result_row;
$$;

grant execute on function public.search_learner_result(text, text, uuid) to anon;
```

If the portal displays `Unable to search results`, open the browser console or use the message on the page to see the exact database error. A `42883` error means the function has not been created, while a permission error means its `EXECUTE` grant is missing. The function should return the learner result columns used by `index.html`, including `assessment_number`, `learner_name`, `grade`, `class`, and the subject and aggregate fields.

## Backups and recovery

Backups are configured in the Supabase project, not in the browser application. In the Supabase dashboard:

1. Review **Project Settings > Database > Backups** and enable the available automatic backup plan.
2. Keep important exports of the `schools`, `learners`, `results`, and `result_uploads` tables, plus Storage files, in a secure location separate from the project.
3. Test restoring a backup in a separate Supabase project before relying on it.
4. Record the restore procedure and keep the project owner account protected with MFA.

## Deployment and security

Keep this repository private and deploy only the public site files through a trusted HTTPS host. The Supabase publishable key may appear in browser code, but the service-role key, database passwords, and SMTP credentials must never be committed or placed in HTML or JavaScript. Local environment files are excluded by `.gitignore`.

Configure Supabase **Authentication > URL Configuration** with the real site URL and the exact password-reset redirect URL, for example `https://your-domain.example/reset-password.html`. Do not add untrusted domains to the redirect allow list.

The login pages include a client-side failed-attempt delay for a better user experience. This can be bypassed by a modified browser, so keep Supabase Auth rate limits and any hosting/WAF rate limiting enabled; server-side controls are the actual protection.
