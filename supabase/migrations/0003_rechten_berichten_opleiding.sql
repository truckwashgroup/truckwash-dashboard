-- ===========================================================================
--  Rechten per persoon, berichten en e-learning
--
--  Draai dit ná 0002. Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Rechten en aansturing op het personeelsdossier
--
--  De rol geeft de basis; grants en revokes zijn de afwijkingen daarop. We
--  slaan alleen die afwijkingen op, zodat een latere wijziging in wat een rol
--  betekent gewoon blijft doorwerken.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists grants        text[] default '{}';
alter table public.profiles add column if not exists revokes       text[] default '{}';
alter table public.profiles add column if not exists supervisor_id text;

create index if not exists profiles_supervisor_idx on public.profiles (supervisor_id);

-- Leidinggevende is een volwaardige rol naast werknemer en management.
create or replace function public.is_supervisor()
returns boolean language sql stable as $$
  select 'supervisor' = any(public.my_roles());
$$;

-- "Leiding" = leidinggevende of management: mag het team overzien.
create or replace function public.is_lead()
returns boolean language sql stable as $$
  select public.is_supervisor() or public.is_management();
$$;

grant execute on function public.is_supervisor(), public.is_lead() to authenticated;

-- is_staff moet de nieuwe rol ook meetellen
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'   = any(public.my_roles())
      or 'supervisor' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  2. Berichten
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id           text primary key,
  to_user_id   text,
  to_role      text check (to_role in ('employee','supervisor','customer','management')),
  kind         text not null default 'info'
               check (kind in ('info','taak','waarschuwing','rooster','opleiding')),
  title        text not null,
  body         text not null default '',
  from_user_id text,
  from_name    text default '',
  created_at   bigint not null,
  read_at      bigint,
  link         text,
  updated_at   bigint not null default public.now_ms(),
  -- Een bericht gaat naar één persoon of naar een rol, niet naar allebei
  constraint notifications_target check (to_user_id is not null or to_role is not null)
);

create index if not exists notifications_user_idx    on public.notifications (to_user_id);
create index if not exists notifications_role_idx    on public.notifications (to_role);
create index if not exists notifications_updated_idx on public.notifications (updated_at);

drop trigger if exists stamp_notifications on public.notifications;
create trigger stamp_notifications before insert or update on public.notifications
  for each row execute function public.stamp_updated_at();

alter table public.notifications enable row level security;

-- Je ziet wat aan jou is gericht, of aan een rol die jij hebt.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or from_user_id = public.my_id()
  );

-- Versturen mag alleen wie leiding geeft.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_lead() and from_user_id = public.my_id());

-- Bijwerken is in de praktijk "gelezen zetten": alleen op je eigen berichten.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or public.is_management()
  )
  with check (
    to_user_id = public.my_id()
    or (to_role is not null and to_role = any(public.my_roles()))
    or public.is_management()
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  3. E-learning
--
--  Lessen en toetsvragen staan als jsonb bij de cursus. Dat houdt een cursus
--  één record, wat het synchroniseren en het offline lezen eenvoudig houdt.
-- ---------------------------------------------------------------------------

create table if not exists public.courses (
  id                text primary key,
  code              text not null,
  title             text not null,
  summary           text default '',
  category          text not null default 'veiligheid'
                    check (category in ('veiligheid','chemie','machine','kwaliteit','klant')),
  estimated_minutes integer not null default 15,
  required_for      text[] not null default '{}',
  valid_months      integer,
  pass_score        integer not null default 75,
  version           integer not null default 1,
  lessons           jsonb not null default '[]'::jsonb,
  quiz              jsonb not null default '[]'::jsonb,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists courses_updated_idx on public.courses (updated_at);

create table if not exists public.course_progress (
  id           text primary key,
  user_id      text not null,
  user_name    text default '',
  course_id    text not null references public.courses(id) on delete cascade,
  started_at   bigint not null default 0,
  lesson_index integer not null default 0,
  completed_at bigint,
  score        integer,
  passed       boolean not null default false,
  attempts     integer not null default 0,
  expires_at   bigint,
  assigned_by  text,
  due_at       bigint,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists progress_user_idx    on public.course_progress (user_id);
create index if not exists progress_course_idx  on public.course_progress (course_id);
create index if not exists progress_updated_idx on public.course_progress (updated_at);

do $$
declare t text;
begin
  foreach t in array array['courses','course_progress'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

alter table public.courses         enable row level security;
alter table public.course_progress enable row level security;

-- Lesmateriaal mag iedereen lezen die bij ons werkt; wijzigen alleen management.
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated
  using (public.is_staff());

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- Je eigen voortgang, en die van je team als je leiding geeft.
drop policy if exists progress_select on public.course_progress;
create policy progress_select on public.course_progress for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (user_id = public.my_id() or public.is_lead());

drop policy if exists progress_update on public.course_progress;
create policy progress_update on public.course_progress for update to authenticated
  using (user_id = public.my_id() or public.is_lead())
  with check (user_id = public.my_id() or public.is_lead());

-- ---------------------------------------------------------------------------
--  4. Leidinggevenden mogen hun team overzien
--
--  Tot nu toe kon alleen het management de uren en bonnen van anderen zien.
--  Een leidinggevende hoort dat voor zijn eigen mensen ook te kunnen.
-- ---------------------------------------------------------------------------

drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (public.is_lead() or user_id = public.my_id());

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_lead() or submitted_by = public.my_id());

-- Het rooster maken mag nu ook de leidinggevende, niet alleen het management.
drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_lead()) with check (public.is_lead());
