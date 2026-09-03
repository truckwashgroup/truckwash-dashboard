# Prompt voor de kassa-sessie: artikelen van Trucksupply

Plak onderstaande tekst in de Claude-sessie van het kassaproject (`truckwashPOS`).
Alles wat de kassa moet weten staat erin; er hoeft niets uit het dashboard
gekopieerd te worden.

---

In het dashboard (repo `../dashboard`, dezelfde Supabase-database) is een
dashboard voor de leverancier **Trucksupply** gebouwd. Zij beheren vanaf nu de
artikelen die op de vestigingen verkocht en verbruikt worden, en die artikelen
moeten in de kassa terechtkomen zonder dat iemand ze daar nog eens intypt.

## Wat er aan de databasekant is veranderd (migratie 0048, al gedraaid)

Aan `public.inventory_items` (de voorraad per vestiging, die de kassa al leest
als `inventory` en waarop verkoop voorraad afboekt via
`pos_products.inventory_item_id`) zijn kolommen toegevoegd:

| kolom | betekenis |
|---|---|
| `sku` | artikelnummer van Trucksupply |
| `omschrijving` | korte tekst voor op het scherm |
| `image` | foto als data-URI, max ~150 kB, dezelfde regel als `pos_products.image` |
| `bestelhoeveelheid` | hoeveel er per keer wordt meegestuurd |
| `inkoopprijs` | wat Trucksupply rekent (intern; niet op het kassascherm) |
| `actief` | uitgezet artikel hoort niet meer in de kassa te staan |
| `exact_code` | artikelcode in Exact, voor later |

Er is **niets veranderd aan `pos_*`**: geen kolommen, geen policies. Trucksupply
schrijft in `pos_products` via één security-definer-functie:

```sql
public.supply_artikel_naar_kassa(item_id text, prijs_incl numeric, groep text) returns text
```

Die maakt of werkt de `pos_products`-rij bij met `inventory_item_id = item_id`,
`kind = 'artikel'`, `name`/`unit`/`image`/`location_id` uit het artikel,
`price_incl`, `group_name = groep`, `active = artikel.actief`, en geeft het
product-id terug. Een tweede aanroep werkt dezelfde rij bij, er komt geen
tweede rij.

## Wat de kassa moet doen

1. **Niets breken.** De kassa haalt `pos_products` en `inventory_items` al op;
   controleer dat de nieuwe kolommen op `inventory_items` gewoon meekomen
   (`toCamel`) en dat het `InventoryItem`-type in `gedeeldeTypes.ts` de velden
   `sku?`, `omschrijving?`, `image?`, `bestelhoeveelheid?`, `inkoopprijs?`,
   `actief?`, `exactCode?` kent. Rapporteer die typewijziging; kopieer geen
   hele bestanden uit het dashboard.

2. **Een artikel dat Trucksupply uitzet, verdwijnt van het kassascherm.** De
   RPC zet `pos_products.active = false`; controleer dat de kassa `active`
   respecteert in de productraster (waarschijnlijk al zo) en dat een verkoop
   van een inactief artikel in de wachtrij niet vastloopt.

3. **Foto uit het artikel als er geen eigen productfoto is.** Toon in de kassa
   `pos_products.image` en val terug op `inventory_items.image` van het
   gekoppelde artikel (via `inventoryItemId`). Zo staat de foto die Trucksupply
   toevoegde meteen op de kassa zonder dat Beheer hem nog eens hoeft te zetten.

4. **Voorraadstand op het scherm.** Bij een artikel dat aan de voorraad hangt:
   toon de stand en kleur hem als hij onder `min_stock` staat (Trucksupply
   krijgt daar automatisch een mail van; de balie hoeft niets te doen, maar
   ziet zo wel waarom iets niet te verkopen is).

5. **Beheer in de kassa blijft werken, maar waarschuwt.** In `Beheer.tsx`:
   bij een product met `inventoryItemId` een regel "Dit artikel wordt beheerd
   door Trucksupply; naam, foto en eenheid komen daarvandaan" en de velden
   naam/eenheid/foto alleen-lezen. Prijs, groep, kleur en volgorde blijven in
   de kassa aanpasbaar, want dat is kassawerk.

6. **Geen nieuwe pos_*-tabellen of -kolommen** voor dit werk. Heb je toch iets
   nodig aan de databasekant, zeg dan precies wat en waarom; dat gaat via een
   migratie in de dashboard-repo, want daar staat het schema.

Draai daarna de zelftest van de kassa en meld wat er is veranderd aan de
gedeelde typen.
