-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken
--
--  Migratie 0022 repareerde dit voor expenses, employer_links en agenda_items.
--  Het bleek geen eigenschap van die drie tabellen te zijn maar van de manier
--  waarop de app opslaat, en dus zat het er nog op zes andere.
--
--  Wat er aan de hand is, nog een keer, want het is niet vanzelfsprekend:
--
--  De app stuurt een gewijzigde rij als geheel op, met een upsert. PostgREST
--  maakt daar "insert ... on conflict do update" van. PostgreSQL evalueert bij
--  zo'n opdracht de WITH CHECK van de INSERT-regel, óók als de rij allang
--  bestaat en er alleen wordt bijgewerkt.
--
--  Staat er in die insertregel iets over eigendom -- "je mag alleen namens
--  jezelf melden" -- dan klopt dat bij het aanmaken en klopt het niet meer
--  zodra iemand anders de rij bijwerkt. De ontwikkelaar die een melding
--  afhandelt is niet de melder. De leidinggevende die een wijzigingsverzoek
--  goedkeurt is niet de aanvrager. En de status is dan geen 'open' meer.
--
--  Het gevolg is een foutmelding die over rechten gaat terwijl er niets mis
--  is met de rechten, en een wijziging die in de wachtrij blijft staan.
--
--  De oplossing is dezelfde als in 0022: bestaat de rij al, dan is dit geen
--  aanmaken en gaat de insertregel opzij. Wat er dan wél mag, bepaalt de
--  updateregel -- en die staat er al, ongewijzigd. Er gaat dus geen deur
--  open die dicht hoorde te zijn; de deur die dicht zat was de verkeerde.
--
--  Niet aangeraakt: pos_safe_moves. Daar kan dit niet gebeuren, want een
--  kluisboeking wordt nooit bijgewerkt -- er staat een trigger op die dat
--  weigert. Wat niet wordt bijgewerkt, kan niet over deze val struikelen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Meldingen
--
--  Dit is de fout die gemeld werd. De ontwikkelaar die een melding oppakt,
--  van status verandert of er een reactie op zet, is niet degene die hem heeft
--  gemaakt -- en de insertregel eist dat wel.
-- ---------------------------------------------------------------------------

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    public.rij_bestaat('public.tickets'::regclass, id)
    or reported_by = public.my_id()
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.ticket_messages'::regclass, id)
    or (
      author_id = public.my_id()
      and (
        public.is_developer()
        or exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wijzigingsverzoeken op een dossier
--
--  Deze was gegarandeerd stuk en het is nooit gemeld. De insertregel eist
--  status = 'open' én dat jij de aanvrager bent. Op het moment dat iemand het
--  verzoek goedkeurt is de status geen 'open' meer en is de beslisser niet de
--  aanvrager -- dus faalt precies de handeling waar het verzoek voor bestaat.
-- ---------------------------------------------------------------------------

drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.change_requests'::regclass, id)
    or (
      public.is_lead()
      and aangevraagd_door = public.my_id()
      and status = 'open'
    )
  );

-- ---------------------------------------------------------------------------
--  Werkgevers
--
--  Zelfde verhaal: een aanvraag komt binnen met status 'aangevraagd' op naam
--  van de aanvrager. Zodra het management hem goedkeurt klopt geen van beide
--  voorwaarden meer.
-- ---------------------------------------------------------------------------

drop policy if exists wg_insert on public.employers;
create policy wg_insert on public.employers for insert to authenticated
  with check (
    public.rij_bestaat('public.employers'::regclass, id)
    or public.is_management()
    or (status = 'aangevraagd' and aangevraagd_door = public.my_id())
  );

-- ---------------------------------------------------------------------------
--  Overleg
--
--  Een bericht bijwerken -- een correctie, of het weghalen door iemand die
--  mag modereren -- struikelt over "author_id = mijn id". Een kanaal
--  bijwerken struikelt over de voorwaarden waaronder je er een mag aanmaken.
-- ---------------------------------------------------------------------------

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.chat_messages'::regclass, id)
    or (
      public.is_staff()
      and author_id = public.my_id()
      and public.can_see_channel(channel_id)
    )
  );

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Opleiding
--
--  De minst waarschijnlijke van het stel -- een leidinggevende valt al onder
--  is_lead() -- maar de val zit er wel, en hem hier laten zitten betekent dat
--  iemand er over een half jaar opnieuw achter komt.
-- ---------------------------------------------------------------------------

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (
    public.rij_bestaat('public.course_progress'::regclass, id)
    or user_id = public.my_id()
    or public.is_lead()
  );
