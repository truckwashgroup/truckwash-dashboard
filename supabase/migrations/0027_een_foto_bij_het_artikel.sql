-- ===========================================================================
--  Een foto bij het artikel
--
--  Aan een balie zoek je niet op naam maar op hoe iets eruitziet. Twee flessen
--  ruitenwisservloeistof van hetzelfde merk verschillen in de winter en de
--  zomer een letter in de naam en een kleur op het etiket; wie er de hele dag
--  staat kiest op die kleur, niet op die letter.
--
--  Waarom de foto in de rij staat en niet in een bucket
--  ---------------------------------------------------
--
--  Supabase heeft opslag voor bestanden, en dat is de gewone plek voor een
--  plaatje. Hier niet, om één reden: de kassa moet het zonder internet doen.
--  Een foto achter een URL is een foto die er niet is als de lijn eruit ligt --
--  en dan staat er op het kassascherm een rij grijze vlakken op precies het
--  moment dat het rustig moet blijven werken.
--
--  Een foto in de rij komt mee met dezelfde synchronisatie als de prijs, staat
--  daarna in de lokale cache van elk apparaat, en werkt dus altijd. De prijs
--  daarvan is grootte, en die houden we klein: de kassa verkleint elke foto
--  vóór het opslaan tot een paar tienden van een kilobyte. Zie
--  src/lib/afbeelding.ts in de kassa-app.
--
--  De grens hieronder is de rem daaronder. Zonder die rem zet iemand ooit een
--  foto van vier megabyte in een artikel, en dan sleept elke kassa die bij
--  elke synchronisatie mee.
-- ===========================================================================

alter table public.pos_products
  add column if not exists image text;

/*
 * Een data-URI van maximaal ongeveer 150 kB.
 *
 * Ruim boven wat de kassa maakt (die mikt op 48 kB aan beeldgegevens, wat als
 * base64 zo'n 64 kB wordt), zodat een foto die elders is toegevoegd er ook
 * langs komt. En ruim onder wat een tabel met artikelen zwaar maakt.
 *
 * De controle staat er als NOT VALID: dan geldt hij voor alles wat er vanaf nu
 * in gaat, zonder dat het draaien van deze migratie op een bestaande database
 * kan struikelen over een rij die er al staat. Nieuwe rijen zijn waar het om
 * gaat -- een bestaande te grote foto is een last, geen fout.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pos_products_image_maat'
       and conrelid = 'public.pos_products'::regclass
  ) then
    alter table public.pos_products
      add constraint pos_products_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;
