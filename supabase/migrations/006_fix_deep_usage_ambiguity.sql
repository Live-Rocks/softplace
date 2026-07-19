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

    update public.usage_limits as usage
      set deep_messages_used = usage.deep_messages_used + 1
      where usage.user_id = p_user_id
        and usage.month = v_month
      returning usage.deep_messages_used into v_used;
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

revoke all on function public.complete_chat_success(
  uuid,
  uuid,
  text,
  boolean,
  text,
  text,
  public.companion_mode,
  uuid
) from public, anon, authenticated;

grant execute on function public.complete_chat_success(
  uuid,
  uuid,
  text,
  boolean,
  text,
  text,
  public.companion_mode,
  uuid
) to service_role;
