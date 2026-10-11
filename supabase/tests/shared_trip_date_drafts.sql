begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.couple_members order by couple_id,user_id limit 1;
set local role authenticated;
do $$
declare
  cid uuid:=public.my_couple_id();
  rev bigint;
  result jsonb;
  before_rev bigint;
  before_drafts jsonb;
  target_stamp timestamptz;
  original_date date;
  original_title text;
  blocked boolean;
  item jsonb:='[{"client_id":"trip-date-qa","place_id":"","place_name":"트랜잭션 검수 장소","category":"cafe","start_time":"10:00","duration_minutes":60,"expected_cost":0,"sort_order":0,"memo":"검수 후 롤백","day_index":0,"lng":129.1,"lat":35.1}]';
begin
  if cid is null then raise exception 'test needs existing authenticated member'; end if;
  select revision_id, start_date, title into rev, original_date, original_title
  from public.plans where couple_id=cid and kind='trip';

  -- A single rollback transaction has one now() value. Exercise the timestamp
  -- regression against an already committed active B, whose old token predates
  -- this transaction, rather than newly created fixtures that share that token.
  select updated_at into target_stamp from public.trip_drafts
  where couple_id=cid and scheduled_on=original_date;
  if original_date is not null and target_stamp is not null then
    result:=public.save_couple_plan_atomic('trip','다른 날짜 A 활성화 검수','메모','2098-02-20',2,item,'test',coalesce(rev,0),cid);
    rev:=(result->>'revision')::bigint;
    if (select updated_at from public.trip_drafts where couple_id=cid and scheduled_on=original_date) is distinct from target_stamp then
      raise exception 'unchanged active B snapshot changed its confirmation token';
    end if;
    if (select title from public.trip_drafts where couple_id=cid and scheduled_on=original_date) is distinct from original_title then
      raise exception 'activating A changed the preserved B journey';
    end if;
    result:=public.reschedule_couple_trip(original_date,rev,target_stamp,cid);
    rev:=(result->>'revision')::bigint;
    if exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-02-20')
      or (select title from public.trip_drafts where couple_id=cid and scheduled_on=original_date)<>'다른 날짜 A 활성화 검수' then
      raise exception 'active B to draft A to confirmed B move failed';
    end if;
    raise notice 'PASS: committed active B token survived A activation and confirmed B replacement';
  else
    raise notice 'SKIP: unchanged-active-token regression needs a committed dated active trip snapshot';
  end if;

  -- A server action with a stale app-session couple must fail before any write.
  before_rev:=coalesce(rev,0);
  blocked:=false;
  begin perform public.save_couple_plan_atomic('trip','wrong workspace','','2098-01-13',1,item,'test',before_rev,gen_random_uuid());
  exception when raise_exception then if sqlerrm='WORKSPACE_CHANGED' then blocked:=true; else raise; end if; end;
  if not blocked or coalesce((select revision_id from public.plans where couple_id=cid and kind='trip'),0)<>before_rev then
    raise exception 'stale workspace save accepted or changed revision';
  end if;
  blocked:=false;
  begin perform public.reschedule_couple_trip('2098-01-13',before_rev,null,gen_random_uuid());
  exception when raise_exception then if sqlerrm='WORKSPACE_CHANGED' then blocked:=true; else raise; end if; end;
  if not blocked or coalesce((select revision_id from public.plans where couple_id=cid and kind='trip'),0)<>before_rev then
    raise exception 'stale workspace reschedule accepted or changed revision';
  end if;
  result:=public.save_couple_plan_atomic('trip','날짜 미정 검수','메모',null,2,item,'test',coalesce(rev,0));
  rev:=(result->>'revision')::bigint;
  if (select count(*) from public.trip_drafts where couple_id=cid and scheduled_on is null)<>1 then raise exception 'undated snapshot missing'; end if;

  -- Direct writes cannot bypass atomic snapshots, revision checks or activity.
  blocked:=false;
  begin update public.plans set title='direct write bypass' where couple_id=cid and kind='trip';
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'direct plan update accepted'; end if;
  blocked:=false;
  begin delete from public.plan_items where plan_id=(select id from public.plans where couple_id=cid and kind='trip');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'direct plan item delete accepted'; end if;
  blocked:=false;
  begin update public.plan_items set place_name='direct itinerary change' where plan_id=(select id from public.plans where couple_id=cid and kind='trip');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'direct itinerary column update accepted'; end if;
  update public.plan_items set lng=129.2,lat=35.2
  where plan_id=(select id from public.plans where couple_id=cid and kind='trip') and client_id='trip-date-qa';
  if not found or not exists(select 1 from public.plan_items
    where plan_id=(select id from public.plans where couple_id=cid and kind='trip') and client_id='trip-date-qa' and lng=129.2 and lat=35.2) then
    raise exception 'own-couple coordinate hydration denied';
  end if;

  result:=public.save_couple_plan_atomic('trip','첫 날짜 검수','메모','2098-01-11',2,item,'test',rev);
  rev:=(result->>'revision')::bigint;
  if not exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on is null and title='날짜 미정 검수') then raise exception 'undated previous journey lost'; end if;
  if not exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-11' and items->0->>'placeName'='트랜잭션 검수 장소' and items->0->'coordinates'='[129.1,35.1]'::jsonb) then raise exception 'snapshot shape or coordinates wrong'; end if;
  result:=public.save_couple_plan_atomic('trip','두 번째 날짜 검수','메모','2098-01-12',2,item,'test',rev);
  rev:=(result->>'revision')::bigint;
  if not exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-11' and title='첫 날짜 검수') then raise exception 'previous dated journey lost'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by scheduled_on),'[]') into before_drafts from public.trip_drafts t where couple_id=cid;
  before_rev:=rev;
  blocked:=false;
  begin perform public.save_couple_plan_atomic('trip','실패하면 안 바뀜','','2098-01-13',1,'[{"duration_minutes":"invalid"}]'::jsonb,'test',rev);
  exception when invalid_text_representation then blocked:=true; end;
  if not blocked or (select revision_id from public.plans where couple_id=cid and kind='trip')<>before_rev then raise exception 'failed save changed revision'; end if;
  if (select coalesce(jsonb_agg(to_jsonb(t) order by scheduled_on),'[]') from public.trip_drafts t where couple_id=cid) is distinct from before_drafts then raise exception 'failed save changed snapshots'; end if;
  blocked:=false;
  begin perform public.save_couple_plan_atomic('trip','stale','','2098-01-13',1,item,'test',rev-1);
  exception when raise_exception then if sqlerrm='PLAN_CONFLICT' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'stale save accepted'; end if;
  blocked:=false;
  begin perform public.reschedule_couple_trip('2098-01-11',rev);
  exception when raise_exception then if sqlerrm='TRIP_DATE_OCCUPIED' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'occupied date overwritten without confirmation'; end if;
  result:=public.reschedule_couple_trip('2098-01-13',rev);
  rev:=(result->>'revision')::bigint;
  if exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-12') or not exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-13') then raise exception 'reschedule failed to move snapshot'; end if;
  blocked:=false;
  begin perform public.reschedule_couple_trip('2098-01-11',rev,'2000-01-01');
  exception when raise_exception then if sqlerrm='TRIP_DATE_OCCUPIED' then blocked:=true; else raise; end if; end;
  if not blocked then raise exception 'stale target overwrite accepted'; end if;
  select updated_at into target_stamp from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-11';
  result:=public.reschedule_couple_trip('2098-01-11',rev,target_stamp);
  rev:=(result->>'revision')::bigint;
  if exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-13') or (select title from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-11')<>'두 번째 날짜 검수' then raise exception 'confirmed reschedule failed'; end if;
  result:=public.save_couple_plan_atomic('trip','우리가 고른 여행','','2098-01-11',1,'[]','test',rev);
  if exists(select 1 from public.trip_drafts where couple_id=cid and scheduled_on='2098-01-11') then raise exception 'empty journey persists as phantom'; end if;
  if exists(select 1 from public.trip_drafts where couple_id<>cid) then raise exception 'cross couple snapshot leaked'; end if;
  blocked:=false;
  begin insert into public.trip_drafts(couple_id,scheduled_on) values(cid,'2098-01-14');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'direct snapshot write accepted'; end if;
end $$;
reset role;
set local role anon;
do $$ declare blocked boolean:=false; begin
  begin perform public.reschedule_couple_trip('2098-01-11',0);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'anonymous reschedule accepted'; end if;
end $$;
reset role;
rollback;
select 'PASS: trip snapshots, undated preservation, failed-save rollback, stale revision, explicit reschedule, occupied-date protection, unchanged snapshot tokens (when committed active exists), stale workspace rejection, RPC-only itinerary writes, coordinate hydration, RLS and anonymous access; all test writes rolled back' as verification;
