-- New couple spaces start empty. Remove only the exact legacy demo rows.

drop function if exists public.seed_demo_places(uuid, uuid);

delete from public.places
where external_source = 'manual'
  and external_place_id is null
  and (name, lng, lat) in (
    ('카페 라파르', 126.7086, 35.9879),
    ('초원사진관', 126.7108, 35.9892),
    ('은파호수공원', 126.6894, 35.9553),
    ('이성당', 126.7116, 35.9871),
    ('마리서사', 126.7049, 35.9898),
    ('한주옥', 126.7082, 35.9906)
  );
