-- Read-only, leased wake-up capabilities. No financial payload enters Realtime.
create table private.driver_cash_signal_channels (
  source_id uuid not null,
  credential_id text not null,
  subscriber_id uuid not null,
  topic text not null unique default ('cash-writer:' || encode(extensions.gen_random_bytes(32),'hex')),
  expires_at timestamptz not null,
  primary key(source_id,credential_id,subscriber_id)
);
alter table private.driver_cash_signal_channels enable row level security;
revoke all on private.driver_cash_signal_channels from public,anon,authenticated;

create function public.register_driver_cash_signal(p_source uuid,p_credential text,p_subscriber uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare channel private.driver_cash_signal_channels;
begin
 if p_subscriber is null or nullif(p_credential,'') is null or length(p_credential)>200 or
    not exists(select 1 from public.billing_control where sync_enabled and writer_source_id=p_source)
 then raise exception 'Wrong Writer' using errcode='42501'; end if;
 delete from private.driver_cash_signal_channels where expires_at<now();
 insert into private.driver_cash_signal_channels(source_id,credential_id,subscriber_id,expires_at)
 values(p_source,p_credential,p_subscriber,now()+interval '15 minutes')
 on conflict(source_id,credential_id,subscriber_id) do update set expires_at=excluded.expires_at
 returning * into channel;
 return jsonb_build_object('protocol_version',1,'topic',channel.topic,'expires_at',channel.expires_at,'renew_after_ms',600000);
end $$;
revoke all on function public.register_driver_cash_signal(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.register_driver_cash_signal(uuid,text,uuid) to service_role;

create function public.can_receive_driver_cash_signal(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_topic ~ '^cash-writer:[a-f0-9]{64}$' and exists(
 select 1 from private.driver_cash_signal_channels ch join public.billing_control b on b.writer_source_id=ch.source_id
 where ch.topic=p_topic and ch.expires_at>now() and b.sync_enabled)
$$;
revoke all on function public.can_receive_driver_cash_signal(text) from public,authenticated;
grant execute on function public.can_receive_driver_cash_signal(text) to anon;
create policy "writer_cash_signal_receive" on realtime.messages for select to anon
using(extension='broadcast' and topic=(select realtime.topic()) and public.can_receive_driver_cash_signal((select realtime.topic())));
-- No INSERT policy: a holder can receive a hint but cannot forge notifications.

create function private.notify_driver_cash_writer() returns trigger
language plpgsql security definer set search_path='' as $$
declare channel record;
begin
 for channel in select ch.topic from private.driver_cash_signal_channels ch
 join public.billing_control b on b.writer_source_id=ch.source_id
 where ch.expires_at>now() and b.sync_enabled loop
  perform realtime.send('{}'::jsonb,'cash_changed',channel.topic,true);
 end loop;
 return null;
end $$;
revoke all on function private.notify_driver_cash_writer() from public,anon,authenticated;
create trigger driver_cash_signal_insert after insert on private.driver_cash_operations
for each statement execute function private.notify_driver_cash_writer();
create trigger driver_cash_signal_retry after update of state on private.driver_cash_operations
for each row when(new.state='PENDING' and new.state is distinct from old.state)
execute function private.notify_driver_cash_writer();
create trigger driver_cash_signal_store after update of owner_id,client_company_id on public.client_store
for each row when(new.owner_id is distinct from old.owner_id or new.client_company_id is distinct from old.client_company_id)
execute function private.notify_driver_cash_writer();
create trigger driver_cash_signal_profile after update of client_company_id on public.profiles
for each row when(new.client_company_id is distinct from old.client_company_id)
execute function private.notify_driver_cash_writer();
create trigger driver_cash_signal_company after insert on public.client_company
for each statement execute function private.notify_driver_cash_writer();
create trigger driver_cash_signal_control after update on public.billing_control
for each statement execute function private.notify_driver_cash_writer();
