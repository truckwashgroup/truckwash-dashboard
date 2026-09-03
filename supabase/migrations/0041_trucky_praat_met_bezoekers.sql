-- ===========================================================================
--  Trucky praat met bezoekers
--
--  Een chatbot op de website, met Claude erachter. Deze tabel bestaat om één
--  reden: de kosten begrenzen.
--
--  Waarom dat hier moet en niet in de browser
--  ------------------------------------------
--
--  Het adres van de chatfunctie staat open -- dat moet ook, anders kan een
--  bezoeker zonder inlog er niet bij. Alles wat de browser meestuurt is dus
--  door diezelfde bezoeker te veranderen: het gespreks-id, het aantal vragen
--  dat hij al gesteld heeft, alles. Een teller in JavaScript houdt niemand
--  tegen die de ontwikkelaarsconsole weet te vinden.
--
--  De teller staat daarom hier, en de functie leest en schrijft hem met de
--  servicesleutel. Wat er in de browser gebeurt is dan hoogstens een
--  vriendelijke waarschuwing vooraf.
--
--  Drie grenzen, en waarom drie
--  ----------------------------
--
--    per gesprek    een bezoeker die doorvraagt is prima; een bezoeker die
--                   honderd keer doorvraagt is geen bezoeker meer.
--    per dag        beschermt tegen het geval dat iemand tienduizend
--                   gesprekken begint. Zonder deze grens is de eerste twee
--                   waardeloos: nieuwe gesprekken zijn gratis te maken.
--    tokens per dag de echte rekening. Vragen tellen zegt weinig -- iemand
--                   die een lap tekst plakt kost meer dan honderd korte
--                   vragen.
--
--  De grenzen zelf staan in de functie en niet hier, zodat bijstellen geen
--  migratie kost.
-- ===========================================================================

create table if not exists public.trucky_gesprekken (
  id              text primary key,
  begonnen_at     bigint not null default public.now_ms(),
  laatst_at       bigint not null default public.now_ms(),
  aantal_vragen   integer not null default 0,
  invoer_tokens   integer not null default 0,
  uitvoer_tokens  integer not null default 0,
  /* Alleen gevuld als de bezoeker om een verslag heeft gevraagd. Zolang dat
     niet gebeurt weten we niet wie er heeft zitten typen, en dat hoort ook zo:
     een chauffeur die vraagt hoe laat Venlo opengaat laat geen adres achter. */
  email           text,
  verslag_at      bigint,
  updated_at      bigint not null default public.now_ms()
);

comment on table public.trucky_gesprekken is
  'Eén rij per chatgesprek op de website. Bestaat om de kosten te begrenzen: '
  'de tellers moeten op de server staan, want het chatadres is openbaar en '
  'alles wat de browser meestuurt is door de bezoeker te veranderen.';

create index if not exists trucky_gesprekken_dag_idx
  on public.trucky_gesprekken (begonnen_at);

-- ---------------------------------------------------------------------------
--  Niemand mag hierbij
--
--  Ook niet wie is ingelogd. Hier staan vragen van bezoekers in, en die zijn
--  van niemand in de organisatie. De functie leest en schrijft met de
--  servicesleutel; die gaat langs de regels heen en heeft er dus geen nodig.
--
--  Row level security AAN met nul regels betekent: dicht voor iedereen.
-- ---------------------------------------------------------------------------

alter table public.trucky_gesprekken enable row level security;
alter table public.trucky_gesprekken force row level security;

revoke all on public.trucky_gesprekken from anon, authenticated;

-- ---------------------------------------------------------------------------
--  Wat er vandaag al is verstookt
--
--  Eén vraag in plaats van drie, en de functie hoeft niet te weten hoe de
--  tabel eruitziet. security definer omdat de tabel voor iedereen dicht staat.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_verbruik_vandaag()
returns table (gesprekken integer, tokens integer)
language sql stable security definer set search_path = public as $$
  select
    count(*)::integer,
    coalesce(sum(invoer_tokens + uitvoer_tokens), 0)::integer
  from public.trucky_gesprekken
  where begonnen_at > (extract(epoch from now()) * 1000)::bigint - 86400000;
$$;

/*
 * Rechten. Zie 0033 en 0034: Postgres geeft het uitvoerrecht op een nieuwe
 * functie aan PUBLIC, en Supabase geeft er anon en authenticated bovenop. Bij
 * een security definer-functie is dat een open deur, dus allebei eraf.
 */
revoke execute on function public.trucky_verbruik_vandaag() from public, anon, authenticated;
grant  execute on function public.trucky_verbruik_vandaag() to service_role;
