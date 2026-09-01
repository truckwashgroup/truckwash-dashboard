-- ===========================================================================
--  Gewone facturen stonden als verdacht in de postbus
--
--  De bijlagecontrole hield een PDF tegen zodra er /OpenAction, /AA,
--  /EmbeddedFile of /RichMedia in stond. Dat leek redelijk en was het niet:
--
--    /OpenAction   staat in bijna elke PDF uit Word, InDesign of LaTeX en zet
--                  meestal alleen de beginweergave
--    /AA           hangt aan de formuliervelden van elke invulbare factuur
--    /EmbeddedFile is juist het kenmerk van een ZUGFeRD- of Factur-X-factuur:
--                  de Europese e-factuur met de gegevens als XML erin
--
--  Gevolg was dubbel. De bijlage ging op slot in het scherm, dus niemand kon
--  de factuur bekijken. En de AI las hem ook niet, want die sloeg alles over
--  wat niet 'schoon' was. Precies bij de bon die aandacht vroeg gebeurde er
--  dus niets, zonder dat iemand zag waarom.
--
--  De controle zelf is aangepast (supabase/functions/ontvang-mail/controle.ts).
--  Maar wat er al is binnengekomen draagt die uitkomst met zich mee, en dat
--  repareert zichzelf niet. Deze migratie haalt de uitkomst weg bij precies
--  die vier redenen -- niet bij alle verdachte bijlagen, want JavaScript en
--  /Launch blijven een reden om iets tegen te houden.
--
--  Zonder uitkomst geldt een bijlage als "van vóór de controle": hij gaat open
--  met een waarschuwing erbij. Dat is wat we willen -- niet stilletjes op
--  schoon zetten, want gecontroleerd is hij niet.
-- ===========================================================================

do $$
declare
  geraakt integer;
begin
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'mailbox') then
    return;
  end if;

  /*
   * De bijlagen staan als jsonb-array op het bericht. Uitpakken, de regels
   * bijwerken die het betreft, en weer inpakken -- met behoud van de volgorde,
   * want die bepaalt welke bijlage het scherm als eerste toont.
   */
  with geraakte as (
    select
      m.id,
      jsonb_agg(
        case
          when b.waarde ->> 'controle' = 'verdacht'
           and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
          then (b.waarde - 'controle' - 'controleReden' - 'controleOp')
               || jsonb_build_object(
                    'controleHersteld',
                    'De bijlagecontrole hield dit bestand eerder tegen om een reden die '
                    || 'niet klopte. Hij is nooit opnieuw nagekeken.')
          else b.waarde
        end
        order by b.volgnr
      ) as nieuw
      from public.mailbox m
      cross join lateral jsonb_array_elements(m.attachments)
                 with ordinality as b(waarde, volgnr)
     where m.attachments is not null
       and jsonb_typeof(m.attachments) = 'array'
     group by m.id
    having bool_or(
      b.waarde ->> 'controle' = 'verdacht'
      and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
    )
  )
  update public.mailbox m
     set attachments = g.nieuw
    from geraakte g
   where g.id = m.id;

  get diagnostics geraakt = row_count;
  raise notice 'Bijlagen vrijgegeven op % berichten', geraakt;
end $$;
