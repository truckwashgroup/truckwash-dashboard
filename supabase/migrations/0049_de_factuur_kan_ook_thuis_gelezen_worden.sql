-- ===========================================================================
--  De factuur kan ook thuis gelezen worden
--
--  Draai dit ná 0048. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  Elke factuur die per mail binnenkomt gaat nu naar Claude om gelezen te
--  worden. Dat werkt, maar het kost per stuk geld en de bon gaat het huis uit.
--  Casper heeft een pc met een RTX 5090 staan waarop Ollama met gemma4:26b
--  draait, en een proef met hetzelfde systeemprompt las een testfactuur in
--  acht seconden foutloos uit -- IBAN, btw-nummer, KvK en alle regels erbij.
--  Dus mag die pc het ook doen.
--
--  Twee dingen zijn daarbij met opzet zo:
--
--  a. De uitkomst moet DEZELFDE zijn als bij Claude. Daarom leest de pc
--     alleen. Het opschonen, de verkoopcontrole, het indelen en het
--     wegschrijven gebeuren nog steeds op de server, in dezelfde code
--     (supabase/functions/_gedeeld/verwerking.ts). Wie er leest is een
--     instelling; wat er daarna gebeurt niet.
--
--  b. De richting is omgedraaid. Niet de server die de pc belt -- dan moet er
--     op het thuisnetwerk een poort open en een adres bekend zijn -- maar de
--     pc die elke halve minuut bij de server komt vragen of er werk ligt
--     (Edge Function lezer). De pc kent alleen één geheim en praat alleen
--     met die functie en met Ollama op localhost. Geen servicesleutel, geen
--     API-sleutel, geen open poort.
--
--  Wat hier in de database komt: drie kolommen op expenses waarmee de server
--  en de pc het werk overdragen, en de instelling die zegt wie er leest.
--  Geen RLS-wijziging: de functie lezer werkt met de servicesleutel, en de
--  app leest de nieuwe kolommen mee via de bestaande policies op expenses.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De overdracht
--
--    lees_status       wacht    de post heeft hem klaargezet voor de pc
--                      bezig    de pc heeft hem opgehaald (lees_geclaimd_at)
--                      klaar    gelezen en verwerkt
--                      mislukt  de pc kon het niet; de reden staat in de
--                               twijfel van de lezing, zodat de app hem toont
--                      leeg     niet via de pc gegaan (Claude, of van vóór
--                               deze migratie)
--    lees_geclaimd_at  wanneer de pc hem pakte. Staat een bon langer dan
--                      tien minuten op bezig, dan is de pc er halverwege mee
--                      opgehouden en mag de volgende ronde hem opnieuw pakken.
--    lezer             wie las: 'claude', 'claude (terugval)' of
--                      'lokaal: <model>'. Zodat je achteraf kunt zien welke
--                      lezer een fout maakte, als er een gemaakt is.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists lees_status      text;
alter table public.expenses add column if not exists lees_geclaimd_at bigint;
alter table public.expenses add column if not exists lezer            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_lees_status_check') then
    alter table public.expenses
      add constraint expenses_lees_status_check
      check (lees_status is null or lees_status in ('wacht','bezig','klaar','mislukt'));
  end if;
end $$;

comment on column public.expenses.lees_status is
  'Overdracht aan de lokale lezer: wacht (klaargezet), bezig (opgehaald), '
  'klaar (gelezen en verwerkt), mislukt (reden staat in de twijfel van de '
  'lezing). Leeg als de bon niet via de lokale lezer ging.';

comment on column public.expenses.lees_geclaimd_at is
  'Wanneer de lokale lezer de bon pakte (epoch ms). Ouder dan tien minuten op '
  'bezig telt als vastgelopen en mag opnieuw gepakt worden.';

comment on column public.expenses.lezer is
  'Wie de factuur las: claude, claude (terugval) of lokaal: <model>.';

-- ---------------------------------------------------------------------------
--  Wie leest
--
--  Standaard blijft Claude het doen: zonder pc die werk komt halen zou
--  "lokaal" betekenen dat elke bon op wacht blijft staan. De twee sleutels
--  eronder schrijft de functie lezer bij elke ronde, zodat het
--  ontwikkelaarsscherm kan laten zien of de pc er nog is.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_factuur_lezer', 'factuur_lezer', 'claude',
   'Wie een binnengekomen factuur uitleest. "claude": Claude in de cloud, '
   'zoals altijd. "lokaal": alleen de eigen pc met Ollama; is die er niet, '
   'dan blijft de bon op wacht staan. "lokaal-terugval": de eigen pc, en als '
   'die het niet vertrouwt of niet kan lezen alsnog Claude. Wat er ná het '
   'lezen gebeurt is in alle drie de standen hetzelfde.'),
  ('in_lezer_laatst_gezien', 'lezer_laatst_gezien', '',
   'Wanneer de lokale lezer voor het laatst om werk kwam vragen (epoch ms). '
   'Schrijft de functie lezer zelf; niet met de hand aanpassen.'),
  ('in_lezer_model', 'lezer_model', '',
   'Het model dat de lokale lezer de laatste keer opgaf, bijvoorbeeld '
   'gemma4:26b. Schrijft de functie lezer zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De overdracht blijft van de server
--
--  De app schrijft een kostenpost altijd als hele rij terug (goedkeuren is
--  een upsert van alles wat het toestel het laatst zag), en daar zitten deze
--  drie kolommen nu ook in. Keurt iemand een bon goed tussen het moment dat
--  de pc hem op "klaar" zette en de volgende keer dat de app hem ophaalt,
--  dan zou lees_status terug naar "wacht" of "bezig" gaan -- en dan pakt de
--  pc een goedgekeurde bon opnieuw en schrijft de lezing over wat een mens
--  had beoordeeld. Voor gelezen bestaat hiervoor sinds 0029 de trigger
--  lezing_blijft_lezing; die krijgt de drie nieuwe kolommen erbij, met
--  dezelfde regel: wat uit de app komt wordt teruggezet, de server (geen
--  my_id()) mag alles.
-- ---------------------------------------------------------------------------

create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;

  -- De overdracht aan de lokale lezer (0049) is ook van de server.
  new.lees_status      := old.lees_status;
  new.lees_geclaimd_at := old.lees_geclaimd_at;
  new.lezer            := old.lezer;
  return new;
end;
$$;

revoke execute on function public.lezing_blijft_lezing() from public, anon, authenticated;
