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

create policy "Authenticated users can create upload records"
on public.result_uploads for insert
to authenticated
with check (uploaded_by = (select auth.uid()));

create policy "Anyone can read upload records"
on public.result_uploads for select
to anon, authenticated
using (true);
```

The bucket must be created before running these policies. If policies with these names already exist, delete or rename the existing policies first. The browser's publishable Supabase key cannot create buckets or bypass RLS automatically.

## Spreadsheet upload format

Excel uploads are imported into the `learners` and `results` tables so the public portal can search them by assessment number. The first worksheet must contain one learner per row and an `assessment_number` column. The importer also recognizes `learner_name`, `grade`, `class`, `mathematics`, `english`, `kiswahili`, `integrated_science`, `social_studies`, `cre_ire`, `agriculture`, `creative_arts_sports`, `pre_technical_studies`, `aggregate_points`, and `aggregate_rubric`.

Column names may use spaces or capitalization, such as `Assessment Number` or `Learner Name`. PDF files are stored for viewing and downloading, but their contents are not automatically imported into searchable learner records.

## Learner search setup

The public portal searches learner data through a database function named `search_learner_result`. That function must exist in Supabase and must be executable by the anonymous role:

```sql
create or replace function public.search_learner_result(search_assessment_number text)
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
		where l.assessment_number = search_assessment_number
		limit 1
	) as result_row;
$$;

grant execute on function public.search_learner_result(text) to anon;
```

If the portal displays `Unable to search results`, open the browser console or use the message on the page to see the exact database error. A `42883` error means the function has not been created, while a permission error means its `EXECUTE` grant is missing. The function should return the learner result columns used by `index.html`, including `assessment_number`, `learner_name`, `grade`, `class`, and the subject and aggregate fields.

