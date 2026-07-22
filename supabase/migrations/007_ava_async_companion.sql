create type public.companion_message_role as enum ('user', 'assistant');
create type public.companion_job_type as enum ('reply', 'proactive');
create type public.companion_job_status as enum ('queued', 'leased', 'completed', 'failed', 'cancelled');
create type public.companion_proactive_level as enum ('off', 'low', 'normal');

create table public.companion_definitions (
  companion_key text primary key,
  display_name text not null,
  profile jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.companion_definitions (companion_key, display_name, profile)
values (
  'ava',
  'Ava',
  '{"age":27,"city":"台北","work":"品牌內容企劃"}'::jsonb
);

create table public.companion_daily_states (
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  local_date date not null,
  timezone text not null default 'Asia/Taipei',
  activity text not null,
  mood_note text not null,
  created_at timestamptz not null default now(),
  primary key (companion_key, local_date)
);

create table public.user_companions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  relationship_started_at timestamptz not null default now(),
  reply_count integer not null default 0 check (reply_count >= 0),
  proactive_level public.companion_proactive_level not null default 'normal',
  quiet_start time not null default '23:00',
  quiet_end time not null default '09:00',
  timezone text not null default 'Asia/Taipei',
  last_read_at timestamptz,
  last_user_message_at timestamptz,
  last_assistant_message_at timestamptz,
  last_proactive_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, companion_key)
);

create table public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  role public.companion_message_role not null,
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  proactive boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index companion_messages_timeline_idx
  on public.companion_messages (user_id, companion_key, created_at desc, id desc);

create table public.companion_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 300),
  source_message_id uuid references public.companion_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companion_memories_user_idx
  on public.companion_memories (user_id, companion_key, updated_at desc);

create table public.companion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  job_type public.companion_job_type not null,
  status public.companion_job_status not null default 'queued',
  due_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  leased_until timestamptz,
  usage_reserved boolean not null default false,
  usage_local_date date,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index companion_jobs_one_reply_idx
  on public.companion_jobs (user_id, companion_key, job_type)
  where job_type = 'reply' and status in ('queued', 'leased');

create unique index companion_jobs_one_proactive_idx
  on public.companion_jobs (user_id, companion_key, job_type)
  where job_type = 'proactive' and status in ('queued', 'leased');

create index companion_jobs_due_idx
  on public.companion_jobs (status, due_at)
  where status in ('queued', 'leased');

create table public.companion_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  companion_key text not null references public.companion_definitions(companion_key) on delete cascade,
  local_date date not null,
  generated_count integer not null default 0 check (generated_count >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  primary key (user_id, companion_key, local_date)
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('android', 'ios')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

alter table public.companion_definitions enable row level security;
alter table public.companion_daily_states enable row level security;
alter table public.user_companions enable row level security;
alter table public.companion_messages enable row level security;
alter table public.companion_memories enable row level security;
alter table public.companion_jobs enable row level security;
alter table public.companion_daily_usage enable row level security;
alter table public.push_tokens enable row level security;

revoke all on table public.companion_definitions, public.companion_daily_states,
  public.user_companions, public.companion_messages, public.companion_memories,
  public.companion_jobs, public.companion_daily_usage, public.push_tokens
  from public, anon, authenticated;

grant all on table public.companion_definitions, public.companion_daily_states,
  public.user_companions, public.companion_messages, public.companion_memories,
  public.companion_jobs, public.companion_daily_usage, public.push_tokens
  to service_role;

create or replace function public.enqueue_companion_message(
  p_user_id uuid,
  p_companion_key text,
  p_content text,
  p_due_at timestamptz
)
returns table (message_id uuid, message_created_at timestamptz, job_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message public.companion_messages%rowtype;
  v_job public.companion_jobs%rowtype;
begin
  insert into public.user_companions (user_id, companion_key)
  values (p_user_id, p_companion_key)
  on conflict (user_id, companion_key) do nothing;

  insert into public.companion_messages (user_id, companion_key, role, content, read_at)
  values (p_user_id, p_companion_key, 'user', btrim(p_content), now())
  returning * into v_message;

  update public.user_companions
    set last_user_message_at = now(), updated_at = now()
    where user_id = p_user_id and companion_key = p_companion_key;

  perform pg_advisory_xact_lock(hashtextextended('companion-reply:' || p_user_id::text || ':' || p_companion_key, 0));

  select * into v_job
    from public.companion_jobs
    where user_id = p_user_id
      and companion_key = p_companion_key
      and job_type = 'reply'
      and status in ('queued', 'leased')
    order by created_at desc
    limit 1
    for update;

  if found then
    update public.companion_jobs
      set payload = jsonb_set(
        coalesce(payload, '{}'::jsonb),
        '{message_ids}',
        coalesce(payload->'message_ids', '[]'::jsonb) || to_jsonb(v_message.id::text),
        true
      ), updated_at = now()
      where id = v_job.id
      returning * into v_job;
  else
    insert into public.companion_jobs (user_id, companion_key, job_type, due_at, payload)
    values (
      p_user_id,
      p_companion_key,
      'reply',
      p_due_at,
      jsonb_build_object('message_ids', jsonb_build_array(v_message.id::text))
    ) returning * into v_job;
  end if;

  return query select v_message.id, v_message.created_at, v_job.id;
end;
$$;

create or replace function public.claim_companion_jobs(
  p_worker_token uuid,
  p_daily_limit integer,
  p_lease_seconds integer default 120,
  p_limit integer default 1
)
returns setof public.companion_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.companion_jobs%rowtype;
  v_local_date date;
begin
  for v_job in
    select * from public.companion_jobs
    where status = 'leased' and leased_until <= now() and usage_reserved = true
    for update skip locked
  loop
    update public.companion_daily_usage
      set reserved_count = greatest(0, reserved_count - 1)
      where user_id = v_job.user_id
        and companion_key = v_job.companion_key
        and local_date = v_job.usage_local_date;
  end loop;

  update public.companion_jobs
    set status = case
          when attempt_count >= 3 then 'failed'::public.companion_job_status
          else 'queued'::public.companion_job_status
        end,
        last_error = case when attempt_count >= 3 then 'lease_expired' else last_error end,
        lease_token = null, leased_until = null,
        usage_reserved = false, usage_local_date = null, updated_at = now()
    where status = 'leased' and leased_until <= now();

  for v_job in
    select * from public.companion_jobs
    where status = 'queued' and due_at <= now() and attempt_count < 3
    order by due_at
    limit p_limit
    for update skip locked
  loop
    v_local_date := (now() at time zone 'Asia/Taipei')::date;
    insert into public.companion_daily_usage (user_id, companion_key, local_date)
    values (v_job.user_id, v_job.companion_key, v_local_date)
    on conflict (user_id, companion_key, local_date) do nothing;

    perform 1 from public.companion_daily_usage
      where user_id = v_job.user_id and companion_key = v_job.companion_key and local_date = v_local_date
      for update;

    if (select generated_count + reserved_count from public.companion_daily_usage
        where user_id = v_job.user_id and companion_key = v_job.companion_key and local_date = v_local_date) >= p_daily_limit then
      update public.companion_jobs set status = 'cancelled', last_error = 'daily_limit', updated_at = now()
        where id = v_job.id;
      continue;
    end if;

    update public.companion_daily_usage set reserved_count = reserved_count + 1
      where user_id = v_job.user_id and companion_key = v_job.companion_key and local_date = v_local_date;

    update public.companion_jobs
      set status = 'leased', lease_token = p_worker_token,
          leased_until = now() + make_interval(secs => p_lease_seconds),
          usage_reserved = true, usage_local_date = v_local_date,
          attempt_count = attempt_count + 1, updated_at = now()
      where id = v_job.id
      returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create or replace function public.complete_companion_job(
  p_job_id uuid,
  p_worker_token uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.companion_jobs%rowtype;
  v_message_id uuid;
begin
  select * into v_job from public.companion_jobs
    where id = p_job_id and status = 'leased' and lease_token = p_worker_token
    for update;
  if not found then raise exception 'job_not_leased'; end if;

  insert into public.companion_messages (user_id, companion_key, role, content, proactive)
  values (v_job.user_id, v_job.companion_key, 'assistant', btrim(p_content), v_job.job_type = 'proactive')
  returning id into v_message_id;

  update public.companion_daily_usage
    set reserved_count = greatest(0, reserved_count - 1), generated_count = generated_count + 1
    where user_id = v_job.user_id and companion_key = v_job.companion_key and local_date = v_job.usage_local_date;

  update public.user_companions
    set reply_count = reply_count + 1,
        last_assistant_message_at = now(),
        last_proactive_at = case when v_job.job_type = 'proactive' then now() else last_proactive_at end,
        updated_at = now()
    where user_id = v_job.user_id and companion_key = v_job.companion_key;

  update public.companion_jobs
    set status = 'completed', usage_reserved = false, usage_local_date = null,
        lease_token = null, leased_until = null, updated_at = now()
    where id = v_job.id;
  return v_message_id;
end;
$$;

create or replace function public.retry_companion_job(
  p_job_id uuid,
  p_worker_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.companion_jobs%rowtype;
begin
  select * into v_job from public.companion_jobs
    where id = p_job_id and status = 'leased' and lease_token = p_worker_token
    for update;
  if not found then return false; end if;

  if v_job.usage_reserved then
    update public.companion_daily_usage
      set reserved_count = greatest(0, reserved_count - 1)
      where user_id = v_job.user_id and companion_key = v_job.companion_key and local_date = v_job.usage_local_date;
  end if;

  update public.companion_jobs
    set status = case when attempt_count >= 3 then 'failed'::public.companion_job_status else 'queued'::public.companion_job_status end,
        due_at = case when attempt_count >= 3 then due_at else now() + interval '2 minutes' end,
        usage_reserved = false, usage_local_date = null, lease_token = null, leased_until = null,
        last_error = left(p_error, 300), updated_at = now()
    where id = v_job.id;
  return true;
end;
$$;

revoke all on function public.enqueue_companion_message(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_companion_jobs(uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_companion_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.retry_companion_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_companion_message(uuid, text, text, timestamptz) to service_role;
grant execute on function public.claim_companion_jobs(uuid, integer, integer, integer) to service_role;
grant execute on function public.complete_companion_job(uuid, uuid, text) to service_role;
grant execute on function public.retry_companion_job(uuid, uuid, text) to service_role;
