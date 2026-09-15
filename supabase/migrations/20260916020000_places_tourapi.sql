-- Allow TourAPI copied places alongside Kakao/manual.

alter table public.places
  drop constraint if exists places_external_source_check;
alter table public.places
  add constraint places_external_source_check
  check (external_source in ('kakao', 'manual', 'tourapi'));
