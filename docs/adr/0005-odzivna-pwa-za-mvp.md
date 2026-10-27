# 0005. Odzivna PWA kot edini odjemalec za MVP

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Aplikacijo je treba uporabljati na namiznem računalniku in v telefonu z Androidom. Prva različica mora biti izvedljiva z omejenimi viri, namestitev na začetni zaslon pa naj uporabniku približa izkušnjo aplikacije. Podpora za Android Auto ni del MVP-ja in je predvidena šele v poznejši fazi.

## Obravnavane alternative

- **Izvorna Android aplikacija in ločen spletni odjemalec** – najboljši dostop do sistemskih funkcij, vendar dva odjemalca, dvojno delo in ločeno izdajanje.
- **Ločena mobilna spletna različica** – prilagojena zaslonom, a podvaja vmesnik in povečuje stroške vzdrževanja.
- **Samo namizni spletni vmesnik** – najmanj dela, vendar ne ustreza uporabi na telefonu.
- **Odzivna PWA** – ena koda za oba zaslona, namestitev na začetni zaslon in uporaba Media Session API-ja.

## Odločitev

Izbrana možnost: **odzivna progresivna spletna aplikacija**, ker ena koda pokrije namizni brskalnik in telefon, namestitev na Androidov začetni zaslon pa zadosti osnovni mobilni uporabi brez ločene izvorne aplikacije. Predvajalnik uporablja `HTMLAudioElement` in Media Session API, servisni delavec in manifest pa omogočata namestitev.

## Posledice

- **Pozitivne:** en uporabniški vmesnik in ena ekipa za obe napravi; hitrejše izdajanje; namestitev brez trgovine aplikacij; osnova za poznejše delovanje brez povezave; manjši začetni obseg.
- **Negativne:** omejitve brskalnika in razlike med napravami; ni globoke integracije z Androidom ali Android Auto; servisni delavec in predpomnjenje prinašata dodatno kompleksnost; na nekaterih brskalnikih je namestitev omejena.
