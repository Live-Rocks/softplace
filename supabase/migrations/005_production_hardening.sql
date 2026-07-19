alter table public.profiles
  alter column plan set default 'free';

create table public.chat_rate_limit_windows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy text not null check (policy in ('minute', 'hour')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, policy, window_start)
);

create table public.deep_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  released_at timestamptz
);

create index chat_rate_limit_windows_cleanup_idx
  on public.chat_rate_limit_windows (window_start);

create index deep_usage_reservations_active_idx
  on public.deep_usage_reservations (user_id, month, expires_at)
  where status = 'active';

alter table public.chat_rate_limit_windows enable row level security;
alter table public.deep_usage_reservations enable row level security;

revoke all on table public.chat_rate_limit_windows from public, anon, authenticated;
revoke all on table public.deep_usage_reservations from public, anon, authenticated;
grant all on table public.chat_rate_limit_windows to service_role;
grant all on table public.deep_usage_reservations to service_role;

create or replace function public.consume_chat_rate_limit(
  p_user_id uuid,
  p_minute_limit integer,
  p_hour_limit integer,
  p_now timestamptz default now()
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minute_start timestamptz := date_trunc('minute', p_now);
  v_hour_start timestamptz := date_trunc('hour', p_now);
  v_minute_count integer := 0;
  v_hour_count integer := 0;
  v_retry integer;
begin
  if p_minute_limit < 1 or p_hour_limit < 1 then
    raise exception 'rate_limit_must_be_positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat-rate:' || p_user_id::text, 0));

  select request_count
    into v_minute_count
    from public.chat_rate_limit_windows
    where user_id = p_user_id
      and policy = 'minute'
      and window_start = v_minute_start;
  v_minute_count := coalesce(v_minute_count, 0);

  select request_count
    into v_hour_count
    from public.chat_rate_limit_windows
    where user_id = p_user_id
      and policy = 'hour'
      and window_start = v_hour_start;
  v_hour_count := coalesce(v_hour_count, 0);

  if v_hour_count >= p_hour_limit then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (v_hour_start + interval '1 hour' - p_now)))::integer
    );
    return query select false, v_retry;
    return;
  end if;

  if v_minute_count >= p_minute_limit then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (v_minute_start + interval '1 minute' - p_now)))::integer
    );
    return query select false, v_retry;
    return;
  end if;

  insert into public.chat_rate_limit_windows (user_id, policy, window_start, request_count)
  values (p_user_id, 'minute', v_minute_start, 1)
  on conflict (user_id, policy, window_start)
  do update set request_count = public.chat_rate_limit_windows.request_count + 1;

  insert into public.chat_rate_limit_windows (user_id, policy, window_start, request_count)
  values (p_user_id, 'hour', v_hour_start, 1)
  on conflict (user_id, policy, window_start)
  do update set request_count = public.chat_rate_limit_windows.request_count + 1;

  delete from public.chat_rate_limit_windows
    where user_id = p_user_id
      and window_start < v_hour_start - interval '1 hour';

  return query select true, 0;
end;
$$;

create or replace function public.reserve_deep_usage(
  p_user_id uuid,
  p_ttl_seconds integer default 120
)
returns table (
  reservation_id uuid,
  reserved boolean,
  usage_month text,
  deep_messages_used integer,
  deep_messages_limit integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := to_char((now() at time zone 'UTC'), 'YYYY-MM');
  v_plan public.plan_type;
  v_limit integer;
  v_used integer;
  v_active integer;
  v_reservation_id uuid;
begin
  if p_ttl_seconds < 1 then
    raise exception 'reservation_ttl_must_be_positive';
  end if;

  select plan into v_plan
    from public.profiles
    where id = p_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;

  v_limit := case v_plan
    when 'free' then 12
    when 'plus' then 300
    when 'pro' then 900
  end;

  insert into public.usage_limits (user_id, month, deep_messages_used)
  values (p_user_id, v_month, 0)
  on conflict (user_id, month) do nothing;

  select usage.deep_messages_used
    into v_used
    from public.usage_limits as usage
    where usage.user_id = p_user_id
      and usage.month = v_month
    for update;

  update public.deep_usage_reservations
    set status = 'released', released_at = now()
    where user_id = p_user_id
      and month = v_month
      and status = 'active'
      and expires_at <= now();

  select count(*)::integer
    into v_active
    from public.deep_usage_reservations
    where user_id = p_user_id
      and month = v_month
      and status = 'active'
      and expires_at > now();

  if v_used + v_active >= v_limit then
    return query select null::uuid, false, v_month, v_used, v_limit;
    return;
  end if;

  insert into public.deep_usage_reservations (user_id, month, expires_at)
  values (p_user_id, v_month, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_reservation_id;

  return query select v_reservation_id, true, v_month, v_used, v_limit;
end;
$$;

create or replace function public.release_deep_usage(
  p_user_id uuid,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_released boolean;
begin
  update public.deep_usage_reservations
    set status = 'released', released_at = now()
    where id = p_reservation_id
      and user_id = p_user_id
      and status = 'active';
  v_released := found;
  return v_released;
end;
$$;

create or replace function public.complete_chat_success(
  p_user_id uuid,
  p_conversation_id uuid,
  p_user_content text,
  p_user_image_present boolean,
  p_assistant_content text,
  p_model_used text,
  p_mode public.companion_mode,
  p_reservation_id uuid default null
)
returns table (
  assistant_id uuid,
  assistant_conversation_id uuid,
  assistant_role public.message_role,
  assistant_content text,
  assistant_model_used text,
  assistant_mode public.companion_mode,
  assistant_image_present boolean,
  assistant_crisis_detected boolean,
  assistant_created_at timestamptz,
  usage_month text,
  deep_messages_used integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month text := to_char((now() at time zone 'UTC'), 'YYYY-MM');
  v_reservation public.deep_usage_reservations%rowtype;
  v_assistant public.messages%rowtype;
  v_used integer := 0;
begin
  perform 1
    from public.conversations
    where id = p_conversation_id
      and user_id = p_user_id
    for update;
  if not found then
    raise exception 'conversation_not_found';
  end if;

  if p_mode = 'deep' and p_reservation_id is null then
    raise exception 'deep_reservation_required';
  end if;
  if p_mode = 'light' and p_reservation_id is not null then
    raise exception 'light_mode_cannot_use_reservation';
  end if;

  if p_reservation_id is not null then
    select * into v_reservation
      from public.deep_usage_reservations
      where id = p_reservation_id
        and user_id = p_user_id
      for update;

    if not found then
      raise exception 'reservation_not_found';
    end if;
    if v_reservation.status <> 'active' then
      raise exception 'reservation_not_active';
    end if;
    if v_reservation.expires_at <= now() then
      raise exception 'reservation_expired';
    end if;

    v_month := v_reservation.month;

    update public.usage_limits
      set deep_messages_used = deep_messages_used + 1
      where user_id = p_user_id
        and month = v_month
      returning public.usage_limits.deep_messages_used into v_used;
    if not found then
      raise exception 'usage_row_not_found';
    end if;

    update public.deep_usage_reservations
      set status = 'completed', completed_at = now()
      where id = p_reservation_id;
  else
    select coalesce(usage.deep_messages_used, 0)
      into v_used
      from public.usage_limits as usage
      where usage.user_id = p_user_id
        and usage.month = v_month;
    v_used := coalesce(v_used, 0);
  end if;

  insert into public.messages (
    conversation_id,
    role,
    content,
    image_present,
    crisis_detected
  ) values (
    p_conversation_id,
    'user',
    p_user_content,
    p_user_image_present,
    false
  );

  insert into public.messages (
    conversation_id,
    role,
    content,
    model_used,
    mode,
    image_present,
    crisis_detected
  ) values (
    p_conversation_id,
    'assistant',
    p_assistant_content,
    p_model_used,
    p_mode,
    false,
    false
  ) returning * into v_assistant;

  update public.conversations
    set updated_at = now()
    where id = p_conversation_id
      and user_id = p_user_id;

  return query select
    v_assistant.id,
    v_assistant.conversation_id,
    v_assistant.role,
    v_assistant.content,
    v_assistant.model_used,
    v_assistant.mode,
    v_assistant.image_present,
    v_assistant.crisis_detected,
    v_assistant.created_at,
    v_month,
    v_used;
end;
$$;

revoke all on function public.consume_chat_rate_limit(uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_deep_usage(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_deep_usage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_chat_success(uuid, uuid, text, boolean, text, text, public.companion_mode, uuid) from public, anon, authenticated;

grant execute on function public.consume_chat_rate_limit(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.reserve_deep_usage(uuid, integer) to service_role;
grant execute on function public.release_deep_usage(uuid, uuid) to service_role;
grant execute on function public.complete_chat_success(uuid, uuid, text, boolean, text, text, public.companion_mode, uuid) to service_role;
