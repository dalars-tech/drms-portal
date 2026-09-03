# drms-portal
Digital Results Management System-Results Portal

## Supabase Storage setup

The administrator upload uses a private storage bucket named `results`. Create it in the Supabase dashboard under **Storage**, using the exact name `results`, then add an `INSERT` policy for authenticated users. The application stores files under each uploader's user ID.

For the public learner portal to create signed download URLs, also add a `SELECT` policy that permits access to the stored result files. A simple policy for this project is:

```sql
create policy "Authenticated users can upload results"
on storage.objects for insert
to authenticated
with check (bucket_id = 'results');

create policy "Anyone can read result files"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'results');
```

The bucket must be created before running these policies. The browser's publishable Supabase key cannot create buckets automatically.
