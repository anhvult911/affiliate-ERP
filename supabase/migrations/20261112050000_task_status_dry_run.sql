-- A dry run types the real comment into the real composer and then stops. Recording that as
-- `failed` ("Dry run: nothing was posted.") made every rehearsal look like a broken queue, and
-- put the task back in the review pool where it read as a production failure.
--
-- `dry_run` says exactly what happened: the flow ran end to end, nothing was submitted.
alter type public.task_status add value if not exists 'dry_run';
