-- ===========================================================================
--  De eigen AI mag ook meedenken
--
--  De factuurlezer kan sinds 0049 lokaal draaien. De vraag daarna: "eigenlijk
--  voor alles waar we nu ai hebben, laten instellen om de local ai te
--  gebruiken, kijken of dat gaat."
--
--  Er zijn er nog twee:
--
--    melding-gesprek   doorvragen bij een melding, en er een plan van maken
--    trucky            de chatbot op de website
--
--  Waarom dit een tabel is en geen HTTP-adres
--  ------------------------------------------
--
--  Bij de facturen is de richting omgedraaid: niet de cloud belt de pc, maar
--  de pc haalt werk op. Dat moest, want een pc thuis heeft geen adres dat de
--  cloud kan bellen, en een poort openzetten is precies wat je niet wilt.
--
--  Hier speelt hetzelfde, met één verschil: er zit iemand te wachten. Een
--  bezoeker die een vraag stelt, of een monteur die een melding invult. Dus
--  kan het niet "over dertig seconden een keer" -- het antwoord moet er
--  binnen een paar tellen zijn.
--
--  Vandaar deze tabel als postvak. De serverfunctie legt er een opdracht in
--  en kijkt elke paar honderd milliseconden of er antwoord is. De pc hangt
--  aan de andere kant aan een lange lijn (de functie lezer, actie ai-werk):
--  die houdt zijn verzoek open tot er werk is, en geeft het dan meteen door.
--  Zo is de vertraging een fractie van een seconde en zijn het toch maar een
--  paar verzoeken per minuut.
--
--  Wat er NIET in deze tabel hoort
--  -------------------------------
--
--  Persoonsgegevens. De opdracht bevat de tekst die naar het model gaat, en
--  die is er al: de melding die iemand intikte, de vraag van een bezoeker.
--  Maar de rij wordt weggegooid zodra hij beantwoord is (of na een uur), en
--  er zit RLS op zonder één policy: alleen de servicesleutel komt erbij, net
--  als bij exact_koppeling.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het postvak
-- ---------------------------------------------------------------------------

create table if not exists public.ai_opdrachten (
  id          text primary key,
  /* Wie het vroeg: 'melding' of 'trucky'. Alleen voor het logboek en om te
     kunnen zien welk werk blijft liggen. */
  soort       text not null,
  status      text not null default 'wacht'
              check (status in ('wacht', 'bezig', 'klaar', 'mislukt')),
  /* Wat er naar het model gaat. */
  systeem     text not null,
  gebruiker   text not null,
  /* Welk model de server graag wil; de pc mag een ander nemen als hij dat
     niet heeft, en zet dan in gebruikt_model wat het werkelijk werd. */
  model       text,
  gebruikt_model text,
  /* Moet het antwoord geldige JSON zijn? Dan krijgt Ollama een schema mee. */
  schema      jsonb,
  antwoord    text,
  fout        text,
  geclaimd_at bigint,
  klaar_at    bigint,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create index if not exists ai_opdrachten_wacht_idx
  on public.ai_opdrachten (status, created_at);

/*
 * Dicht. Geen enkele policy, net als exact_koppeling: hier staat de vraag van
 * een bezoeker in, en die gaat niemand buiten de server iets aan.
 */
alter table public.ai_opdrachten enable row level security;

-- ---------------------------------------------------------------------------
--  Opruimen
--
--  Een postvak dat niet wordt geleegd is na een jaar een archief van alles
--  wat mensen ooit hebben ingetikt. Beantwoorde opdrachten mogen meteen weg;
--  wat na een uur nog ligt is blijven hangen en heeft geen waarde meer.
--
--  Wordt aangeroepen door de functie lezer bij elke ronde -- geen pg_cron
--  nodig, en het gebeurt dus alleen als er iets draait.
-- ---------------------------------------------------------------------------

create or replace function public.ai_opdrachten_opruimen()
returns integer language plpgsql security definer set search_path = public as $$
declare weg integer;
begin
  delete from public.ai_opdrachten
   where (status in ('klaar', 'mislukt') and klaar_at < public.now_ms() - 60000)
      or created_at < public.now_ms() - 3600000;
  get diagnostics weg = row_count;
  return weg;
end;
$$;

revoke execute on function public.ai_opdrachten_opruimen() from public, anon, authenticated;
grant  execute on function public.ai_opdrachten_opruimen() to service_role;

-- ---------------------------------------------------------------------------
--  De instellingen
--
--  Per plek apart, want ze zijn niet hetzelfde waard. Bij een melding zit
--  iemand van het bedrijf te wachten en mag het best drie tellen duren; bij
--  Trucky staat een chauffeur op een parkeerplaats naar zijn telefoon te
--  kijken en is elke seconde er een.
--
--  Allebei standaard op claude: er verandert niets tot je het zelf omzet.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_ai_melding', 'ai_melding', 'claude',
   'Wie denkt mee bij een melding: "claude", "lokaal" (Ollama op de eigen pc) '
   'of "lokaal-terugval" (lokaal, en Claude als de pc niet op tijd antwoordt).'),
  ('in_ai_trucky', 'ai_trucky', 'claude',
   'Wie de chatbot op de website laat antwoorden: "claude", "lokaal" of '
   '"lokaal-terugval". Let op: hier staat een bezoeker te wachten.'),
  ('in_ai_lokaal_model', 'ai_lokaal_model', 'gemma4:26b',
   'Het Ollama-model voor deze twee. Hoeft geen plaatjes te kunnen lezen; dat '
   'is alleen voor facturen.'),
  ('in_ai_wachttijd', 'ai_wachttijd', '20',
   'Hoeveel seconden de server op de eigen pc wacht voordat hij het opgeeft. '
   'Daarna komt er een nette melding, of Claude bij "lokaal-terugval".')
on conflict (id) do nothing;

comment on table public.ai_opdrachten is
  'Postvak tussen de serverfuncties en de eigen AI op de pc (0051). De '
  'functie legt er een opdracht in en wacht op het antwoord; het programma in '
  'lezer/ haalt hem op via de functie lezer. Rijen worden na afhandeling '
  'weggegooid.';
