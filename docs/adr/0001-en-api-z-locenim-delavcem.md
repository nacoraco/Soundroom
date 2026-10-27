# 0001. En zaledni API z ločenim delavcem namesto mikroservisov

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Soundroom potrebuje zaledje za prijavo in vloge, katalog, sezname predvajanja, pretakanje zvoka, priporočila in uvoz manjkajočih skladb. Uvoz je dolgotrajen in lahko traja dlje od spletne zahteve. Rešitev mora biti razumljiva, preizkušljiva in v lokalnem okolju zagnana z enim ukazom, hkrati pa dolgotrajno delo ne sme blokirati API-ja.

## Obravnavane alternative

- **Mikroservisi** (ločeni servisi za avtentikacijo, katalog, pretakanje in uvoz) – omogočajo neodvisno skaliranje, vendar prinašajo operativno kompleksnost, več deploymentov, porazdeljene transakcije in zahtevnejše lokalno okolje.
- **En monolit s sinhronim uvozom** – najpreprostejša postavitev, vendar zahteve za uvoz blokirajo delovni proces, lahko potečejo in ob ponovnem zagonu izgubijo napredek.
- **En API in ločen delavec** – skupna koda in podatkovni model, API ostane odziven, dolgotrajna opravila prevzame ločen proces.

## Odločitev

Izbrana možnost: **en FastAPI API in ločen Python delavec**, ker oba dela potrebujeta isti podatkovni model in validacije, ločen delavec pa prepreči, da bi uvoz blokiral spletne zahteve. Oba procesa se povežeta na isto bazo in shrambo, zato za prvo različico ne potrebujemo dodatnega sporočilnega sistema.

## Posledice

- **Pozitivne:** manj komponent za razvoj in nameščanje; skupna koda zmanjša podvajanje pravil; delavec je izoliran od časovnih omejitev HTTP-zahtev; en jezik in ena baza omogočata predvidljiv vzdrževalni odtis.
- **Negativne:** API in delavec se skalirata skupaj; monolit s časom raste in zahteva disciplino pri mejah modulov; delavec mora biti v produkciji zagnan ločeno, kar je dodatna nastavitev.
