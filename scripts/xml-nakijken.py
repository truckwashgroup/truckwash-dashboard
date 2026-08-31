"""
Controleert de XML van het Android-project.

Waarom dit bestaat: een bouw van een uur wachten om te ontdekken dat er een
streepje te veel in een commentaar staat, is een uur weg. Dit doet dezelfde
controle in een halve seconde.

    python scripts/xml-nakijken.py

Wat het opvangt, en waarom dat opvalt:

  * De tekens `--` binnen een XML-commentaar. Die zijn verboden -- de parser
    kan niet zien waar het commentaar eindigt. In het Nederlands is `--` een
    gedachtestreepje en in CSS begint een variabele ermee, dus het glipt er
    makkelijk in. Gradle meldt het pas bij mergeResources, met een
    SAXParseException en een stapel Java eronder die niet vertelt in welk
    bestand het misging.

  * Alles wat verder ongeldig XML is: een tag die niet sluit, een aanhalings-
    teken dat ontbreekt.
"""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

WORTEL = Path(__file__).resolve().parent.parent

# Alleen wat wij zelf schrijven of aanpassen. De gegenereerde mappen slaan we
# over: daar staat een kopie van de webbundel in.
OVERSLAAN = ('build', '.gradle', 'assets/public', 'capacitor-cordova-android-plugins')

COMMENTAAR = re.compile(r'<!--(.*?)-->', re.S)


def bestanden():
    android = WORTEL / 'android'
    if not android.is_dir():
        return []
    return [
        p for p in android.rglob('*.xml')
        if not any(deel in str(p).replace('\\', '/') for deel in OVERSLAAN)
    ]


def main():
    fouten = []
    aantal = 0

    for pad in bestanden():
        aantal += 1
        tekst = pad.read_text(encoding='utf-8')
        kort = pad.relative_to(WORTEL).as_posix()

        for commentaar in COMMENTAAR.finditer(tekst):
            body = commentaar.group(1)
            if '--' in body:
                regel = tekst[:commentaar.start()].count('\n') + 1
                stuk = next(
                    (r.strip() for r in body.split('\n') if '--' in r), body.strip())
                fouten.append(
                    f'{kort}:{regel}  de tekens -- staan in een commentaar\n'
                    f'    {stuk[:90]}')

        try:
            ET.fromstring(tekst)
        except ET.ParseError as e:
            fouten.append(f'{kort}  is geen geldig XML: {e}')

    if not fouten:
        print(f'\n{aantal} XML-bestanden nagekeken, alles in orde.\n')
        return 0

    print(f'\n{aantal} XML-bestanden nagekeken, {len(fouten)} probleem(en):\n')
    for f in fouten:
        print('  ' + f)
    print()
    return 1


if __name__ == '__main__':
    sys.exit(main())
