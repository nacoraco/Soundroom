# 0002. PostgreSQL za metapodatke in ločena trajna shramba za zvok

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Uporabniki, seznami predvajanja, opravila uvoza in metapodatki skladb so med seboj povezani in jih je treba hraniti transakcijsko. Zvočne datoteke so velike, ne spreminjajo se pogosto in jih je treba predvajati s preskakovanjem po skladbi. Lokacija gostovanja ni vnaprej določena, zato mora biti rešitev prenosljiva med lokalnim okoljem in produkcijo.

## Obravnavane alternative

- **SQLite in datoteke v lokalnem imeniku** – najpreprostejša nastavitev, vendar omejena sočasnost pisanja, šibkejše upravljanje vlog in manj možnosti za produkcijsko delovanje.
- **PostgreSQL s shranjevanjem zvoka v bazi** – zagotavlja transakcijsko skladnost, vendar poveča bazo in varnostne kopije ter oteži učinkovito pretakanje velikih datotek.
- **PostgreSQL za metapodatke in ločena trajna shramba za zvok** – baza ostane majhna in relacijsko dosledna, datoteke pa se hranijo v shrambi, prilagojeni okolju.

## Odločitev

Izbrana možnost: **PostgreSQL za metapodatke in ločena trajna shramba za zvočne datoteke**, ker so poizvedbe in povezave med entitetami relacijske narave, velike binarne datoteke pa v bazi ne prinašajo koristi. V lokalnem okolju je shramba trajni Docker volumen, v drugih okoljih pa trajni datotečni volumen ali ustrezno prilagojen objektni pomnilnik.

## Posledice

- **Pozitivne:** relacijska celovitost in zmogljive poizvedbe; baza in mediji se varnostno kopirata ločeno; pretakanje HTTP Range je neposredno in učinkovito; shrambo je mogoče zamenjati brez spremembe podatkovnega modela.
- **Negativne:** treba je usklajevati dve shrambi, zato lahko ob napaki nastanejo osirotele datoteke ali nedosegljive skladbe; poti in pravice dostopa morajo biti pravilno nastavljene v vsakem okolju; ni skupne transakcije med bazo in datotekami.
