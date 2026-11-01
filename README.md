# drms-portal
Digital Results Management System-Results Portal

## License

Original DRMS project code is licensed under the MIT License; see [`LICENSE`](./LICENSE). MIT is an open-source license, not a declaration that the work is copyright-free: copyright notices and license terms still apply. Verify that you have rights to all existing code, fonts, images, and dependencies before distribution; third-party materials retain their own licenses.

## Supabase Storage setup

The school administrator and teacher upload uses a private storage bucket named `results`. Create it in the Supabase dashboard under **Storage**, using the exact name `results`, then run the policies below in the Supabase SQL Editor. The application stores files under each uploader's user ID.

The public learner page currently looks up upload metadata and creates signed URLs for uploaded spreadsheet files. Those spreadsheets may contain results for many learners. Do not grant anonymous access to the `result_uploads` table or result files in production until that workflow is replaced with a server-side, learner-scoped download flow. The policies below intentionally omit public `SELECT` access.

```sql
create policy "Authenticated users can upload result files"
on storage.objects for insert
to authenticated
with check (
	bucket_id = 'results'
	and (storage.foldername(name))[1] = (select auth.uid()::text)
);

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

drop policy if exists "Authenticated users can delete their upload records" on public.result_uploads;

create policy "Authenticated users can delete their upload records"
on public.result_uploads for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  or lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com'
);

drop policy if exists "Upload owners and project owner can delete result files" on storage.objects;

create policy "Upload owners and project owner can delete result files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'results'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com'
  )
);
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

To let the project owner view and upload results for every school, including schools assigned to another administrator, run these additional policies in the Supabase SQL Editor. They grant the configured owner email read access to all schools and learner/results records, plus learner/results insert and update access; school administrators remain limited by their existing policies.

```sql
drop policy if exists "Project owner can view all schools" on public.schools;
create policy "Project owner can view all schools"
on public.schools for select
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can read all learners" on public.learners;
create policy "Project owner can read all learners"
on public.learners for select
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can insert learners" on public.learners;
create policy "Project owner can insert learners"
on public.learners for insert
to authenticated
with check (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can update learners" on public.learners;
create policy "Project owner can update learners"
on public.learners for update
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can read all results" on public.results;
create policy "Project owner can read all results"
on public.results for select
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can insert results" on public.results;
create policy "Project owner can insert results"
on public.results for insert
to authenticated
with check (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can update results" on public.results;
create policy "Project owner can update results"
on public.results for update
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');

drop policy if exists "Project owner can insert upload records" on public.result_uploads;
create policy "Project owner can insert upload records"
on public.result_uploads for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com'
);

drop policy if exists "Project owner can read all upload records" on public.result_uploads;
create policy "Project owner can read all upload records"
on public.result_uploads for select
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'bert36766@gmail.com');
```

The owner account is `bert36766@gmail.com`. Add each school administrator's Supabase Auth email in the school form. Administrators can then select only their assigned school, upload results, and view only files they uploaded. The owner can view all uploads and manage schools. Existing uploads without a `school_id` appear as `Unassigned`.

Do not invite school administrators as Supabase organization or project members. Create them as Supabase Auth users only, then assign their exact Auth email to a school. They should receive only the portal URL and their login details. Never share the project's service-role key.

The application hides school management for school administrators, but database RLS policies are the security boundary. Verify that `schools` INSERT, UPDATE, and DELETE policies are owner-only, and that `result_uploads` SELECT is restricted to the uploader or the project owner. The current public learner page still attempts to read upload metadata and whole uploaded spreadsheets; that download fallback is not safe for production and must be replaced with a learner-scoped server-side flow before enabling access to uploaded files. The structured learner result search uses an RPC separately.

## School roles and teacher assignments

The dashboard uses Supabase Auth for all owner, school-admin, and teacher sign-ins. Its role-specific navigation is a usability aid, not authorization. Before using real learner information, enable and test RLS policies so that school admins and teachers can only access records belonging to their assigned school. The dashboard reads teacher assignments from `public.school_teachers`; it does not treat browser storage or user-editable Auth metadata as proof of a teacher role.

Apply [`supabase/migrations/20261101110000_school_teachers.sql`](./supabase/migrations/20261101110000_school_teachers.sql) in the Supabase SQL Editor to create the teacher-assignment table and its school-scoped policies. The migration assumes `schools.id` is a UUID and that `schools` already has RLS enabled. It also makes teacher email unique across schools, matching the dashboard's one-school-per-teacher role model.

Create teacher Auth accounts in Supabase **Authentication > Users** using the same email that will be recorded in the dashboard's teacher assignment. The dashboard stores the school, teacher name, email, and subject assignment only; it does not create credentials or change Auth accounts. Removing a teacher assignment does not delete or disable the teacher's Auth account. The migration only secures teacher assignments and assigned-school lookup; it does not provide RLS policies for `learners`, `results`, `result_uploads`, or Storage. Verify those policies separately before using real learner information.

To let assigned teachers use **Upload Results** for any subject while limiting their learner and result access to their assigned school, apply [`supabase/migrations/20261101120000_teacher_result_uploads.sql`](./supabase/migrations/20261101120000_teacher_result_uploads.sql) after the school-teacher migration. It adds the school and upload metadata columns if needed, enables RLS, adds school-scoped access for teachers, school administrators, and the project owner, and adds restrictive scope policies so older permissive policies cannot expand access to other schools. The private `results` bucket and authenticated upload policy above must also be configured.

Before launch, test each role with separate accounts against the live database: an owner across multiple schools, a school admin limited to one school, and a teacher limited to their assigned school and subject. Verify that direct API requests are denied when they cross these boundaries; hiding a dashboard control is not sufficient.

## Login and learner-search activity

After applying the school-teacher migration, apply [`supabase/migrations/20261101113000_portal_activity.sql`](./supabase/migrations/20261101113000_portal_activity.sql). The owner dashboard will then show recent successful dashboard sign-ins (name, email, resolved role, school, and time) and daily/all-time valid learner-search totals and matches. Search analytics store only aggregate counts; they do not store assessment numbers, learner names, or search terms. The activity tables are owner-readable only, and the login event is recorded once per Supabase Auth session.

The public search counter is called by the browser and is useful for operational reporting, but it is not tamper-proof against automated callers. It does not collect IP addresses or identify parent users. Establish a retention period and delete old login events periodically in accordance with your privacy requirements. The dashboard activity panel requires the owner account configured in the SQL migrations.

## Printing grade results

After running the `assessment_period` migration in **Learner search setup**, the dashboard's **Print Grade Results** panel can print a selected school's grade and term. Each learner is listed in assessment-number order, and the printout includes every uploaded assessment for that learner in the selected term. Learners without uploaded results remain listed with a notice.

Before assigning an administrator to a school, create that person's account in Supabase Dashboard under **Authentication > Users** with the same email and password you give them. The school form only stores the email-to-school assignment; passwords are handled by Supabase Auth and are never stored in this application. An authenticated account cannot open the dashboard until its email is assigned to at least one school.

## Spreadsheet upload format

Excel uploads are imported into the `learners` and `results` tables so the public portal can search them by assessment number and term. The first worksheet must contain one learner per row and an `assessment_number` column. The term selected in the dashboard is used automatically; an optional `term` column can override it for individual rows. The importer also recognizes `learner_name`, `grade`, `class`, `mathematics`, `english`, `kiswahili`, `integrated_science`, `social_studies`, `cre_ire`, `agriculture`, `creative_arts_sports`, `pre_technical_studies`, `aggregate_points`, and `aggregate_rubric`.

The importer assigns the selected school's `school_id` to both the learner and result records. Ensure both tables contain this column before importing:

```sql
alter table public.learners
add column if not exists school_id uuid references public.schools(id);

alter table public.results
add column if not exists school_id uuid references public.schools(id);
```

Column names may use spaces or capitalization, such as `Assessment Number` or `Learner Name`. PDF files are stored for viewing and downloading, but their contents are not automatically imported into searchable learner records.

If `aggregate_points` (AGG) is blank, the importer adds the available numeric subject points. If `aggregate_rubric` (RUB) is blank, it is assigned from AGG using these inclusive bands: 0-9 `Below expectation2 (BE2)`, 10-18 `Below expectation1 (BE1)`, 19-27 `Approaching expectation2 (AE2)`, 28-36 `Approaching expectation1 (AE1)`, 37-45 `Meeting expectation2 (ME2)`, 46-54 `Meeting expectation1 (ME1)`, 55-63 `Exceeding expectation2 (EE2)`, and 64-72 `Exceeding expectation1 (EE1)`. Existing nonblank AGG and RUB values are preserved. Scores outside 0-72 do not receive an automatic rubric.

## Learner search setup

Before importing termly results, add the term column and unique constraint:

```sql
alter table public.results add column if not exists term text;
alter table public.results add column if not exists assessment_period smallint;
update public.results set assessment_period = 1 where assessment_period is null;
alter table public.results drop constraint if exists results_learner_id_key;
alter table public.results drop constraint if exists results_learner_id_term_key;
alter table public.results add constraint results_learner_id_term_assessment_key unique (learner_id, term, assessment_period);
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

create index if not exists result_uploads_school_assessment_idx
  on public.result_uploads (school_id, term, grade, assessment_period, uploaded_at desc);

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
      s.school_name,
      l.assessment_number,
      l.learner_name,
      l.grade,
      l.class,
      r.term,
      r.assessment_period,
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
    left join public.schools s on s.id = l.school_id
    where (search_school_id is null or l.school_id = search_school_id)
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

Configure Supabase **Authentication > URL Configuration** with the deployed HTTPS website as the **Site URL**, and add the exact deployed `reset-password.html` address under **Redirect URLs** (for example, `https://your-domain.example/reset-password.html`). Request password-reset emails from the published website, not `localhost`; localhost links cannot open on a phone. After correcting these settings, request a new reset email because links already sent retain their original redirect address. Do not add untrusted domains to the redirect allow list.

The login pages include a client-side failed-attempt delay for a better user experience. This can be bypassed by a modified browser, so keep Supabase Auth rate limits and any hosting/WAF rate limiting enabled; server-side controls are the actual protection.
