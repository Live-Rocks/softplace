create extension if not exists btree_gist;

create table public.ava_event_runs (
  id uuid primary key default gen_random_uuid(),
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  event_key text not null check (char_length(btrim(event_key)) between 1 and 100),
  starts_on date not null,
  ends_on date not null,
  duration_days integer not null check (duration_days in (2, 3)),
  created_at timestamptz not null default now(),
  check (ends_on = starts_on + (duration_days - 1)),
  unique (companion_key, starts_on),
  exclude using gist (
    companion_key with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create index ava_event_runs_timeline_idx
  on public.ava_event_runs (companion_key, starts_on desc);

alter table public.companion_daily_states
  add column event_run_id uuid references public.ava_event_runs(id),
  add column event_key text,
  add column event_day integer,
  add column phase_key text,
  add column skeleton_activity text,
  add column skeleton_mood_note text,
  add constraint companion_daily_states_event_fields_check check (
    (event_run_id is null and event_key is null and event_day is null and phase_key is null and skeleton_activity is null and skeleton_mood_note is null)
    or
    (event_run_id is not null and event_key is not null and event_day is not null and event_day >= 1 and phase_key is not null and skeleton_activity is not null and skeleton_mood_note is not null)
  );

create index companion_daily_states_event_run_idx
  on public.companion_daily_states (event_run_id, local_date);

alter table public.ava_event_runs enable row level security;

revoke all on table public.ava_event_runs from public, anon, authenticated;
grant all on table public.ava_event_runs to service_role;

create or replace function public.ensure_ava_event_run(
  p_companion_key text,
  p_local_date date,
  p_event_key text,
  p_duration_days integer
)
returns public.ava_event_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ava_event_runs%rowtype;
begin
  if p_duration_days not in (2, 3) then
    raise exception 'invalid_ava_event_duration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ava-event-run:' || p_companion_key, 0));

  select * into v_run
    from public.ava_event_runs
    where companion_key = p_companion_key
      and daterange(starts_on, ends_on, '[]') @> p_local_date
    order by starts_on desc
    limit 1;

  if found then
    return v_run;
  end if;

  insert into public.ava_event_runs (companion_key, event_key, starts_on, ends_on, duration_days)
  values (
    p_companion_key,
    p_event_key,
    p_local_date,
    p_local_date + (p_duration_days - 1),
    p_duration_days
  )
  returning * into v_run;

  return v_run;
end;
$$;

revoke all on function public.ensure_ava_event_run(text, date, text, integer) from public, anon, authenticated;
grant execute on function public.ensure_ava_event_run(text, date, text, integer) to service_role;
