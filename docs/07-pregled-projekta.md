# Uspešno implementirane MVP funkcionalnosti

1. Prijava, odjava in vloge uporabnikov – skrbnik ustvari račune. Zaledje pa nam pri vsaki zaščiteni zahtevi preveri vlogo in dovoljenja uporabnika.

2. Uvoz glasbe v knjižnico – skrbnik ali listener lahko naloži MP3. Sistem pa preveri dejanski format, omejitev velikosti in prebere metapodatke. Če manjkajo metapodatki, ju uporabnik mora vnest pred uvozom.

3. Iskanje po lokalni knjižnici – Poslušalec ima možnost iskanja skladbe po naslovu ali izvajalcu in rezultate takoj predvaja.

4. Samodejni uvoz ob manjkajočem zadetku – Ob vklopljeni nastavitvi (privzeto izklopljena) se nam prikaže do osem YouTube izdaj. Uporabnik izbere izdajo z Play ali + Queue.

5. Dodana sta bila predvajalnik in čakalna vrsta, ki omogočata predvajanje, pavzo, premik po skladbi, naslednjo/prejšno skladba in dodajanje v čakalno vrsto.

6. Omogočeno je tudi ustvarjanje osebnih seznamov predvajanja – poslušalec lahko ustvari zaseben seznam ter dodaja, odstranjuje in prerazporeja skladbe iz knjižnice.


# Preverjanje skladnosti 5 implementacij z uporabniškimi zgodbami

V tem pregledu je preverjenih pet uporabniških zgodb iz MVP sklopa (US-01, US-02, US-05, US-09, US-11). Za vsako zgodbo je ugotovljeno, ali so implementirane funkcionalnosti zadostne za izpolnitev meril sprejemljivosti.

---

## US-01: Prijava v aplikacijo

**Funkcionalnost:** F1 – Prijava, odjava in vloge uporabnikov

**Implementirano:** Da. Sistem avtentikacije je vzpostavljen; skrbnik ustvari račune, zaledni sistem pri vsaki zaščiteni zahtevi preverja vlogo in dovoljenja.

**Preverjanje meril:**

| Merilo | Status | Opomba |
|---|---|---|
| 1. Prijavni obrazec z e-pošto in geslom, označitev manjkajočih polj | Ustreza | Obrazec za prijavo je implementiran. |
| 2. Po prijavi preusmeritev na knjižnico, seja vztraja po osvežitvi | Ustreza | Seja je vzpostavljena in vzdrževana. |
| 3. Enotno sporočilo ob napačnih podatkih | Ustreza | Preverjanje vloge in dovoljenj je del zalednega sistema. |
| 4. Deaktiviran račun se ne more prijaviti | Ustreza | Deaktivacija računa je podprta; sistem prikaže sporočilo o onemogočenem računu. |
| 5. Odgovori API-ja ne vsebujejo gesla | Ustreza | Avtentikacijski sistem ne razkriva gesel. |

**Sklep:** Zgodba US-01 je v celoti podprta z implementacijo. Vsa merila sprejemljivosti so izpolnjena.

---

## US-02: Ustvarjanje računov in dodeljevanje vlog

**Funkcionalnost:** F1 – Prijava, odjava in vloge uporabnikov

**Implementirano:** Da. Skrbnik ustvari uporabniški račun in mu dodeli vlogo (poslušalec ali urednik); zaledni sistem preverja vlogo in dovoljenja pri vsaki zaščiteni zahtevi.

**Preverjanje meril:**

| Merilo | Status | Opomba |
|---|---|---|
| 1. Obrazec zahteva e-pošto, začasno geslo in izbiro vloge; skrbniška vloga se ne ponuja | Ustreza | Obrazec za novega uporabnika je implementiran z izbiro vloge poslušalec/urednik. |
| 2. Zavrnitev računa z obstoječim e-poštnim naslovom z izrecnim sporočilom | Ustreza | Sistem preveri podvajanje e-pošte in vrne jasno sporočilo. |
| 3. Nov račun se z začasnim geslom takoj uspešno prijavi | Ustreza | Ustvarjeni račun je takoj uporabljiv za prijavo. |
| 4. Skrbnik deaktivira račun; obstoječe seje se prekličejo | Ustreza | Deaktivacija računa je podprta, seje se prekličejo. |
| 5. Poslušalec in urednik pri dostopu do upravljanja uporabnikov dobita zavrnitev | Ustreza | Preverjanje vlog pri zaščitenih zahtevah zavrne nepooblaščen dostop. |

**Sklep:** Zgodba US-02 je v celoti podprta z implementacijo. Vsa merila sprejemljivosti so izpolnjena.

---

## US-05: Iskanje po knjižnici

**Funkcionalnost:** F3 – Iskanje po lokalni knjižnici

**Implementirano:** Da. Poslušalec išče po naslovu ali izvajalcu; rezultati so takoj predvajljivi.

**Preverjanje meril:**

| Merilo | Status | Opomba |
|---|---|---|
| 1. Iskanje po naslovu in izvajalcu, neobčutljivo na velikost črk | Ustreza | Iskanje pokriva oba atributa ne glede na velikost črk. |
| 2. Rezultati prikazujejo naslov, izvajalca, album, trajanje, gumb za predvajanje in čakalno vrsto | Ustreza | Prikaz rezultatov vsebuje vse zahtevane elemente. |
| 3. Delna ujemanja od treh znakov dalje | Ustreza | Iskanje se izvede od treh vnesenih znakov dalje. |
| 4. Sporočilo »Ni zadetkov« brez napake | Ustreza | Prazno stanje je predvideno in prikazano brez napake. |
| 5. Stranjenje, največ 20 zadetkov na stran | Ustreza | Rezultati so prikazani po straneh z največ 20 zadetki. |

**Sklep:** Zgodba US-05 je v celoti podprta z implementacijo. Vsa merila sprejemljivosti so izpolnjena.

---

## US-09: Predvajanje in čakalna vrsta

**Funkcionalnost:** F5 – Predvajalnik in čakalna vrsta

**Implementirano:** Da. Predvajanje, pavza, premik po skladbi, naslednja/prejšnja skladba in dodajanje v čakalno vrsto; predvajalnik je uporaben tudi na ozkem zaslonu telefona.

**Preverjanje meril:**

| Merilo | Status | Opomba |
|---|---|---|
| 1. Takojšen odziv predvajanja, pavze, naslednje/prejšnje | Ustreza | Vse funkcije predvajalnika so implementirane in odzivne. |
| 2. Premik po drsniku nadaljuje predvajanje na izbranem mestu | Ustreza | Premikanje po skladbi je podprto. |
| 3. Dodajanje v čakalno vrsto iz iskanja in seznama | Ustreza | Dodajanje v čakalno vrsto je implementirano. |
| 4. Čakalna vrsta prikaže zaporedje in omogoča odstranjevanje | Ustreza | Čakalna vrsta prikazuje zaporedje in omogoča odstranjevanje. |
| 5. Predvajanje se nadaljuje ob brskanju po drugih straneh | Ustreza | Predvajanje se nadaljuje med navigacijo po aplikaciji. |

**Sklep:** Zgodba US-09 je v celoti podprta z implementacijo. Vsa merila sprejemljivosti so izpolnjena.

---

## US-11: Osebni seznami predvajanja

**Funkcionalnost:** F6 – Osebni seznami predvajanja

**Implementirano:** Da. Poslušalec ustvari zaseben seznam ter mu dodaja, odstranjuje in prerazporeja skladbe iz knjižnice.

**Preverjanje meril:**

| Merilo | Status | Opomba |
|---|---|---|
| 1. Ustvarjanje seznama zahteva naslov, seznam se takoj prikaže | Ustreza | Ustvarjanje seznamov je implementirano. |
| 2. Dodajanje skladb iz rezultatov iskanja | Ustreza | Dodajanje iz knjižnice je podprto. |
| 3. Odstranjena skladba takoj izgine, seznam ostane | Ustreza | Odstranjevanje skladb je implementirano. |
| 4. Prerazporeditev se shrani in ohrani po osvežitvi in prijavi | Ustreza | Prerazporejanje se shrani in ohrani. |
| 5. Poslušalec vidi samo svoje sezname; tuji dostop zavrnjen | Ustreza | Seznami so zasebni in vezani na uporabnika. |

**Sklep:** Zgodba US-11 je v celoti podprta z implementacijo. Vsa merila sprejemljivosti so izpolnjena.

---

## Povzetek

| Zgodba | Funkcionalnost | Sklep |
|---|---|---|
| US-01 | F1 Prijava | Ustreza |
| US-02 | F1 Ustvarjanje računov in vloge | Ustreza |
| US-05 | F3 Iskanje | Ustreza |
| US-09 | F5 Predvajalnik | Ustreza |
| US-11 | F6 Osebni seznami | Ustreza |

Implementirane MVP funkcionalnosti v celoti zadoščajo vsem preverjenim uporabniškim zgodbam. Vsa merila sprejemljivosti pri vseh petih zgodbah so izpolnjena.