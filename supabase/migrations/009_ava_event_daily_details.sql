alter table public.companion_daily_states
  add column event_detail text,
  add column event_detail_status text not null default 'pending'
    check (event_detail_status in ('pending', 'leased', 'generated', 'failed')),
  add column event_detail_attempted_at timestamptz,
  add column event_detail_lease_token uuid,
  add column event_detail_lease_expires_at timestamptz,
  add column event_detail_generated_at timestamptz,
  add constraint companion_daily_states_event_detail_check check (
    (event_detail_status = 'generated' and event_detail is not null and event_detail_generated_at is not null)
    or
    (event_detail_status <> 'generated' and event_detail is null)
  );

create or replace function public.claim_ava_event_detail(
  p_companion_key text,
  p_local_date date,
  p_worker_token uuid,
  p_lease_seconds integer default 120
)
returns setof public.companion_daily_states
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lease_seconds < 30 then
    raise exception 'invalid_ava_event_detail_lease';
  end if;

  return query
  update public.companion_daily_states as state
    set event_detail_status = 'leased',
        event_detail_lease_token = p_worker_token,
        event_detail_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        event_detail_attempted_at = now()
    where state.companion_key = p_companion_key
      and state.local_date = p_local_date
      and state.event_run_id is not null
      and state.event_detail is null
      and (
        state.event_detail_status = 'pending'
        or (
          state.event_detail_status = 'failed'
          and state.event_detail_attempted_at <= now() - interval '30 minutes'
        )
        or (
          state.event_detail_status = 'leased'
          and state.event_detail_lease_expires_at < now()
        )
      )
    returning state.*;
end;
$$;

create or replace function public.complete_ava_event_detail(
  p_companion_key text,
  p_local_date date,
  p_worker_token uuid,
  p_event_detail text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.companion_daily_states
    set event_detail = btrim(p_event_detail),
        event_detail_status = 'generated',
        event_detail_lease_token = null,
        event_detail_lease_expires_at = null,
        event_detail_generated_at = now()
    where companion_key = p_companion_key
      and local_date = p_local_date
      and event_detail_status = 'leased'
      and event_detail_lease_token = p_worker_token;

  return found;
end;
$$;

create or replace function public.release_ava_event_detail(
  p_companion_key text,
  p_local_date date,
  p_worker_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.companion_daily_states
    set event_detail_status = 'failed',
        event_detail_lease_token = null,
        event_detail_lease_expires_at = null
    where companion_key = p_companion_key
      and local_date = p_local_date
      and event_detail_status = 'leased'
      and event_detail_lease_token = p_worker_token;

  return found;
end;
$$;

revoke all on function public.claim_ava_event_detail(text, date, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_ava_event_detail(text, date, uuid, text) from public, anon, authenticated;
revoke all on function public.release_ava_event_detail(text, date, uuid) from public, anon, authenticated;

grant execute on function public.claim_ava_event_detail(text, date, uuid, integer) to service_role;
grant execute on function public.complete_ava_event_detail(text, date, uuid, text) to service_role;
grant execute on function public.release_ava_event_detail(text, date, uuid) to service_role;
