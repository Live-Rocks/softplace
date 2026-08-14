create type public.retrieval_generation_status as enum ('injected', 'abstained', 'fallback');
create type public.retrieval_generation_effect as enum ('helpful', 'neutral', 'harmful');

create table public.retrieval_generation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  query_message_id uuid not null unique references public.messages(id) on delete cascade,
  assistant_message_id uuid not null unique references public.messages(id) on delete cascade,
  status public.retrieval_generation_status not null,
  model text not null,
  embedding_model text not null check (embedding_model = 'text-embedding-3-small'),
  dimensions integer not null check (dimensions = 512),
  chunk_strategy text not null check (chunk_strategy = 'dialogue_window'),
  injection_strategy text not null check (injection_strategy = 'user_only'),
  threshold double precision not null check (threshold = 0.60),
  candidate_limit integer not null check (candidate_limit = 5),
  injection_limit integer not null check (injection_limit = 2),
  history_limit integer not null check (history_limit = 10),
  retrieval_token_budget integer not null check (retrieval_token_budget = 1200),
  candidate_count integer not null check (candidate_count between 0 and 5),
  injected_count integer not null check (injected_count between 0 and 2),
  embedding_latency_ms bigint not null check (embedding_latency_ms >= 0),
  search_latency_ms bigint not null check (search_latency_ms >= 0),
  total_retrieval_latency_ms bigint not null check (total_retrieval_latency_ms >= 0),
  error_code text,
  instructions_tokens integer not null check (instructions_tokens >= 0),
  memory_tokens integer not null check (memory_tokens >= 0),
  history_10_tokens integer not null check (history_10_tokens >= 0),
  history_20_tokens integer not null check (history_20_tokens >= 0),
  retrieval_tokens integer not null check (retrieval_tokens between 0 and 1200),
  current_query_tokens integer not null check (current_query_tokens >= 0),
  actual_input_tokens integer check (actual_input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  response_effect public.retrieval_generation_effect,
  stale_detected boolean,
  sensitive_detected boolean,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (response_effect is null and stale_detected is null and sensitive_detected is null and reviewed_at is null)
    or
    (response_effect is not null and stale_detected is not null and sensitive_detected is not null and reviewed_at is not null)
  )
);

create index retrieval_generation_runs_user_created_idx
  on public.retrieval_generation_runs (user_id, created_at desc);
create index retrieval_generation_runs_review_idx
  on public.retrieval_generation_runs (status, reviewed_at, created_at);

create table public.retrieval_generation_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.retrieval_generation_runs(id) on delete cascade,
  chunk_id uuid not null references public.retrieval_chunks(id) on delete cascade,
  rank integer not null check (rank between 1 and 5),
  score double precision not null check (score between -1 and 1),
  injected boolean not null,
  review_label public.retrieval_review_label,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, rank),
  unique (run_id, chunk_id),
  check ((review_label is null and reviewed_at is null) or (review_label is not null and reviewed_at is not null))
);

create index retrieval_generation_candidates_run_idx
  on public.retrieval_generation_candidates (run_id, rank);

alter table public.retrieval_generation_runs enable row level security;
alter table public.retrieval_generation_candidates enable row level security;

create function public.record_retrieval_generation_run(
  p_user_id uuid,
  p_conversation_id uuid,
  p_query_message_id uuid,
  p_assistant_message_id uuid,
  p_status text,
  p_model text,
  p_embedding_latency_ms bigint,
  p_search_latency_ms bigint,
  p_total_retrieval_latency_ms bigint,
  p_error_code text,
  p_instructions_tokens integer,
  p_memory_tokens integer,
  p_history_10_tokens integer,
  p_history_20_tokens integer,
  p_retrieval_tokens integer,
  p_current_query_tokens integer,
  p_actual_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_candidates jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_run_id uuid;
  v_candidate jsonb;
  v_candidate_count integer := 0;
  v_injected_count integer := 0;
begin
  if p_status not in ('injected', 'abstained', 'fallback') then
    raise exception 'invalid_generation_status';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'invalid_generation_candidates';
  end if;
  v_candidate_count := jsonb_array_length(p_candidates);
  if v_candidate_count > 5 then raise exception 'invalid_generation_candidates'; end if;
  select count(*) into v_injected_count
  from jsonb_array_elements(p_candidates) candidate
  where coalesce((candidate->>'injected')::boolean, false);
  if v_injected_count > 2 or (p_status = 'injected') <> (v_injected_count > 0) then
    raise exception 'invalid_generation_injection';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_candidates) candidate
    where not exists (
      select 1 from public.retrieval_chunks c
      where c.id = (candidate->>'chunkId')::uuid
        and c.user_id = p_user_id
        and c.conversation_id = p_conversation_id
    )
  ) then
    raise exception 'invalid_generation_candidate_owner';
  end if;
  if not exists (
    select 1
    from public.conversations c
    join public.messages q on q.id = p_query_message_id and q.conversation_id = c.id and q.role = 'user'
    join public.messages a on a.id = p_assistant_message_id and a.conversation_id = c.id and a.role = 'assistant'
    where c.id = p_conversation_id and c.user_id = p_user_id and a.message_sequence > q.message_sequence
  ) then
    raise exception 'invalid_generation_messages';
  end if;

  insert into public.retrieval_generation_runs (
    user_id, conversation_id, query_message_id, assistant_message_id, status, model,
    embedding_model, dimensions, chunk_strategy, injection_strategy, threshold,
    candidate_limit, injection_limit, history_limit, retrieval_token_budget,
    candidate_count, injected_count, embedding_latency_ms, search_latency_ms,
    total_retrieval_latency_ms, error_code, instructions_tokens, memory_tokens,
    history_10_tokens, history_20_tokens, retrieval_tokens, current_query_tokens,
    actual_input_tokens, cached_input_tokens, output_tokens
  ) values (
    p_user_id, p_conversation_id, p_query_message_id, p_assistant_message_id,
    p_status::public.retrieval_generation_status, p_model,
    'text-embedding-3-small', 512, 'dialogue_window', 'user_only', 0.60,
    5, 2, 10, 1200, v_candidate_count, v_injected_count,
    greatest(p_embedding_latency_ms, 0), greatest(p_search_latency_ms, 0),
    greatest(p_total_retrieval_latency_ms, 0), left(p_error_code, 80),
    greatest(p_instructions_tokens, 0), greatest(p_memory_tokens, 0),
    greatest(p_history_10_tokens, 0), greatest(p_history_20_tokens, 0),
    greatest(p_retrieval_tokens, 0), greatest(p_current_query_tokens, 0),
    p_actual_input_tokens, p_cached_input_tokens, p_output_tokens
  )
  on conflict (query_message_id) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id from public.retrieval_generation_runs where query_message_id = p_query_message_id;
  end if;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    insert into public.retrieval_generation_candidates (run_id, chunk_id, rank, score, injected)
    select
      v_run_id,
      c.id,
      (v_candidate->>'rank')::integer,
      (v_candidate->>'score')::double precision,
      coalesce((v_candidate->>'injected')::boolean, false)
    from public.retrieval_chunks c
    where c.id = (v_candidate->>'chunkId')::uuid
      and c.user_id = p_user_id
      and c.conversation_id = p_conversation_id
    on conflict (run_id, chunk_id) do nothing;
  end loop;

  return v_run_id;
end;
$$;

create function public.cleanup_retrieval_generation(p_retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_retention_days < 1 then raise exception 'invalid_retention'; end if;
  delete from public.retrieval_generation_runs
  where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on table public.retrieval_generation_runs, public.retrieval_generation_candidates
  from public, anon, authenticated;
grant all on table public.retrieval_generation_runs, public.retrieval_generation_candidates
  to service_role;
revoke all on function public.record_retrieval_generation_run(
  uuid, uuid, uuid, uuid, text, text, bigint, bigint, bigint, text,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.record_retrieval_generation_run(
  uuid, uuid, uuid, uuid, text, text, bigint, bigint, bigint, text,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, jsonb
) to service_role;
revoke all on function public.cleanup_retrieval_generation(integer) from public, anon, authenticated;
grant execute on function public.cleanup_retrieval_generation(integer) to service_role;
