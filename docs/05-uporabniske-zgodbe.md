# Soundroom: uporabniške zgodbe

Dokument pretvarja funkcionalnosti iz [funkcionalnosti in obseg](02-funkcionalnosti-in-obseg.md) v uporabniške zgodbe z merili sprejemljivosti. Vsaka zgodba je označena z `US-XX`, povezana s funkcionalnostjo `F1`–`F13`, določena za eno uporabniško vlogo in preverljiva z merili sprejemljivosti.

Zgodbe sledijo formatu: **Kot [uporabniška vloga] želim [dejanje/cilj], da [razlog/vrednost].**

Zgodbe so zapisane po kriterijih **INVEST**: neodvisne (mogoče jih razvijati in sprejemati ločeno), premagljive (podrobnosti implementacije niso zaprte), vrednostne (vsaka prinaša korist uporabniku), ocenljive in majhne (dovolj majhne za eno iteracijo) ter preverljive (vsako merilo je mogoče konkretno preveriti).

## Uporabniške vloge

| Vloga | Kratek opis |
|---|---|
| **Poslušalec** | Prijavljeni uporabnik, ki išče, posluša in sestavlja svoje sezname predvajanja. |
| **Urednik knjižnice** | Poleg vsega, kar počne poslušalec, nalaga skladbe, ureja metapodatke in potrjuje dvoumne uvoze. |
| **Skrbnik sistema** | Poleg vsega, kar počne urednik, upravlja račune in vloge ter sistemske nastavitve (med drugim samodejni uvoz). |

Funkcionalnosti 1–7 so MVP; zgodbam `US-01`–`US-12` sledijo zgodbe za funkcionalnosti 8–13 (`US-13`–`US-18`), ki so načrtovane za izvedbo po prvi delujoči različici.

## Uporabniške zgodbe za MVP

### US-01: Prijava v aplikacijo

- **Funkcionalnost:** F1 – Prijava, odjava in vloge uporabnikov
- **Vloga:** Poslušalec (velja enako za urednika in skrbnika)
- **Uporabniška zgodba:** Kot poslušalec želim se prijaviti z e-poštnim naslovom in geslom, da dostopam do knjižnice in svojih seznamov predvajanja.
- **Merila sprejemljivosti:**
  1. Prijavni obrazec vsebuje polji za e-poštni naslov in geslo; prijava brez obeh podatkov ni mogoča in obrazec označi manjkajoči polji.
  2. Ob uspešni prijavi uporabnik pristane na strani knjižnice in ostane prijavljen tudi po osvežitvi strani.
  3. Ob napačnem geslu ali neobstoječem računu se prikaže enotno sporočilo »Napačen e-poštni naslov ali geslo«, ne glede na to, kateri podatek je napačen.
  4. Deaktiviran račun se ne more prijaviti; aplikacija prikaže sporočilo, da je račun onemogočen.
  5. Odgovori API-ja ne vsebujejo gesla in njegove zgoščene vrednosti.

### US-02: Ustvarjanje računov in dodeljevanje vlog

- **Funkcionalnost:** F1 – Prijava, odjava in vloge uporabnikov
- **Vloga:** Skrbnik sistema
- **Uporabniška zgodba:** Kot skrbnik želim ustvariti uporabniški račun in mu dodeliti vlogo (poslušalec ali urednik), da uporabniki dostopajo do aplikacije z ustreznimi pravicami.
- **Merila sprejemljivosti:**
  1. Obrazec za novega uporabnika zahteva e-poštni naslov, začasno geslo in izbiro vloge; skrbniška vloga se ne ponuja za izbiro ob ustvarjanju novega računa.
  2. Sistem zavrne račun z e-poštnim naslovom, ki že obstaja, in to izrecno pokaže.
  3. Nov ustvarjeni račun se z začasnim geslom takoj uspešno prijavi.
  4. Skrbnik lahko deaktivira račun; deaktiviran račun ne dobi nove seje, njegove obstoječe seje pa se prekličejo.
  5. Poslušalec in urednik pri dostopu do strani za upravljanje uporabnikov dobita zavrnitev dostopa.

### US-03: Odjava

- **Funkcionalnost:** F1 – Prijava, odjava in vloge uporabnikov
- **Vloga:** Poslušalec (velja enako za urednika in skrbnika)
- **Uporabniška zgodba:** Kot prijavljeni uporabnik želim se odjaviti, da nihče na skupni napravi ne dostopa do mojega računa.
- **Merila sprejemljivosti:**
  1. Gumb za odjavo je dosegljiv iz vsake strani aplikacije.
  2. Po odjavi aplikacija vrne uporabnika na prijavno stran; z osvežitvijo strani prijava neha veljati.
  3. Seja se prekliče tudi v zalednem sistemu; nadaljnje zahteve z odjavljenim žetonom vrnejo napako 401.
  4. Odjava druge uporabnikove seje (druge naprave) ni vplivana.

### US-04: Nalaganje skladbe MP3

- **Funkcionalnost:** F2 – Uvoz glasbe v knjižnico
- **Vloga:** Urednik knjižnice
- **Uporabniška zgodba:** Kot urednik želim naložiti datoteko MP3 v knjižnico, da bo skladba na voljo za iskanje in predvajanje.
- **Merila sprejemljivosti:**
  1. Obrazec za nalaganje sprejme datoteko MP3; izbrana datoteka druge vrste se zavrne s sporočilom o napačni vrsti datoteke.
  2. Sistem preveri dejansko vsebino datoteke (ne samo pripono) in zavrne datoteke, ki niso veljaven MP3.
  3. Sistem zavrne datoteko, večjo od konfigurirane omejitve velikosti, in prikaže največjo dovoljeno velikost.
  4. Če datoteka nima naslova ali izvajalca v metapodatkih, obrazec zahteva njun ročni vnos, preden je uvoz mogoč.
  5. Po uspešnem uvozu se skladba pojavi v iskanju s prebranimi podatki (naslov, izvajalec, album, trajanje).

### US-05: Iskanje po knjižnici

- **Funkcionalnost:** F3 – Iskanje po lokalni knjižnici
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim poiskati skladbo po naslovu ali izvajalcu, da jo hitro najdem in predvajam.
- **Merila sprejemljivosti:**
  1. Iskanje poišče ujemanja v naslovu skladbe in imenu izvajalca, ne glede na velikost črk.
  2. Rezultati prikazujejo naslov, izvajalca, album, trajanje in gumb za predvajanje ter dodajanje v čakalno vrsto.
  3. Delna ujemanja se vrnejo od treh vnesenih znakov dalje.
  4. Če zadetkov ni, se prikaže sporočilo »Ni zadetkov« brez napake.
  5. Rezultati se prikažejo po straneh, največ 20 zadetkov na stran.

### US-06: Pridobitev manjkajoče skladbe

- **Funkcionalnost:** F4 – Samodejni uvoz ob manjkajočem zadetku
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim, da mi iskanje brez zadetkov ponudi pridobitev skladbe in pokaže stanje opravila, da vem, kdaj bo skladba na voljo.
- **Merila sprejemljivosti:**
  1. Možnost pridobitve se pokaže samo, kadar je skrbnik vklopil samodejni uvoz; sicer se pokaže samo sporočilo, da skladbe ni v knjižnici.
  2. Po sprožitvi se prikaže stanje opravila (`queued`, `searching`, `downloading`, `processing`) in se posodablja brez ponovnega nalaganja strani.
  3. Za enako poizvedbo se ponovno uporabi obstoječe aktivno opravilo; novih podvojenih opravil ni.
  4. Ko je opravilo uspešno zaključeno, enako iskanje najde skladbo in jo je mogoče predvajati.
  5. Če opravilo neuspe, se prikaže sporočilo o neuspehu in uporabnik lahko poizkus ponovi.

### US-07: Pregled dvoumnih uvozov

- **Funkcionalnost:** F4 – Samodejni uvoz ob manjkajočem zadetku
- **Vloga:** Urednik knjižnice
- **Uporabniška zgodba:** Kot urednik želim pregledati dvoumne kandidate, popraviti njihov naslov ali izvajalca ter jih potrditi ali zavrniti, da se v knjižnico ne zapolnijo napačne skladbe.
- **Merila sprejemljivosti:**
  1. Dvoumno opravilo v stanju `needs_review` ne prenese in ne objavi skladbe, preden ga urednik ali skrbnik potrdi.
  2. Pregled prikaže poizvedbo uporabnika ter kandidatove podatke: naslov, izvajalca in trajanje.
  3. Urednik lahko pred potrditvijo popravi naslov in izvajalca kandidata.
  4. Po potrditvi se skladba prenese in doda v katalog; po zavrnitvi opravilo ne prenese ničesar in se zaključi kot preklicano.
  5. Poslušalec pri dostopu do pregleda uvozov dobi zavrnitev dostopa.

### US-08: Nastavitve samodejnega uvoza

- **Funkcionalnost:** F4 – Samodejni uvoz ob manjkajočem zadetku
- **Vloga:** Skrbnik sistema
- **Uporabniška zgodba:** Kot skrbnik želim samodejni uvoz vklopiti ali izklopiti ter določiti največjo dolžino skladbe, da nadzorujem, kaj se prenese v knjižnico.
- **Merila sprejemljivosti:**
  1. Nastavitev samodejnega uvoza je privzeto izklopljena.
  2. Sprememba nastavitve velja za vsa nova opravila; že zagnana opravila se ne prekličejo.
  3. Vnos največje dolžine se preveri; neveljavna vrednost (npr. besedilo ali negativno število) se zavre s sporočilom.
  4. Kandidati, ki presegajo dovoljeno največjo dolžino, se izločijo, preden se prenos začne.
  5. Poslušalec in urednik ne moreta spremeniti te nastavitve; zahteve brez skrbniške vloge vrnejo napako.

### US-09: Predvajanje in čakalna vrsta

- **Funkcionalnost:** F5 – Predvajalnik in čakalna vrsta
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim predvajati skladbe s pavzo, premikanjem po skladbi in čakalno vrsto, da poslušam glasbo brez prekinitev.
- **Merila sprejemljivosti:**
  1. Predvajanje, pavza, naslednja in prejšnja skladba se odzovejo takoj po kliku.
  2. Premik po drsniku nadaljuje predvajanje na izbranem mestu v skladbi.
  3. Skladbo je mogoče iz iskanja in iz seznama predvajanja dodati v trenutno čakalno vrsto.
  4. Čakalna vrsta prikaže zaporedje prihajajočih skladb in omogoča njihovo odstranjevanje.
  5. Predvajanje se nadaljuje, tudi ko uporabnik brska po drugih straneh aplikacije.

### US-10: Predvajalnik na telefonu

- **Funkcionalnost:** F5 – Predvajalnik in čakalna vrsta
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim uporabljati predvajalnik na ozkem zaslonu telefona, da poslušam glasbo tudi izven doma.
- **Merila sprejemljivosti:**
  1. Na ozkem zaslonu je predvajalnik prikazan kot spodnja vrstica, ki se razpre v celozaslonski pogled skladbe.
  2. Predvajanje, pavza in preklop skladbe so dosegljivi z enim prstom.
  3. Aplikacijo je v telefonu z Androidom mogoče namestiti kot PWA in zagnati z ikone na začetnem zaslonu.
  4. Postavitev na ozkem zaslonu ne zahteva vodoravnega pomikanja.

### US-11: Osebni seznami predvajanja

- **Funkcionalnost:** F6 – Osebni seznami predvajanja
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim ustvariti lasten seznam predvajanja ter mu dodajati, odstranjevati in prerazporejati skladbe, da sestavim svojo zbirko za poslušanje.
- **Merila sprejemljivosti:**
  1. Ustvarjanje novega seznama zahteva naslov; seznam se takoj pojavi med uporabnikovimi seznami.
  2. Skladbe se na seznam dodajajo iz rezultatov iskanja.
  3. Odstranjena skladba takoj izgine iz seznama; sam seznam in druge skladbe ostanejo.
  4. Prerazporeditev skladb shrani nov vrstni red, ki ohrani po osvežitvi strani in ponovni prijavi.
  5. Poslušalec vidi samo svoje sezname; dostop do tujega zasebnega seznama je zavrnjen.

### US-12: Odkrij podobno

- **Funkcionalnost:** F7 – Seznam »Odkrij podobno«
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim izbrati do tri skladbe iz knjižnice in dobiti seznam podobnih skladb, ki so že v knjižnici, da odkrijem glasbo, ki jo lahko takoj poslušam.
- **Merila sprejemljivosti:**
  1. Izbira izhodišč je omejena na eno do tri skladbe; vmesnik ne dovoli četrte.
  2. Rezultat vsebuje največ 20 skladb in vse so v lokalni knjižnici.
  3. Izhodiščne skladbe in podvojeni zadetki se v rezultatu ne ponovijo.
  4. Predlog je mogoče shrani kot nov osebni seznam predvajanja.
  5. Če ustreznih skladb v knjižnici ni, se prikaže prazno stanje z usmeritvijo na iskanje; priporočilo ne sproži prenosa.

## Uporabniške zgodbe za funkcionalnosti po MVP-ju

### US-13: Priljubljene skladbe in zgodovina poslušanja

- **Funkcionalnost:** F8 – Priljubljene skladbe in zgodovina poslušanja
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim označiti priljubljene skladbe in pregledati zgodovino svojega poslušanja, da hitro najdem glasbo, ki mi je všeč.
- **Merila sprejemljivosti:**
  1. Vsaka skladba ima preklopno oznako »priljubljena«.
  2. Priljubljene skladbe se zberejo na svojem seznamu, ki ga je mogoče predvajati.
  3. Zgodovina prikaže vsako poslušano skladbo z naslovom, izvajalcem in časom poslušanja.
  4. Priljubljene skladbe in zgodovina so vidne samo prijavljenemu uporabniku, ne pa drugim uporabnikom.

### US-14: Strani izvajalcev, albumov in filtri

- **Funkcionalnost:** F9 – Strani izvajalcev in albumov ter napredni filtri
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim brskati po katalogu prek strani izvajalcev in albumov ter filtrirati po letu in oznakah, da odkrijem glasbo tudi brez iskanja po imenu.
- **Merila sprejemljivosti:**
  1. Stran izvajalca prikaže njegove albume in skladbe; stran albuma prikaže vse skladbe albuma.
  2. Katalog je mogoče filtrirati po izvajalcu, albumu, letu in oznakah.
  3. Filtri se kombinirajo; prikazane so samo skladbe, ki ustrezajo vsem izbranim filtrom hkrati.
  4. Če se z izbranimi filtri ne ujema nobena skladba, se prikaže prazno stanje.

### US-15: Deljeni in sodelovalni seznami

- **Funkcionalnost:** F10 – Deljeni in sodelovalni seznami
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim povabiti druge uporabnike k urejanju lastnega seznama, da ga sestavljamo skupaj.
- **Merila sprejemljivosti:**
  1. Lastnik povabi obstoječi račun po e-poštnem naslovu; povabljeni uporabnik dobi pravico urejanja tistega seznama.
  2. Sodelavec deljeni seznam vidi in ureja: dodaja, odstranjuje in prerazporeja skladbe.
  3. Spremembe sodelavca so lastniku vidne po osvežitvi strani.
  4. Lastnik lahko odstrani sodelavca; ta takoj izgubi dostop do seznama.
  5. Sodelavec vidi samo deljeni seznam in ne ostalih zasebnih seznamov lastnika.

### US-16: Scrobbling v ListenBrainz

- **Funkcionalnost:** F11 – Scrobbling v ListenBrainz
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim povezati svoj račun ListenBrainz, da se moja predvajanja beležijo tudi v mojem obstoječem profilu ListenBrainz.
- **Merila sprejemljivosti:**
  1. V nastavitvah uporabnik vnese žeton ListenBrainz; aplikacija preveri veljavnost žetona in pokaže stanje povezave.
  2. Vsako poslušano skladbo aplikacija pošlje ListenBrainz z naslovom in izvajalcem.
  3. Po odklopu povezave se predvajanja ne pošiljajo več.
  4. Če ListenBrainz ni dosegljiv, predvajanje deluje normalno; pošiljanje se tiho ponovno poskusi.

### US-17: Administracija knjižnice

- **Funkcionalnost:** F12 – Boljša administracija knjižnice
- **Vloga:** Skrbnik sistema
- **Uporabniška zgodba:** Kot skrbnik želim pregledati porabo prostora, nastaviti kvote po uporabniku, počistiti začasne datoteke in izvesti varnostno kopijo, da knjižnica deluje zanesljivo.
- **Merila sprejemljivosti:**
  1. Pregled prikaže skupno porabo prostora in porabo po posameznem uporabniku.
  2. Kvote po uporabniku so nastavljive; nalaganje, ki preseže kvoto, se zavre s sporočilom o preseženi kvoti.
  3. Čiščenje začasnih datotek izbriše samo datoteke, ki ne pripadajo aktivnim opravilom uvoza.
  4. Varnostno kopijo kataloga in datotek je mogoče prenesti in iz nje obnoviti vsebino.
  5. Urednik in poslušalec pri dostopu do administracije dobita zavrnitev dostopa.

### US-18: Dodatni formati in poslušanje brez povezave

- **Funkcionalnost:** F13 – Razširjene možnosti predvajanja
- **Vloga:** Poslušalec
- **Uporabniška zgodba:** Kot poslušalec želim poslušati skladbe v drugih zvočnih formatih in prenesti izbrane skladbe v napravo, da glasbo poslušam tudi brez internetne povezave.
- **Merila sprejemljivosti:**
  1. Aplikacija sprejme in predvaja tudi datoteke v formatih FLAC in AAC poleg MP3.
  2. Pri uvozu je mogoče izbrati pretvorbo v MP3; pretvorjena datoteka je predvajljiva.
  3. Skladbo je mogoče označiti za poslušanje brez povezave; označena datoteka se prenese v nameščeno PWA.
  4. Brez povezave so predvajljive samo označene (prenesene) skladbe; neoznačene pokažejo sporočilo o odsotni povezavi.

## Pregled zgodb po funkcionalnostih

| Zgodba | Funkcionalnost | Vloga | MVP |
|---|---|---|---|
| US-01 | F1 Prijava, odjava in vloge | Poslušalec | Da |
| US-02 | F1 Prijava, odjava in vloge | Skrbnik | Da |
| US-03 | F1 Prijava, odjava in vloge | Poslušalec | Da |
| US-04 | F2 Uvoz glasbe | Urednik | Da |
| US-05 | F3 Iskanje | Poslušalec | Da |
| US-06 | F4 Samodejni uvoz | Poslušalec | Da |
| US-07 | F4 Samodejni uvoz | Urednik | Da |
| US-08 | F4 Samodejni uvoz | Skrbnik | Da |
| US-09 | F5 Predvajalnik in čakalna vrsta | Poslušalec | Da |
| US-10 | F5 Predvajalnik in čakalna vrsta | Poslušalec | Da |
| US-11 | F6 Osebni seznami | Poslušalec | Da |
| US-12 | F7 Odkrij podobno | Poslušalec | Da |
| US-13 | F8 Priljubljene in zgodovina | Poslušalec | Ne |
| US-14 | F9 Izvajalci, albumi, filtri | Poslušalec | Ne |
| US-15 | F10 Deljeni seznami | Poslušalec | Ne |
| US-16 | F11 ListenBrainz | Poslušalec | Ne |
| US-17 | F12 Administracija knjižnice | Skrbnik | Ne |
| US-18 | F13 Razširjeno predvajanje | Poslušalec | Ne |
