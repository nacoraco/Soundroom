# 0003. Trajna tabela opravil za uvoz namesto sinhronih prenosov

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Iskanje in priprava manjkajoče skladbe z `yt-dlp` in FFmpeg lahko trajata več sekund ali minut. Uporabnik mora takoj dobiti odgovor in spremljati stanje, opravilo pa mora preživeti ponovni zagon strežnika. Za enako poizvedbo se ne smejo ustvariti podvojena opravila, dvoumni zadetki pa morajo počakati na pregled urednika.

## Obravnavane alternative

- **Sinhroni uvoz znotraj iskalne zahteve** – preprost tok, vendar blokira zahtevo, lahko poteče in ob napaki ne pušča sledi o napredku.
- **Opravila v pomnilniku procesa** – hitra izvedba, vendar se ob ponovnem zagonu izgubijo in ne omogočajo zanesljivega pregleda ali združevanja.
- **Zunanja vrsta, na primer Redis s sistemom Celery** – robustna rešitev, vendar za študijski projekt prinaša dodatno storitev, konfiguracijo in operativno breme.
- **Trajna tabela opravil v PostgreSQL z ločenim delavcem** – opravila so vidna, trajna in jih je mogoče transakcijsko preverjati ter združevati.

## Odločitev

Izbrana možnost: **tabela `rip_jobs` v PostgreSQL in ločen delavec**, ker že uporabljamo PostgreSQL, opravila pa potrebujejo trajnost, stanja in pregled. Delavec prevzame opravilo iz baze, ga izvede in posodobi stanje; API ob ustvarjanju v transakciji preveri, ali za isto normalizirano poizvedbo že obstaja aktivno opravilo.

## Posledice

- **Pozitivne:** opravila preživijo ponovni zagon; uporabnik vidi stanje in lahko počaka na rezultat; podvojena opravila se združijo; urednik lahko pregleda in potrdi dvoumne zadetke; ni dodatne storitve za vrsto.
- **Negativne:** delavec mora redno poizvedovati po bazi, kar prinaša zakasnitev in obremenitev; potrebno je čiščenje starih opravil; pri zelo velikem številu opravil bi bila namenska vrsta učinkovitejša.
