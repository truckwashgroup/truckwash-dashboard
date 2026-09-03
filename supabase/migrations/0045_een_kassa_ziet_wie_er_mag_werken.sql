-- ===========================================================================
--  Een kassa ziet wie er bij hem mag werken
--
--  De kassa gaat afdwingen dat iemand alleen aanmeldt op de vestiging waar hij
--  staat -- wie op Asten staat, mag de kassa van Asten en verder geen enkele.
--  Wie overal mag werken, mag elke kassa.
--
--  Dat tweede deel werkte niet, en niet door de kassa maar door deze regel:
--
--      profiles_select:  auth_id = auth.uid()
--                        or sees_all_locations()
--                        or (is_staff() and in_my_locations(location_id))
--
--  sees_all_locations() gaat over wie kíjkt, niet over wie bekeken wordt. Een
--  kassa in Asten ziet dus: zijn eigen dossier, iedereen op Asten, en iedereen
--  zonder vestiging (want in_my_locations(null) is waar). Iemand van het
--  kantoor die overal mag werken staat op de vestiging van het kantoor -- en
--  die is voor de kassa in Asten onzichtbaar. Zijn nummer staat niet in de
--  cache, dus "dat personeelsnummer is niet bekend op deze vestiging".
--
--  Met één vestiging viel dat niet op. Met achttien wel.
--
--  Waarom dit alleen voor een kassa geldt
--  -------------------------------------
--
--  Een dossier bevat meer dan een naam: telefoonnummer, uurloon, aantekeningen.
--  Zou deze regel voor iedereen gelden, dan zag elke werknemer op elke
--  vestiging het dossier van iedereen die overal mag werken. Dat is een prijs
--  die niemand gevraagd heeft.
--
--  Een apparaataccount is wat anders. Dat is geen mens die rondkijkt maar een
--  kassa die moet weten wie er voor hem staat, en het is nodig voor precies
--  één ding: een nummer of een badge herkennen.
--
--  Wat er niet mee opgelost is
--  ---------------------------
--
--  De kassa haalt hele dossierrijen op en bewaart die in zijn eigen cache. Er
--  staat vanaf nu dus ook het uurloon van het kantoor op een tablet achter de
--  balie. Dat was al zo voor iedereen op die vestiging; dit maakt de kring
--  groter en niet anders. De echte oplossing is dat de kassa een smalle
--  weergave leest met alleen wat hij nodig heeft -- naam, nummer, rollen,
--  vestiging -- en dat is een eigen klus. Zolang die er niet is, hoort dit
--  hardop te staan.
-- ===========================================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    auth_id = auth.uid()
    or public.sees_all_locations()
    or (public.is_staff() and public.in_my_locations(location_id))
    /*
     * En dit is nieuw: een kassa mag zien wie er bij hem mag werken.
     *
     * Twee gevallen, en ze volgen precies de regel die de kassa daarna zelf
     * toetst (magOpKassa in src/lib/code.ts):
     *
     *   all_locations   deze persoon mag overal werken, dus ook hier
     *   manages         hij heeft leiding over de vestiging van deze kassa
     */
    or (
      public.is_apparaataccount(auth.uid())
      and (
        coalesce(all_locations, false)
        or (manages is not null and manages && public.my_locations())
      )
    )
  );
