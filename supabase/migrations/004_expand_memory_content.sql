alter table public.memories
  drop constraint if exists memories_content_check;

alter table public.memories
  drop constraint if exists memories_content_length_check;

alter table public.memories
  add constraint memories_content_length_check
  check (char_length(btrim(content)) between 1 and 300);
