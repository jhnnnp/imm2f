alter table public.taste_profiles
  add column if not exists date_flow text not null default 'flex'
    check (date_flow in ('meal_first', 'cafe_first', 'flex')),
  add column if not exists drink text not null default 'any'
    check (drink in ('none', 'light', 'any')),
  add column if not exists indoor_play text not null default '';
