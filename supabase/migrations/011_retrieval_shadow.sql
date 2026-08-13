create extension if not exists vector with schema extensions;

create type public.retrieval_shadow_job_status as enum ('pending', 'processing', 'completed', 'failed');
create type public.retrieval_shadow_run_status as enum ('completed', 'error');
create type public.retrieval_review_label as enum ('must', 'acceptable', 'forbidden', 'irrelevant');

create table public.retrieval_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  anchor_message_id uuid not null references public.messages(id) on delete cascade,
  start_sequence bigint not null check (start_sequence >= 0),
  end_sequence bigint not null check (end_sequence >= start_sequence),
  model text not null check (model = 'text-embedding-3-small'),
  dimensions integer not null check (dimensions = 512),
  chunk_strategy text not null check (chunk_strategy = 'dialogue_window'),
  embedding extensions.vector(512) not null,
  created_at timestamptz not null default now(),
  unique (anchor_message_id, model, dimensions, chunk_strategy)
);

create index retrieval_chunks_user_timeline_idx
  on public.retrieval_chunks (user_id, conversation_id, end_sequence desc);
create index retrieval_chunks_embedding_hnsw_idx
  on public.retrieval_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table public.retrieval_shadow_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  query_message_id uuid not null references public.messages(id) on delete cascade,
  status public.retrieval_shadow_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 3),
  available_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_token uuid,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (query_message_id)
);

create index retrieval_shadow_jobs_claim_idx
  on public.retrieval_shadow_jobs (status, available_at, created_at);

create table public.retrieval_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.retrieval_shadow_jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  query_message_id uuid not null references public.messages(id) on delete cascade,
  status public.retrieval_shadow_run_status not null,
  model text not null check (model = 'text-embedding-3-small'),
  dimensions integer not null check (dimensions = 512),
  chunk_strategy text not null check (chunk_strategy = 'dialogue_window'),
  query_strategy text not null check (query_strategy = 'with_recent_context'),
  threshold double precision not null check (threshold = 0.60),
  top_k integer not null check (top_k = 3),
  candidate_limit integer not null check (candidate_limit = 5),
  queue_delay_ms bigint not null check (queue_delay_ms >= 0),
  search_latency_ms bigint not null check (search_latency_ms >= 0),
  candidate_count integer not null check (candidate_count between 0 and 5),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index retrieval_shadow_runs_user_created_idx
  on public.retrieval_shadow_runs (user_id, created_at desc);

create table public.retrieval_shadow_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.retrieval_shadow_runs(id) on delete cascade,
  chunk_id uuid not null references public.retrieval_chunks(id) on delete cascade,
  rank integer not null check (rank between 1 and 5),
  score double precision not null check (score between -1 and 1),
  passed_threshold boolean not null,
  review_label public.retrieval_review_label,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, rank),
  unique (run_id, chunk_id),
  check ((review_label is null and reviewed_at is null) or (review_label is not null and reviewed_at is not null))
);

create index retrieval_shadow_candidates_run_idx
  on public.retrieval_shadow_candidates (run_id, rank);

alter table public.retrieval_chunks enable row level security;
alter table public.retrieval_shadow_jobs enable row level security;
alter table public.retrieval_shadow_runs enable row level security;
alter table public.retrieval_shadow_candidates enable row level security;

create function public.enqueue_retrieval_shadow_job(
  p_user_id uuid,
  p_conversation_id uuid,
  p_query_message_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_id uuid;
begin
  if not exists (
    select 1 from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = p_query_message_id
      and m.conversation_id = p_conversation_id
      and m.role = 'user'
      and c.user_id = p_user_id
      and not m.image_present
      and not m.crisis_detected
  ) then
    raise exception 'shadow_query_not_eligible';
  end if;

  insert into public.retrieval_shadow_jobs (user_id, conversation_id, query_message_id)
  values (p_user_id, p_conversation_id, p_query_message_id)
  on conflict (query_message_id) do update set query_message_id = excluded.query_message_id
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create function public.claim_retrieval_shadow_jobs(p_lease_token uuid, p_limit integer default 10)
returns setof public.retrieval_shadow_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.retrieval_shadow_runs (
    job_id, user_id, conversation_id, query_message_id, status, model, dimensions,
    chunk_strategy, query_strategy, threshold, top_k, candidate_limit,
    queue_delay_ms, search_latency_ms, candidate_count, error_code
  )
  select id, user_id, conversation_id, query_message_id, 'error',
    'text-embedding-3-small', 512, 'dialogue_window', 'with_recent_context', 0.60, 3, 5,
    greatest(0, floor(extract(epoch from (now() - created_at)) * 1000)::bigint), 0, 0,
    'shadow_lease_expired'
  from public.retrieval_shadow_jobs
  where status = 'processing' and attempts >= 3 and leased_at < now() - interval '5 minutes'
  on conflict (job_id) do nothing;

  update public.retrieval_shadow_jobs
  set status = 'failed', completed_at = now(), lease_token = null, error_code = 'shadow_lease_expired'
  where status = 'processing' and attempts >= 3 and leased_at < now() - interval '5 minutes';

  return query
  with claimable as (
    select id from public.retrieval_shadow_jobs
    where (status = 'pending' and available_at <= now())
       or (status = 'processing' and attempts < 3 and leased_at < now() - interval '5 minutes')
    order by created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 25)
  )
  update public.retrieval_shadow_jobs j
    set status = 'processing', leased_at = now(), lease_token = p_lease_token, attempts = attempts + 1
    from claimable
    where j.id = claimable.id
    returning j.*;
end;
$$;

create function public.retry_retrieval_shadow_job(p_job_id uuid, p_lease_token uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.retrieval_shadow_jobs%rowtype;
begin
  select * into v_job from public.retrieval_shadow_jobs
  where id = p_job_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if not found then return; end if;

  if v_job.attempts >= 3 then
    insert into public.retrieval_shadow_runs (
      job_id, user_id, conversation_id, query_message_id, status, model, dimensions,
      chunk_strategy, query_strategy, threshold, top_k, candidate_limit,
      queue_delay_ms, search_latency_ms, candidate_count, error_code
    ) values (
      v_job.id, v_job.user_id, v_job.conversation_id, v_job.query_message_id, 'error',
      'text-embedding-3-small', 512, 'dialogue_window', 'with_recent_context', 0.60, 3, 5,
      greatest(0, floor(extract(epoch from (now() - v_job.created_at)) * 1000)::bigint), 0, 0,
      left(coalesce(p_error_code, 'shadow_failed'), 80)
    ) on conflict (job_id) do nothing;
  end if;

  update public.retrieval_shadow_jobs
  set status = case when v_job.attempts >= 3 then 'failed'::public.retrieval_shadow_job_status else 'pending'::public.retrieval_shadow_job_status end,
      available_at = now() + make_interval(secs => least(300, 15 * v_job.attempts)),
      leased_at = null,
      lease_token = null,
      error_code = left(coalesce(p_error_code, 'shadow_failed'), 80),
      completed_at = case when v_job.attempts >= 3 then now() else null end
  where id = v_job.id;
end;
$$;

create function public.match_retrieval_shadow_chunks(
  p_user_id uuid,
  p_conversation_id uuid,
  p_query_sequence bigint,
  p_query_embedding extensions.vector(512),
  p_limit integer default 5
)
returns table (chunk_id uuid, score double precision)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select c.id, 1 - (c.embedding <=> p_query_embedding) as score
  from public.retrieval_chunks c
  where c.user_id = p_user_id
    and c.conversation_id = p_conversation_id
    and c.end_sequence < p_query_sequence
  order by c.embedding <=> p_query_embedding
  limit least(greatest(p_limit, 1), 5)
$$;

create function public.upsert_retrieval_chunk(
  p_user_id uuid,
  p_conversation_id uuid,
  p_anchor_message_id uuid,
  p_start_sequence bigint,
  p_end_sequence bigint,
  p_embedding extensions.vector(512)
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.id = p_anchor_message_id and m.conversation_id = p_conversation_id
      and m.message_sequence = p_end_sequence and c.user_id = p_user_id
  ) then raise exception 'shadow_anchor_not_owned'; end if;

  insert into public.retrieval_chunks (
    user_id, conversation_id, anchor_message_id, start_sequence, end_sequence,
    model, dimensions, chunk_strategy, embedding
  ) values (
    p_user_id, p_conversation_id, p_anchor_message_id, p_start_sequence, p_end_sequence,
    'text-embedding-3-small', 512, 'dialogue_window', p_embedding
  ) on conflict (anchor_message_id, model, dimensions, chunk_strategy)
    do update set embedding = excluded.embedding, start_sequence = excluded.start_sequence, end_sequence = excluded.end_sequence
  returning id into v_id;
  return v_id;
end;
$$;

create function public.complete_retrieval_shadow_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_queue_delay_ms bigint,
  p_search_latency_ms bigint,
  p_candidates jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.retrieval_shadow_jobs%rowtype;
  v_run_id uuid;
  v_candidate jsonb;
begin
  select * into v_job from public.retrieval_shadow_jobs
  where id = p_job_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if not found then raise exception 'shadow_job_not_leased'; end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 5 then
    raise exception 'shadow_candidates_invalid';
  end if;

  insert into public.retrieval_shadow_runs (
    job_id, user_id, conversation_id, query_message_id, status, model, dimensions,
    chunk_strategy, query_strategy, threshold, top_k, candidate_limit,
    queue_delay_ms, search_latency_ms, candidate_count
  ) values (
    v_job.id, v_job.user_id, v_job.conversation_id, v_job.query_message_id, 'completed',
    'text-embedding-3-small', 512, 'dialogue_window', 'with_recent_context', 0.60, 3, 5,
    greatest(p_queue_delay_ms, 0), greatest(p_search_latency_ms, 0), jsonb_array_length(p_candidates)
  ) returning id into v_run_id;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    insert into public.retrieval_shadow_candidates (run_id, chunk_id, rank, score, passed_threshold)
    values (
      v_run_id,
      (v_candidate->>'chunkId')::uuid,
      (v_candidate->>'rank')::integer,
      (v_candidate->>'score')::double precision,
      (v_candidate->>'rank')::integer <= 3 and (v_candidate->>'score')::double precision >= 0.60
    );
  end loop;

  update public.retrieval_shadow_jobs set status = 'completed', completed_at = now(), lease_token = null
  where id = v_job.id;
  return v_run_id;
end;
$$;

create function public.cleanup_retrieval_shadow(p_retention_days integer default 90)
returns table (deleted_runs bigint, deleted_jobs bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with deleted as (
    delete from public.retrieval_shadow_runs
    where created_at < now() - make_interval(days => greatest(p_retention_days, 1))
    returning 1
  ) select count(*) into deleted_runs from deleted;
  with deleted as (
    delete from public.retrieval_shadow_jobs
    where status in ('completed', 'failed')
      and created_at < now() - make_interval(days => greatest(p_retention_days, 1))
    returning 1
  ) select count(*) into deleted_jobs from deleted;
  return next;
end;
$$;

revoke all on table public.retrieval_chunks, public.retrieval_shadow_jobs,
  public.retrieval_shadow_runs, public.retrieval_shadow_candidates from public, anon, authenticated;
revoke all on function public.enqueue_retrieval_shadow_job(uuid, uuid, uuid),
  public.claim_retrieval_shadow_jobs(uuid, integer),
  public.retry_retrieval_shadow_job(uuid, uuid, text),
  public.match_retrieval_shadow_chunks(uuid, uuid, bigint, extensions.vector, integer),
  public.upsert_retrieval_chunk(uuid, uuid, uuid, bigint, bigint, extensions.vector),
  public.complete_retrieval_shadow_job(uuid, uuid, bigint, bigint, jsonb),
  public.cleanup_retrieval_shadow(integer) from public, anon, authenticated;

grant all on table public.retrieval_chunks, public.retrieval_shadow_jobs,
  public.retrieval_shadow_runs, public.retrieval_shadow_candidates to service_role;
grant execute on function public.enqueue_retrieval_shadow_job(uuid, uuid, uuid),
  public.claim_retrieval_shadow_jobs(uuid, integer),
  public.retry_retrieval_shadow_job(uuid, uuid, text),
  public.match_retrieval_shadow_chunks(uuid, uuid, bigint, extensions.vector, integer),
  public.upsert_retrieval_chunk(uuid, uuid, uuid, bigint, bigint, extensions.vector),
  public.complete_retrieval_shadow_job(uuid, uuid, bigint, bigint, jsonb),
  public.cleanup_retrieval_shadow(integer) to service_role;

drop function public.complete_chat_success(uuid, uuid, text, boolean, text, text, public.companion_mode, uuid);

create function public.complete_chat_success(
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
  user_message_id uuid,
  user_conversation_id uuid,
  user_role public.message_role,
  user_content text,
  user_image_present boolean,
  user_crisis_detected boolean,
  user_created_at timestamptz,
  user_message_sequence bigint,
  assistant_id uuid,
  assistant_conversation_id uuid,
  assistant_role public.message_role,
  assistant_content text,
  assistant_model_used text,
  assistant_mode public.companion_mode,
  assistant_image_present boolean,
  assistant_crisis_detected boolean,
  assistant_created_at timestamptz,
  assistant_message_sequence bigint,
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
  v_user public.messages%rowtype;
  v_assistant public.messages%rowtype;
  v_used integer := 0;
begin
  perform 1 from public.conversations
  where id = p_conversation_id and conversations.user_id = p_user_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if p_mode = 'deep' and p_reservation_id is null then raise exception 'deep_reservation_required'; end if;
  if p_mode = 'light' and p_reservation_id is not null then raise exception 'light_mode_cannot_use_reservation'; end if;

  if p_reservation_id is not null then
    select * into v_reservation from public.deep_usage_reservations
    where id = p_reservation_id and deep_usage_reservations.user_id = p_user_id for update;
    if not found then raise exception 'reservation_not_found'; end if;
    if v_reservation.status <> 'active' then raise exception 'reservation_not_active'; end if;
    if v_reservation.expires_at <= now() then raise exception 'reservation_expired'; end if;
    v_month := v_reservation.month;
    update public.usage_limits as usage set deep_messages_used = usage.deep_messages_used + 1
    where usage.user_id = p_user_id and usage.month = v_month
    returning usage.deep_messages_used into v_used;
    if not found then raise exception 'usage_row_not_found'; end if;
    update public.deep_usage_reservations set status = 'completed', completed_at = now()
    where id = p_reservation_id;
  else
    select coalesce(usage.deep_messages_used, 0) into v_used from public.usage_limits as usage
    where usage.user_id = p_user_id and usage.month = v_month;
    v_used := coalesce(v_used, 0);
  end if;

  insert into public.messages (conversation_id, role, content, image_present, crisis_detected)
  values (p_conversation_id, 'user', p_user_content, p_user_image_present, false)
  returning * into v_user;
  insert into public.messages (conversation_id, role, content, model_used, mode, image_present, crisis_detected)
  values (p_conversation_id, 'assistant', p_assistant_content, p_model_used, p_mode, false, false)
  returning * into v_assistant;
  update public.conversations set updated_at = now()
  where id = p_conversation_id and conversations.user_id = p_user_id;

  return query select
    v_user.id, v_user.conversation_id, v_user.role, v_user.content, v_user.image_present,
    v_user.crisis_detected, v_user.created_at, v_user.message_sequence,
    v_assistant.id, v_assistant.conversation_id, v_assistant.role, v_assistant.content,
    v_assistant.model_used, v_assistant.mode, v_assistant.image_present,
    v_assistant.crisis_detected, v_assistant.created_at, v_assistant.message_sequence,
    v_month, v_used;
end;
$$;

revoke all on function public.complete_chat_success(uuid, uuid, text, boolean, text, text, public.companion_mode, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_chat_success(uuid, uuid, text, boolean, text, text, public.companion_mode, uuid)
  to service_role;
