-- ===========================================================================
--  Leestekens mogen niets blokkeren
--
--  Draai dit ná 0009. Opnieuw draaien mag.
--
--  Wat er misging: `channel_reads` bewaart tot waar iemand een kanaal heeft
--  gelezen. Dat is afgeleide informatie -- een tijdstip, meer niet. Er stond
--  een harde verwijzing naar `channels` op, en die blokkeerde de hele
--  wachtrij zodra het leesteken eerder aankwam dan het kanaal, of zodra het
--  kanaal er om wat voor reden dan ook niet was.
--
--  Een leesteken dat naar een verdwenen kanaal wijst is onschadelijk: je ziet
--  het nergens en het weegt niets. Een leesteken dat het doorzetten van een
--  rooster tegenhoudt is dat wél. Daarom gaat de verwijzing eraf.
--
--  De index blijft staan, en verweesde regels ruimen we op.
-- ===========================================================================

alter table public.channel_reads
  drop constraint if exists channel_reads_channel_id_fkey;

-- Wat er inmiddels los rondzweeft mag weg.
delete from public.channel_reads r
 where not exists (select 1 from public.channels c where c.id = r.channel_id);

create index if not exists reads_channel_idx on public.channel_reads (channel_id);

-- ---------------------------------------------------------------------------
--  Opruimen achteraf
--
--  Verdwijnt er later een kanaal, dan gaan de leestekens ervan mee. Dat deed
--  de verwijzing hiervoor ook, maar dan met het nadeel dat hij ook bij het
--  toevoegen meekeek.
-- ---------------------------------------------------------------------------

create or replace function public.ruim_leestekens_op()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.channel_reads where channel_id = old.id;
  return old;
end;
$$;

drop trigger if exists channels_ruim_leestekens on public.channels;
create trigger channels_ruim_leestekens after delete on public.channels
  for each row execute function public.ruim_leestekens_op();
