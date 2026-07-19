create type public.plan_type as enum ('free', 'plus', 'pro');
create type public.message_role as enum ('user', 'assistant', 'system');
create type public.companion_mode as enum ('deep', 'light');
create type public.memory_category as enum ('preference', 'emotional_context');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan public.plan_type not null default 'free',
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '新的對話',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role public.message_role not null,
  content text not null,
  image_present boolean not null default false,
  model_used text,
  mode public.companion_mode,
  crisis_detected boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 6 and 120),
  category public.memory_category not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month text not null,
  deep_messages_used integer not null default 0 check (deep_messages_used >= 0),
  image_messages_used integer not null default 0 check (image_messages_used >= 0),
  unique (user_id, month)
);

create index conversations_user_updated_idx on public.conversations (user_id, updated_at desc);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index memories_user_updated_idx on public.memories (user_id, updated_at desc);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.usage_limits enable row level security;

create policy "Users can read their own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "Users can read their own conversations" on public.conversations
  for select using (auth.uid() = user_id);

create policy "Users can read messages from their conversations" on public.messages
  for select using (
    exists (
      select 1 from public.conversations
      where conversations.id = messages.conversation_id
      and conversations.user_id = auth.uid()
    )
  );

create policy "Users can manage their memories" on public.memories
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read their usage" on public.usage_limits
  for select using (auth.uid() = user_id);

