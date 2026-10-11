-- Run through an administrative test connection. Existing records are read;
-- every assignment/folder write stays in this transaction and is rolled back.
begin;
set local lock_timeout = '3s';
select set_config('request.jwt.claims', json_build_object('sub',(select m.user_id from public.couple_members m where exists(select 1 from public.couple_notes n where n.couple_id=m.couple_id and n.kind='vault') order by m.user_id limit 1),'role','authenticated')::text,true);
select set_config('only_us.other_couple',(select id::text from public.couples where id <> public.my_couple_id() order by id limit 1),true);
select set_config('only_us.other_folder',gen_random_uuid()::text,true);
insert into public.couple_folders(id,couple_id,scope,name,color)
values(current_setting('only_us.other_folder')::uuid,current_setting('only_us.other_couple')::uuid,'vault','트랜잭션 검수 '||left(gen_random_uuid()::text,8),'sage');
set local role authenticated;
do $verify$
declare
  own_couple uuid := public.my_couple_id();
  folder_a uuid := gen_random_uuid();
  folder_b uuid := gen_random_uuid();
  place_folder uuid := gen_random_uuid();
  ids uuid[];
  place_ids uuid[];
  note_count integer;
  checked integer;
  rejected boolean;
begin
  if own_couple is null then raise exception 'Missing test session'; end if;
  if exists(select 1 from public.couple_folders where id=current_setting('only_us.other_folder')::uuid) then raise exception 'Cross-couple read leak'; end if;
  rejected := false;
  begin
    insert into public.couple_folders(couple_id,scope,name) values(current_setting('only_us.other_couple')::uuid,'vault','불법 폴더');
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Cross-couple write allowed'; end if;
  select array_agg(id) into ids from (select id from public.couple_notes where couple_id=own_couple and kind='vault' order by id limit 2) n;
  select count(*) into note_count from public.couple_notes where couple_id=own_couple and kind='vault';
  insert into public.couple_folders(id,couple_id,scope,name,color) values
    (folder_a,own_couple,'vault','검수 A '||left(folder_a::text,8),'sage'),
    (folder_b,own_couple,'vault','검수 B '||left(folder_b::text,8),'blue'),
    (place_folder,own_couple,'places','검수 장소 '||left(place_folder::text,8),'rose');
  checked := public.move_couple_folder_items('vault',ids,folder_a);
  if checked <> cardinality(ids) or (select count(*) from public.couple_folder_items where folder_id=folder_a) <> cardinality(ids) then raise exception 'Batch assignment failed'; end if;
  rejected := false;
  begin
    perform public.move_couple_folder_items('vault',array[ids[1],gen_random_uuid()],folder_b);
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected or exists(select 1 from public.couple_folder_items where folder_id=folder_b) then raise exception 'Invalid batch not atomic'; end if;
  rejected := false;
  begin perform public.move_couple_folder_items('vault',ids,place_folder);
  exception when invalid_parameter_value then rejected := true; end;
  if not rejected then raise exception 'Wrong scope accepted'; end if;
  rejected := false;
  begin update public.couple_folder_items set scope='places' where folder_id=folder_a;
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Membership scope mutable'; end if;
  rejected := false;
  begin insert into public.couple_folders(couple_id,scope,name) select couple_id,scope,name from public.couple_folders where id=folder_a;
  exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'Duplicate folder name accepted'; end if;
  update public.couple_folders set name='이름 변경 '||left(folder_b::text,8),color='lavender' where id=folder_b;
  perform public.move_couple_folder_items('vault',ids,null);
  if exists(select 1 from public.couple_folder_items where item_id=any(ids)) then raise exception 'Unfiled move failed'; end if;
  perform public.move_couple_folder_items('vault',ids,folder_a);
  delete from public.couple_folders where id=folder_a;
  if exists(select 1 from public.couple_folder_items where folder_id=folder_a) or (select count(*) from public.couple_notes where couple_id=own_couple and kind='vault')<>note_count then raise exception 'Deleting folder lost records'; end if;
  select array_agg(id) into place_ids from (select id from public.places where couple_id=own_couple order by id limit 2) p;
  if place_ids is not null then
    perform public.move_couple_folder_items('places',place_ids,place_folder);
    if (select count(*) from public.couple_folder_items where folder_id=place_folder)<>cardinality(place_ids) then raise exception 'Place assignment failed'; end if;
    delete from public.couple_folders where id=place_folder;
    if (select count(*) from public.places where id=any(place_ids))<>cardinality(place_ids) then raise exception 'Deleting folder lost places'; end if;
  end if;
end;
$verify$;
rollback;
select 'PASS: authenticated RLS, batch atomicity, scope, column permissions, rename, unfiled, deletion preserves notes/places; test writes rolled back' as verification;
