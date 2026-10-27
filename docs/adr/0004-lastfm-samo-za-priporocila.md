# 0004. Last.fm samo za metapodatke priporočil

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Funkcionalnost »Odkrij podobno« potrebuje povezavo med izbranimi skladbami in podobno glasbo. Predlagane skladbe morajo biti že v lokalni knjižnici, zato priporočilo ne sme biti odvisno od razpoložljivosti zvoka pri zunanji storitvi. Hkrati mora iskanje, predvajanje in upravljanje seznamov delovati tudi, če zunanja storitev ni dosegljiva.

## Obravnavane alternative

- **Spotify ali Apple Music API** – bogati katalogi in priporočila, vendar zahtevajo uporabniške račune, upoštevanje pogojev uporabe in ne ustrezajo predvajanju lastne knjižnice.
- **MusicBrainz ali ListenBrainz** – odprti podatki, vendar manj neposredna podobnost med skladbami in dodatna pravila povezovanja.
- **Lastni model strojnega učenja** – najbolj prilagodljiv, a za MVP prinaša podatke, usposabljanje in vzdrževanje, ki presegajo obseg projekta.
- **Last.fm `track.getSimilar`** – preprosta metoda, ki za izbrano skladbo vrne seznam podobnih skladb z oceno podobnosti.

## Odločitev

Izbrana možnost: **Last.fm samo za metapodatke o podobnih skladbah**, ker metoda `track.getSimilar` omogoča neposredno povezavo z izbranimi izhodiščnimi skladbami. Rezultate primerjamo z lokalnim katalogom in uporabniku ponudimo le skladbe, ki jih lahko takoj predvaja. Ključ API ostane v okolju zalednega sistema in se nikoli ne pošlje brskalniku.

## Posledice

- **Pozitivne:** priporočila so takoj uporabna, ker so omejena na lokalno knjižnico; izpad Last.fm ne ustavi predvajanja, iskanja ali seznamov; integracija je majhna in razumljiva; ni dodatnega modela ali učenja.
- **Negativne:** odvisnost od zunanje storitve, njenih omejitev števila klicev in kakovosti podatkov; manjše pokritje manj znanih izvajalcev; priporočila niso osebno prilagojena; ob nedosegljivosti je funkcija začasno okrnjena.
