-- ===========================================================================
--  Kassasysteem (truckwashPOS)
--
--  De kassa is een tweede app, maar geen tweede administratie: hij praat met
--  dezelfde database als het dashboard. Daardoor is een medewerker één
--  persoon, met één personeelsnummer, één rooster en één urenstaat -- of hij
--  nu in de wasstraat staat of achter de kassa.
--
--  Wat hier bij komt:
--
--   * pos_registers          welke kassa's er zijn, met printer en pinautomaat
--   * pos_products           wat er te koop is: artikelen, wasbeurten, kaarten
--   * pos_sales              de bonnen -- het verkoopjournaal
--   * pos_sale_lines         de regels op een bon
--   * pos_payments           hoe er betaald is; meerdere per bon mag (gemengd)
--   * pos_cash_sessions      de kassadag: lade open, lade dicht, verschil
--   * pos_cash_moves         inleg, afstorting en correcties op de lade
--   * pos_subscriptions      abonnementen en strippenkaarten
--   * pos_subscription_uses  welke bon welke strip heeft gebruikt
--   * pos_pins               de persoonlijke code waarmee iemand aan de kassa
--                            inklokt en verkoopt
--
--  Twee dingen zijn hier bewust anders dan in de rest van het schema:
--
--  1. Een afgerekende bon staat vast. Een trigger weigert wijzigingen aan de
--     bedragen en weigert verwijderen. Corrigeren doe je met een creditbon die
--     naar de oorspronkelijke verwijst. Dat is niet alleen netjes -- de
--     Belastingdienst wil een administratie die je achteraf niet kunt
--     bijschaven.
--
--  2. Het saldo van een strippenkaart wordt niet als getal opgeslagen maar
--     opgeteld uit pos_subscription_uses. Twee kassa's die tegelijk offline
--     een strip afboeken zouden anders elkaars aftrek overschrijven; regels
--     bij elkaar optellen kan niet fout gaan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Hulpfunctie: een los toegekend recht
--
--  De rollen zelf staan in de app (permissions.ts); die kan de database niet
--  narekenen. Wat de database wél kan zien is het losse recht dat het
--  management aan iemand heeft toegekend. Dat is genoeg voor de grove
--  afscherming hieronder; de fijne bepaalt de app.
-- ---------------------------------------------------------------------------

create or replace function public.heeft_recht(recht text)
returns boolean language sql stable security definer set search_path = public as $$
  select recht = any(
    coalesce((select grants from public.profiles where auth_id = auth.uid()), array[]::text[])
  );
$$;

create or replace function public.mag_kassa_beheren()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('pos.manage');
$$;

grant execute on function public.heeft_recht(text) to authenticated;
grant execute on function public.mag_kassa_beheren() to authenticated;

-- ---------------------------------------------------------------------------
--  Kassa's
-- ---------------------------------------------------------------------------

create table if not exists public.pos_registers (
  id           text primary key,
  location_id  text references public.locations(id) on delete set null,
  code         text not null default '',   -- kort en uniek: KAS-UTR-1
  name         text not null default '',
  device       text default '',            -- welk apparaat staat hier
  -- Instellingen van de randapparatuur. Als losse kolommen zou dit tien
  -- velden zijn die per printermodel anders heten; als jsonb blijft het
  -- één ding dat de app begrijpt.
  printer      jsonb not null default '{}'::jsonb,
  terminal     jsonb not null default '{}'::jsonb,
  -- Bonnen worden per kassa doorlopend genummerd, op het apparaat zelf, zodat
  -- het ook zonder internet doorloopt. Dit is de hoogste die de server heeft
  -- gezien; daarmee kan een kassa die opnieuw is ingericht verder tellen in
  -- plaats van opnieuw te beginnen.
  last_seq     bigint not null default 0,
  active       boolean not null default true,
  updated_at   bigint not null default public.now_ms()
);

create unique index if not exists pos_registers_code_key on public.pos_registers (code);

-- ---------------------------------------------------------------------------
--  Artikelen
--
--  De kassa rekent met prijzen inclusief btw. Dat is wat op het bord staat en
--  wat de chauffeur betaalt; het bedrag exclusief volgt eruit. Andersom
--  rekenen geeft bonnen die een cent afwijken van het prijskaartje.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_products (
  id                text primary key,
  -- Leeg = op alle vestigingen te koop.
  location_id       text references public.locations(id) on delete set null,
  code              text not null default '',
  barcode           text,
  name              text not null,
  group_name        text not null default 'Overig',
  unit              text not null default 'stuk',
  price_incl        numeric not null default 0,
  vat_pct           numeric not null default 21,
  kind              text not null default 'artikel'
                    check (kind in ('artikel','wasbeurt','strippenkaart','abonnement','overig')),
  -- Bij kind = wasbeurt: welk type uit de wasstraat-app (buitenwas, combi, ...)
  wash_service      text,
  -- Bij kind = strippenkaart: hoeveel wasbeurten de kaart bevat.
  credits           numeric,
  -- Bij kind = abonnement: hoeveel dagen hij geldig is.
  valid_days        integer,
  -- Verkoop boekt hier voorraad af, als het artikel aan de voorraad hangt.
  inventory_item_id text references public.inventory_items(id) on delete set null,
  -- Plaats op het kassascherm. Lage nummers eerst.
  sort              integer not null default 100,
  color             text,
  active            boolean not null default true,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists pos_products_barcode_idx  on public.pos_products (barcode);
create index if not exists pos_products_location_idx on public.pos_products (location_id);

-- ---------------------------------------------------------------------------
--  Bonnen
-- ---------------------------------------------------------------------------

create table if not exists public.pos_sales (
  id                  text primary key,
  register_id         text references public.pos_registers(id) on delete set null,
  register_code       text not null default '',
  location_id         text references public.locations(id) on delete set null,
  -- Bonnummer zoals het op de bon staat: KAS-UTR-1-20260831-0042
  receipt_no          text not null default '',
  seq                 bigint not null default 0,
  status              text not null default 'open'
                      check (status in ('open','geparkeerd','afgerekend','geannuleerd','gecrediteerd')),
  -- Wie verkocht. Dit is het dossier-id uit profiles, niet het inlogaccount:
  -- aan één kassa werken meerdere mensen met hun eigen code.
  operator_id         text references public.profiles(id) on delete set null,
  operator_name       text not null default '',
  customer_company_id text references public.companies(id) on delete set null,
  customer_name       text default '',
  plate               text default '',
  -- De koppeling met de wasstraat: deze bon rekent die wasopdracht af.
  wash_job_id         text references public.wash_jobs(id) on delete set null,
  total_incl          numeric not null default 0,
  total_excl          numeric not null default 0,
  vat_total           numeric not null default 0,
  discount_incl       numeric not null default 0,
  -- Contant wordt op vijf cent afgerond; het verschil hoort op de bon.
  rounding            numeric not null default 0,
  method              text
                      check (method is null or method in ('contant','pin','op-rekening','abonnement','gemengd')),
  -- Bij een creditbon: welke bon wordt hiermee teruggedraaid.
  credit_of           text references public.pos_sales(id) on delete set null,
  cash_session_id     text,
  opened_at           bigint not null default public.now_ms(),
  closed_at           bigint,
  printed             boolean not null default false,
  note                text,
  updated_at          bigint not null default public.now_ms()
);

create unique index if not exists pos_sales_receipt_key
  on public.pos_sales (register_code, receipt_no)
  where receipt_no <> '';

create index if not exists pos_sales_location_idx on public.pos_sales (location_id, closed_at);
create index if not exists pos_sales_session_idx  on public.pos_sales (cash_session_id);
create index if not exists pos_sales_job_idx      on public.pos_sales (wash_job_id);

create table if not exists public.pos_sale_lines (
  id           text primary key,
  sale_id      text not null references public.pos_sales(id) on delete cascade,
  line_no      integer not null default 1,
  product_id   text references public.pos_products(id) on delete set null,
  name         text not null default '',
  kind         text not null default 'artikel',
  qty          numeric not null default 1,
  price_incl   numeric not null default 0,
  vat_pct      numeric not null default 21,
  discount_pct numeric not null default 0,
  total_incl   numeric not null default 0,
  total_excl   numeric not null default 0,
  vat_amount   numeric not null default 0,
  wash_job_id  text references public.wash_jobs(id) on delete set null,
  note         text,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists pos_sale_lines_sale_idx on public.pos_sale_lines (sale_id);

create table if not exists public.pos_payments (
  id              text primary key,
  sale_id         text not null references public.pos_sales(id) on delete cascade,
  method          text not null
                  check (method in ('contant','pin','op-rekening','abonnement')),
  amount          numeric not null default 0,
  -- Contant: wat er in de lade ging en wat eruit terug moest.
  received        numeric,
  change_given    numeric,
  -- Pin: wat de betaalterminal terugmeldde.
  terminal_ref    text,
  terminal_status text,
  card_brand      text,
  -- Abonnement of strippenkaart waarmee betaald is.
  subscription_id text,
  at              bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists pos_payments_sale_idx on public.pos_payments (sale_id);

-- ---------------------------------------------------------------------------
--  De kassadag
-- ---------------------------------------------------------------------------

create table if not exists public.pos_cash_sessions (
  id             text primary key,
  register_id    text references public.pos_registers(id) on delete set null,
  register_code  text not null default '',
  location_id    text references public.locations(id) on delete set null,
  opened_by      text references public.profiles(id) on delete set null,
  opened_by_name text default '',
  opened_at      bigint not null default public.now_ms(),
  start_float    numeric not null default 0,
  closed_by      text references public.profiles(id) on delete set null,
  closed_by_name text,
  closed_at      bigint,
  -- Wat er geteld is, wat er had moeten zijn, en het verschil. Het verschil
  -- rekenen we uit en slaan we op: bij een controle wil je zien wat er die
  -- dag is vastgesteld, niet wat er nu uit een nieuwe berekening rolt.
  counted        numeric,
  expected       numeric,
  difference     numeric,
  cash_total     numeric not null default 0,
  pin_total      numeric not null default 0,
  invoice_total  numeric not null default 0,
  sales_count    integer not null default 0,
  status         text not null default 'open' check (status in ('open','gesloten')),
  note           text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists pos_cash_sessions_reg_idx
  on public.pos_cash_sessions (register_id, status);

create table if not exists public.pos_cash_moves (
  id         text primary key,
  session_id text not null references public.pos_cash_sessions(id) on delete cascade,
  kind       text not null check (kind in ('inleg','afstorting','correctie')),
  amount     numeric not null,
  reason     text default '',
  user_id    text references public.profiles(id) on delete set null,
  user_name  text default '',
  at         bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists pos_cash_moves_session_idx on public.pos_cash_moves (session_id);

-- ---------------------------------------------------------------------------
--  Abonnementen en strippenkaarten
-- ---------------------------------------------------------------------------

create table if not exists public.pos_subscriptions (
  id            text primary key,
  location_id   text references public.locations(id) on delete set null,
  company_id    text references public.companies(id) on delete set null,
  customer_name text default '',
  plate         text default '',
  -- Scanbare code op de kaart. Hiermee vindt de kassa hem terug.
  code          text not null default '',
  kind          text not null default 'strippenkaart'
                check (kind in ('strippenkaart','abonnement')),
  -- Strippenkaart: hoeveel beurten erop zaten toen hij verkocht werd.
  credits_total numeric not null default 0,
  -- Abonnement: van wanneer tot wanneer hij geldig is.
  valid_from    bigint,
  valid_to      bigint,
  -- Waarvoor hij geldt; leeg = elke wasbeurt.
  wash_service  text,
  sold_sale_id  text references public.pos_sales(id) on delete set null,
  active        boolean not null default true,
  note          text,
  updated_at    bigint not null default public.now_ms()
);

create unique index if not exists pos_subscriptions_code_key
  on public.pos_subscriptions (code) where code <> '';

create table if not exists public.pos_subscription_uses (
  id              text primary key,
  subscription_id text not null references public.pos_subscriptions(id) on delete cascade,
  sale_id         text references public.pos_sales(id) on delete set null,
  credits         numeric not null default 1,
  user_id         text references public.profiles(id) on delete set null,
  user_name       text default '',
  at              bigint not null default public.now_ms(),
  updated_at      bigint not null default public.now_ms()
);

create index if not exists pos_subscription_uses_sub_idx
  on public.pos_subscription_uses (subscription_id);

-- ---------------------------------------------------------------------------
--  De persoonlijke code
--
--  Aan één kassa werken meerdere mensen. Het apparaat is ingelogd met een
--  kassa-account; wie er op dat moment achter staat blijkt uit zijn eigen
--  code of zijn badge. Daarmee klokt hij in, en daarmee komt zijn naam op de
--  bon.
--
--  De code zelf staat hier niet: alleen een PBKDF2-afgeleide met een eigen
--  zout per persoon. De kassa moet die afgeleide kunnen ophalen, want
--  controleren moet ook zonder internet kunnen -- vandaar dat collega's op
--  dezelfde vestiging hem mogen lezen. Een code van zes cijfers is daarmee
--  geen wachtwoord waarmee je bij gegevens komt; het is een ondertekening,
--  zoals een paraaf op een urenlijst. Bij de gegevens kom je met het
--  kassa-account, en dat wachtwoord staat hier nergens.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_pins (
  id          text primary key,
  user_id     text not null references public.profiles(id) on delete cascade,
  salt        text not null,
  hash        text not null,
  iterations  integer not null default 210000,
  -- Scanbare badge, als alternatief voor het intoetsen van de code.
  badge_token text,
  must_change boolean not null default false,
  set_by      text references public.profiles(id) on delete set null,
  updated_at  bigint not null default public.now_ms()
);

create unique index if not exists pos_pins_user_key on public.pos_pins (user_id);
create unique index if not exists pos_pins_badge_key
  on public.pos_pins (badge_token) where badge_token is not null;

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'pos_registers','pos_products','pos_sales','pos_sale_lines','pos_payments',
    'pos_cash_sessions','pos_cash_moves','pos_subscriptions',
    'pos_subscription_uses','pos_pins'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Een afgerekende bon staat vast
--
--  Dit is geen extra slot op de deur maar het slot zelf: zonder dit is de
--  kassa-administratie een lijst die je naderhand kunt bijwerken, en daar
--  heeft een boekhouder niets aan.
--
--  Wat nog wel mag na het afrekenen: het vinkje "afgedrukt" zetten, de status
--  op gecrediteerd zetten en een opmerking toevoegen. Wat niet meer mag:
--  bedragen, betaalwijze, bonnummer, tijdstip en wie het verkocht.
-- ---------------------------------------------------------------------------

create or replace function public.pos_bon_vastzetten()
returns trigger language plpgsql as $$
begin
  if old.status in ('afgerekend','gecrediteerd') then
    if new.total_incl    is distinct from old.total_incl
    or new.total_excl    is distinct from old.total_excl
    or new.vat_total     is distinct from old.vat_total
    or new.discount_incl is distinct from old.discount_incl
    or new.rounding      is distinct from old.rounding
    or new.method        is distinct from old.method
    or new.closed_at     is distinct from old.closed_at
    or new.operator_id   is distinct from old.operator_id
    or new.receipt_no    is distinct from old.receipt_no
    then
      raise exception
        'Bon % is afgerekend en mag niet meer gewijzigd worden. Maak een creditbon.',
        coalesce(nullif(old.receipt_no, ''), old.id);
    end if;

    if new.status not in ('afgerekend','gecrediteerd') then
      raise exception 'Bon % kan niet terug naar %.',
        coalesce(nullif(old.receipt_no, ''), old.id), new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_vast on public.pos_sales;
create trigger pos_sales_vast before update on public.pos_sales
  for each row execute function public.pos_bon_vastzetten();

create or replace function public.pos_bon_niet_wissen()
returns trigger language plpgsql as $$
begin
  if old.status in ('afgerekend','gecrediteerd') then
    raise exception
      'Bon % is afgerekend en mag niet verwijderd worden. Maak een creditbon.',
      coalesce(nullif(old.receipt_no, ''), old.id);
  end if;
  return old;
end;
$$;

drop trigger if exists pos_sales_niet_wissen on public.pos_sales;
create trigger pos_sales_niet_wissen before delete on public.pos_sales
  for each row execute function public.pos_bon_niet_wissen();

-- Regels en betalingen van een afgerekende bon liggen even vast als de bon.
--
-- Toevoegen blijft wel mogelijk: bij het afrekenen komen de bon en zijn
-- regels in dezelfde synchronisatieronde binnen, en de bon gaat voorop. De
-- regels zouden dan tegen een al afgerekende bon aanlopen.
create or replace function public.pos_regel_vastzetten()
returns trigger language plpgsql as $$
declare
  bon_id     text := coalesce(new.sale_id, old.sale_id);
  bon_status text;
begin
  select status into bon_status from public.pos_sales where id = bon_id;
  if bon_status in ('afgerekend','gecrediteerd') and tg_op <> 'INSERT' then
    raise exception 'De bon is afgerekend; regels en betalingen liggen vast.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists pos_sale_lines_vast on public.pos_sale_lines;
create trigger pos_sale_lines_vast before update or delete on public.pos_sale_lines
  for each row execute function public.pos_regel_vastzetten();

drop trigger if exists pos_payments_vast on public.pos_payments;
create trigger pos_payments_vast before update or delete on public.pos_payments
  for each row execute function public.pos_regel_vastzetten();

-- ---------------------------------------------------------------------------
--  Beveiliging op rijniveau
--
--  Grofweg: wie op een vestiging werkt, mag de kassa van die vestiging zien
--  en gebruiken. Prijzen, kaarten en codes zijn voor de leiding. De fijne
--  verdeling (mag deze persoon korting geven? een bon crediteren?) doet de
--  app met de rechten uit permissions.ts -- die kan de database niet
--  narekenen, want daar zitten de rollen in.
-- ---------------------------------------------------------------------------

alter table public.pos_registers         enable row level security;
alter table public.pos_products          enable row level security;
alter table public.pos_sales             enable row level security;
alter table public.pos_sale_lines        enable row level security;
alter table public.pos_payments          enable row level security;
alter table public.pos_cash_sessions     enable row level security;
alter table public.pos_cash_moves        enable row level security;
alter table public.pos_subscriptions     enable row level security;
alter table public.pos_subscription_uses enable row level security;
alter table public.pos_pins              enable row level security;

-- ------------------------------ kassa's -----------------------------------

drop policy if exists pos_registers_select on public.pos_registers;
create policy pos_registers_select on public.pos_registers for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_registers_write on public.pos_registers;
create policy pos_registers_write on public.pos_registers for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

-- ----------------------------- artikelen ----------------------------------

drop policy if exists pos_products_select on public.pos_products;
create policy pos_products_select on public.pos_products for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_products_write on public.pos_products;
create policy pos_products_write on public.pos_products for all to authenticated
  using (public.mag_kassa_beheren())
  with check (public.mag_kassa_beheren());

-- ------------------------------- bonnen -----------------------------------

-- Een klant mag zijn eigen bonnen zien; die komen straks op zijn factuur.
drop policy if exists pos_sales_select on public.pos_sales;
create policy pos_sales_select on public.pos_sales for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or customer_company_id = public.my_company()
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Wijzigen mag; de trigger hierboven bepaalt wat er nog te wijzigen valt.
drop policy if exists pos_sales_update on public.pos_sales;
create policy pos_sales_update on public.pos_sales for update to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Alleen een bon die nooit is afgerekend kan weg -- een geparkeerde bon die
-- niemand meer nodig heeft. De trigger houdt de rest tegen.
drop policy if exists pos_sales_delete on public.pos_sales;
create policy pos_sales_delete on public.pos_sales for delete to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

-- Regels en betalingen volgen hun bon.
drop policy if exists pos_sale_lines_all on public.pos_sale_lines;
create policy pos_sale_lines_all on public.pos_sale_lines for all to authenticated
  using (exists (
    select 1 from public.pos_sales s
     where s.id = pos_sale_lines.sale_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.customer_company_id = public.my_company())))
  with check (exists (
    select 1 from public.pos_sales s
     where s.id = pos_sale_lines.sale_id
       and public.is_staff() and public.in_my_locations(s.location_id)));

drop policy if exists pos_payments_all on public.pos_payments;
create policy pos_payments_all on public.pos_payments for all to authenticated
  using (exists (
    select 1 from public.pos_sales s
     where s.id = pos_payments.sale_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.customer_company_id = public.my_company())))
  with check (exists (
    select 1 from public.pos_sales s
     where s.id = pos_payments.sale_id
       and public.is_staff() and public.in_my_locations(s.location_id)));

-- ----------------------------- kassadag -----------------------------------

drop policy if exists pos_cash_sessions_select on public.pos_cash_sessions;
create policy pos_cash_sessions_select on public.pos_cash_sessions for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_cash_sessions_write on public.pos_cash_sessions;
create policy pos_cash_sessions_write on public.pos_cash_sessions for all to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_cash_moves_all on public.pos_cash_moves;
create policy pos_cash_moves_all on public.pos_cash_moves for all to authenticated
  using (exists (
    select 1 from public.pos_cash_sessions cs
     where cs.id = pos_cash_moves.session_id
       and public.is_staff() and public.in_my_locations(cs.location_id)))
  with check (exists (
    select 1 from public.pos_cash_sessions cs
     where cs.id = pos_cash_moves.session_id
       and public.is_staff() and public.in_my_locations(cs.location_id)));

-- -------------------------- kaarten en abonnementen -----------------------

drop policy if exists pos_subscriptions_select on public.pos_subscriptions;
create policy pos_subscriptions_select on public.pos_subscriptions for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or company_id = public.my_company()
  );

-- Een kaart verkopen is gewoon verkopen; dat mag iedereen aan de kassa.
-- Achteraf de inhoud van een kaart aanpassen is dat niet.
drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_subscriptions_update on public.pos_subscriptions;
create policy pos_subscriptions_update on public.pos_subscriptions for update to authenticated
  using (public.is_lead() or public.mag_kassa_beheren())
  with check (public.is_lead() or public.mag_kassa_beheren());

-- Afboeken is optellen: regels erbij, nooit een saldo overschrijven.
drop policy if exists pos_subscription_uses_select on public.pos_subscription_uses;
create policy pos_subscription_uses_select on public.pos_subscription_uses
  for select to authenticated
  using (exists (
    select 1 from public.pos_subscriptions s
     where s.id = pos_subscription_uses.subscription_id
       and ((public.is_staff() and public.in_my_locations(s.location_id))
            or s.company_id = public.my_company())));

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses
  for insert to authenticated
  with check (public.is_staff());

-- Opnieuw versturen van dezelfde afboeking mag -- dat gebeurt als de eerste
-- poging strandde op een wegvallende verbinding. Die van een ander niet.
drop policy if exists pos_subscription_uses_update on public.pos_subscription_uses;
create policy pos_subscription_uses_update on public.pos_subscription_uses
  for update to authenticated
  using (user_id = public.my_id() or public.is_lead())
  with check (user_id = public.my_id() or public.is_lead());

-- ------------------------------- codes ------------------------------------

-- Collega's op dezelfde vestiging mogen de afgeleide ophalen, anders kan de
-- kassa offline niemand herkennen. Zie de toelichting bij de tabel.
drop policy if exists pos_pins_select on public.pos_pins;
create policy pos_pins_select on public.pos_pins for select to authenticated
  using (
    public.is_staff()
    and exists (
      select 1 from public.profiles p
       where p.id = pos_pins.user_id
         and public.in_my_locations(p.location_id)
    )
  );

-- Je eigen code veranderen mag altijd. Die van een ander alleen als je het
-- personeel of de kassa beheert -- en dan zet je een nieuwe, je leest de
-- oude niet.
drop policy if exists pos_pins_write on public.pos_pins;
create policy pos_pins_write on public.pos_pins for all to authenticated
  using (user_id = public.my_id() or public.is_management() or public.mag_kassa_beheren())
  with check (user_id = public.my_id() or public.is_management() or public.mag_kassa_beheren());
