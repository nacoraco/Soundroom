# 0006. MP3 kot edini obvezni zvočni format

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Skladbe se nalagajo ročno ali uvažajo z `yt-dlp` in pripravijo z FFmpeg. Predvajanje mora delovati v namiznih brskalnikih in v telefonu z Androidom, kjer se podpora kodekom razlikuje. Prva različica mora omejiti število kombinacij, ki jih je treba preizkusiti in vzdrževati.

## Obravnavane alternative

- **Več formatov brez pretvorbe** (MP3, FLAC, AAC, OGG) – boljša kakovost in manj pretvorbe, vendar večja matrika združljivosti, večja poraba prostora in zapletenejše testiranje.
- **Pretvorba vsakega vnosa v več ciljnih formatov** – prilagodljivo predvajanje, a visoka poraba procesorja in prostora ter daljši uvoz.
- **MP3 kot edini obvezni format** – univerzalna podpora v brskalnikih in napravah, enostaven uvoz in manjši nabor napak.

## Odločitev

Izbrana možnost: **MP3 kot edini obvezni format MVP-ja**, ker je najbolj predvidljivo predvajanje na ciljnih napravah, FFmpeg pa ga zna pripraviti iz uvoženih vsebin. Drugi formati in pretvorbe so načrtovani kot razširitve po prvi delujoči različici, ne kot pogoj zanjo.

## Posledice

- **Pozitivne:** manjša matrika združljivosti in testiranja; predvidljivo predvajanje na namizju in Androidu; enostavnejši uvoz; manjši začetni obseg in jasnejša merila sprejemljivosti.
- **Negativne:** izguba kakovosti pri pretvorbi in omejitve brezizgubnih formatov; uporabniki morajo datoteke po potrebi pretvoriti sami; poznejša podpora dodatnim formatom zahteva spremembo uvoznega in predvajalnega toka.
