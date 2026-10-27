# Soundroom: zasnova rešitve

## Ime rešitve

**Soundroom** je spletna aplikacija za poslušanje glasbe iz osebne knjižnice. Vključuje spletni uporabniški vmesnik in zaledni sistem za uporabnike, katalog, sezname predvajanja in pretakanje skladb. V telefonu z Androidom jo je mogoče namestiti kot progresivno spletno aplikacijo (PWA).

## Namen in problem

Soundroom je namenjen posamezniku ali gospodinjstvu, ki želi do svoje glasbene zbirke dostopati z računalnika ali telefona. Rešuje problem razpršene osebne zbirke, ki je shranjena na različnih napravah: aplikacija uporabnikom omogoča dostop do skupnega kataloga in varno pretaka skladbe prijavljenim uporabnikom.

Aplikacija je namenjena poslušanju glasbe, ki je v osebni knjižnici. Razpoložljivost skladb je odvisna od datotek, ki jih skrbnik naloži ali jih aplikacija uvozi na zahtevo. Priporočila temeljijo na podatkih o podobnosti skladb iz Last.fm, vendar so omejena na skladbe, ki so že na voljo v knjižnici Soundroom.

## Ciljni uporabniki

- **Poslušalec** uporablja aplikacijo doma, v službi ali na poti. Išče skladbe v knjižnici, jih predvaja, sestavlja svoje sezname in lahko dobi predloge na podlagi izbranih skladb.
- **Urednik glasbene knjižnice** skrbi za kakovost kataloga: naloži zvočne datoteke, popravi njihove osnovne podatke in pomaga pri preverjanju nejasnih uvozov.
- **Skrbnik sistema** upravlja aplikacijo, ustvarja uporabniške račune ter odloča, ali se manjkajoče skladbe samodejno iščejo in prenesejo z YouTuba.

Vsi uporabniki dostopajo do istega glasbenega kataloga, osebni seznami predvajanja pa so v prvi različici zasebni in pripadajo posameznemu uporabniku.

## Delovanje rešitve

Skrbnik v aplikaciji ustvari račune in lahko naloži obstoječe datoteke MP3. Poslušalec se prijavi v odzivno spletno aplikacijo, ki knjižnico in uporabniške sezname pridobiva iz zalednega sistema.

Ko poslušalec išče skladbo, sistem najprej išče po lokalnem katalogu. Če je najde, lahko takoj odpre predvajalnik ali jo doda na seznam. Če je ne najde in je skrbnik vklopil nastavitev **Samodejno pridobi ob neuspešnem iskanju**, zaledni sistem ustvari opravilo. Ločen delovni proces išče primeren zadetek z `yt-dlp`, iz zvoka z orodjem FFmpeg pripravi MP3 in posodobi katalog. Uporabnik vidi stanje opravila; če je zadetek dvoumen, ga mora pred objavo potrditi skrbnik. Tako se iskanje ne blokira med prenosom, podvojena opravila pa je mogoče združiti.

Poslušalec lahko izbere eno ali več skladb iz knjižnice kot izhodišče za **Odkrij podobno**. Zaledni sistem prek Last.fm pridobi predloge podobnih skladb, jih poišče v lokalnem katalogu in iz najdenih skladb sestavi predlog seznama. Last.fm v aplikacijo ne prenaša zvočnih datotek in ni storitev za predvajanje.

Predvajalnik predvaja zvok, ki ga zaledni sistem pretaka prijavljenemu uporabniku. V telefonu je spletno aplikacijo mogoče namestiti na začetni zaslon kot PWA. To samo po sebi **ne omogoča Android Auto**; podpora za Android Auto je možna v poznejši fazi z dodatno izvorno Android aplikacijo, ki uporablja isti zaledni sistem.

## Meje prve različice

Prva različica je spletna glasbena aplikacija: uporabniki poslušajo datoteke iz glasbene knjižnice, urejajo svoje sezname ter po želji sprožijo opisani uvoz ob manjkajočem zadetku. Uvožene datoteke in njihove metapodatke upravlja Soundroom; tretje storitve se uporabljajo samo za iskanje predlogov. Podrobni obseg MVP-ja, podatkovni model in tehnična zasnova so opisani v dokumentih [funkcionalnosti in obseg](02-funkcionalnosti-in-obseg.md), [podatkovni model](03-podatkovni-model.md) ter [arhitektura in tehnološki sklad](04-arhitektura-in-tehnoloski-sklad.md).
