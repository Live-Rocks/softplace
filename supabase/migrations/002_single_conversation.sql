with ranked_conversations as (
  select
    id,
    first_value(id) over (
      partition by user_id
      order by updated_at desc, created_at desc, id desc
    ) as keeper_id
  from public.conversations
)
update public.messages as messages
set conversation_id = ranked.keeper_id
from ranked_conversations as ranked
where messages.conversation_id = ranked.id
  and ranked.id <> ranked.keeper_id;

with ranked_conversations as (
  select
    id,
    row_number() over (
      partition by user_id
      order by updated_at desc, created_at desc, id desc
    ) as position
  from public.conversations
)
delete from public.conversations as conversations
using ranked_conversations as ranked
where conversations.id = ranked.id
  and ranked.position > 1;

create unique index conversations_one_per_user_idx
  on public.conversations (user_id);

alter table public.profiles
  alter column plan set default 'plus';
