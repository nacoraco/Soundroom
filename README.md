# Soundroom

Soundroom je spletna aplikacija za poslušanje osebne glasbene knjižnice. Uporabnikom omogoča iskanje in pretakanje skladb, sestavljanje seznamov predvajanja ter odkrivanje podobne glasbe, skrbnikom pa uvoz datotek in upravljanje uporabnikov ter nastavitev. Odjemalec je odzivna spletna aplikacija, ki jo je v telefonu z Androidom mogoče namestiti kot progresivno spletno aplikacijo (PWA).

## Stanje implementacije

- **F1 – Prijava, odjava in vloge uporabnikov:** implementirano (prijava, seja, CSRF zaščita, odjava, skrbniško upravljanje uporabnikov).
- **F2 – Uvoz glasbe v knjižnico:** implementirano (nalaganje MP3, branje ID3 metapodatkov, ročna dopolnitev, trajna shramba datotek, zaznavanje dvojnikov, seznam zadnjih dodanih skladb).
- **F3 – Iskanje po lokalni knjižnici:** implementirano (iskanje po naslovu in izvajalcu brez razlikovanja velikosti črk in šumnikov, najmanj trije znaki, paginacija po 20 zadetkov, prazna stanja in pripravljena gumba za predvajanje ter čakalno vrsto).
- **F4 – Samodejni uvoz ob manjkajočem zadetku:** implementirano (skrbniške nastavitve, trajna opravila uvoja, ločen delavec z `yt-dlp`/FFmpeg, stanja opravil, uredniški pregled dvoumnih zadetkov, zahteva za uvoz iz praznega iskanja in neobvezno odločanje z modelom Laya).
- **F5 – Predvajalnik in čakalna vrsta:** implementirano (avtorizirano pretakanje HTTP Range, predvajalnik s čakalno vrsto, Media Session, mobilna vrstica, razširjen pogled in namestljiva PWA).
- **F6 – Osebni seznami predvajanja:** implementirano (lastniški CRUD, vrstni red skladb, iskanje in dodajanje, vlečenje za prerazporejanje, predvajanje seznama).
- **F7 – Odkrij podobno in radio:** implementirano (Last.fm track.getSimilar, lokalni in zunanji predlogi, samodejni radio z omejeno zgodovino poslušanja in največ dvema pripravljenima priporočiloma, ki se dodajata po eno naenkrat, ročna prioriteta čakalne vrste, samodejni prenosi z LLM potrjevanjem in shranjevanje kot nov seznam).

## Dokumentacija

| Dokument | Vsebina |
|---|---|
| [01 – Zasnova rešitve](docs/01-zasnova-resitve.md) | Namen, ciljni uporabniki in delovanje rešitve |
| [02 – Funkcionalnosti in obseg](docs/02-funkcionalnosti-in-obseg.md) | Vloge, funkcionalnosti MVP-ja in meje projekta |
| [03 – Podatkovni model](docs/03-podatkovni-model.md) | Entitete, povezave in celovitost podatkov |
| [04 – Arhitektura in tehnološki sklad](docs/04-arhitektura-in-tehnoloski-sklad.md) | Sestava sistema, komunikacija in izbrane tehnologije |
| [05 – Uporabniške zgodbe](docs/05-uporabniske-zgodbe.md) | Uporabniške zgodbe z merili sprejemljivosti |
| [06 – Wireframes](docs/06-wireframes.md) | Osnutki uporabniškega vmesnika |
| [ADR](docs/adr/) | Arhitekturne odločitve po predlogi MADR |

## Tehnološki sklad

| Področje | Tehnologije |
|---|---|
| Frontend | React, TypeScript, Vite, `@tanstack/react-query`, `react-router`, `react-hook-form`, `zod`; PWA (manifest in service worker) |
| Backend | Python 3.12+, FastAPI, Pydantic 2, Uvicorn |
| Podatkovna baza | PostgreSQL, SQLAlchemy 2, Alembic |
| Avtentikacija | Argon2id, sejni piškotek `HttpOnly`, strežniško preverjanje vlog, CSRF žeton |
| Glasba in uvoz | Trajna shramba datotek, `mutagen` za ID3 metapodatke, `yt-dlp`, FFmpeg/ffprobe, avtorizirano pretakanje HTTP Range |
| Priporočila | Last.fm API (`track.getSimilar`, F7) |
| Lokalni razvoj | Docker Compose, `.env`, `pytest` |

## Struktura repozitorija

```text
.
├── README.md
├── docker-compose.yml
├── docker-compose.ollama.yml
├── .env.example
├── frontend/              # React + TypeScript + Vite
│   ├── src/
│   └── package.json
├── backend/               # FastAPI, SQLAlchemy in Alembic
│   ├── app/
│   ├── alembic/
│   └── tests/
└── docs/
    ├── 01–06-*.md
    ├── wireframes/
    └── adr/
```

## Lokalni zagon

### Docker Compose

1. Kopirajte vzorčno konfiguracijo in jo prilagodite:

   ```powershell
   Copy-Item .env.example .env
   ```

   Pred prvim zagonom obvezno spremenite vsaj `APP_SECRET_KEY`, `POSTGRES_PASSWORD`, `INITIAL_ADMIN_PASSWORD` in `INITIAL_LISTENER_PASSWORD`.

   Če bo uporabniški vmesnik dostopen prek domene, dodajte gostitelja v `VITE_ALLOWED_HOSTS` (na primer `VITE_ALLOWED_HOSTS=soundroom.example.com`); Vite privzeto zavrne neznane gostitelje.

2. Zaženite storitve:

   ```powershell
   docker compose up --build
   ```

3. Odprite:
   - uporabniški vmesnik: <http://localhost:5173>
   - dokumentacija API-ja: <http://localhost:8000/docs>
   - zdravstvena točka: <http://localhost:8000/api/health>

4. Prijavite se z razvojnim računom iz `.env` (`INITIAL_ADMIN_*` oziroma `INITIAL_LISTENER_*`). Skrbnik lahko nato na strani **People** ustvari dodatne račune za poslušalce in urednike.

### Privzeti razvojni računi

| Vloga | E-pošta | Geslo |
|---|---|---|
| Skrbnik | `admin@example.com` | `change-me-now` |
| Poslušalec | `listener@example.com` | `listener-password` |

Računa se ustvarita ob prvem zagonu iz `INITIAL_ADMIN_*` in `INITIAL_LISTENER_*`. Gesli sta namenjeni samo lokalnemu razvoju; pred uporabo zunaj lokalnega okolja ju obvezno spremenite v `.env`.

Zaustavitev: `docker compose down`. Podatki v PostgreSQL ostanejo v volumnu `pgdata`; z `docker compose down -v` jih izbrišete.

### Ločena Ollama

Ollama ni del osnovnega `docker-compose.yml`, ker jo lahko na strežniku že imate nameščeno ločeno. Če je še nimate, jo zaženite iz druge datoteke:

```powershell
docker compose -f docker-compose.ollama.yml up -d
docker compose -f docker-compose.ollama.yml --profile llm-setup run --rm ollama-pull
```

Delavec uporablja `OLLAMA_BASE_URL` iz `.env`. Privzeto je `http://host.docker.internal:11434`, kar iz kontejnerja doseže gostitelja (strežnik), na katerem teče Soundroom. Ollama mora zato poslušati na naslovu, dosegljivem iz kontejnerjev (npr. `OLLAMA_HOST=0.0.0.0:11434`) ali objaviti vrata `11434`. To deluje tako z ločeno compose storitvijo kot z Ollamo, nameščeno neposredno na strežniku; za oddaljeno instanco nastavite ustrezen URL.

### Brez Dockerja

Za zaledni sistem potrebujete PostgreSQL in Python 3.12+:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
$env:DATABASE_URL = "postgresql+psycopg://soundroom:soundroom@localhost:5432/soundroom"
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

Za uporabniški vmesnik:

```powershell
cd frontend
npm install
npm run dev
```

Vite privzeto posreduje `/api` na `http://localhost:8000`; drug cilj nastavite z `VITE_PROXY_TARGET`.

## Testi in preverjanje

```powershell
cd backend
.venv\Scripts\python.exe -m pytest

cd ..\frontend
npm test
npm run build
```

## API (F1–F7)

| Metoda | Pot | Namen |
|---|---|---|
| `POST` | `/api/auth/login` | Prijava in ustvarjanje seje |
| `GET` | `/api/auth/me` | Trenutni uporabnik in CSRF žeton |
| `POST` | `/api/auth/logout` | Preklic seje in odjava |
| `GET` | `/api/admin/users` | Seznam uporabnikov (skrbnik) |
| `POST` | `/api/admin/users` | Ustvarjanje poslušalca ali urednika (skrbnik) |
| `PATCH` | `/api/admin/users/{id}` | Sprememba vloge ali aktivnosti (skrbnik) |
| `GET` | `/api/tracks?q=&page=` | Iskanje in paginacija razpoložljivih skladb (prijavljeni uporabniki) |
| `GET` | `/api/tracks/{id}` | Metapodatki posamezne razpoložljive skladbe |
| `GET` | `/api/tracks/{id}/stream` | Avtorizirano pretakanje MP3 s podporo `Range` (200/206/416) |
| `POST` | `/api/tracks` | Nalaganje MP3 (urednik ali skrbnik, multipart) |
| `DELETE` | `/api/tracks/{id}` | Trajni izbris skladbe in datoteke z diska (skrbnik) |
| `POST` | `/api/discover/similar` | Predlogi podobnih skladb (lokalne in zunanje) |
| `POST` | `/api/discover/radio` | Predlogi za samodejni radio |
| `GET/POST` | `/api/playlists` | Seznam oziroma ustvarjanje lastnih seznamov predvajanja |
| `GET/PATCH/DELETE` | `/api/playlists/{id}` | Podrobnosti, preimenovanje in brisanje lastnega seznama |
| `POST` | `/api/playlists/{id}/items` | Dodajanje skladbe na konec seznama |
| `DELETE` | `/api/playlists/{id}/items/{item_id}` | Odstranitev skladbe in strnitev položajev |
| `PUT` | `/api/playlists/{id}/items/reorder` | Shranjevanje novega vrstnega reda |
| `GET/PUT` | `/api/admin/settings` | Skrbniške nastavitve samodejnega uvoza |
| `GET` | `/api/admin/settings/llm-status` | Preverjanje dosegljivosti modela Laya (skrbnik) |
| `GET` | `/api/import-jobs/config` | Razpoložljivost samodejnega uvoza za prijavljene uporabnike |
| `GET` | `/api/import-jobs/preview?q=` | Predogled zunanjih izdaj za ročno izbiro (brez LLM) |
| `POST` | `/api/import-jobs` | Zahteva za uvoz manjkajoče skladbe, z izbrano zunanjo izdajo ali samodejnim iskanjem |
| `GET` | `/api/import-jobs/{id}` | Stanje opravila uvoza |
| `GET` | `/api/editor/import-jobs?status=` | Seznam opravil za uredniški pregled |
| `PATCH` | `/api/editor/import-jobs/{id}` | Popravek naslova in izvajalca kandidata |
| `POST` | `/api/editor/import-jobs/{id}/approve` | Potrditev kandidata in ponovna uvrstitev v čakalno vrsto |
| `POST` | `/api/editor/import-jobs/{id}/reject` | Zavrnitev kandidata brez prenosa |
| `GET` | `/api/health` | Stanje API-ja in baze |

Spreminjajoče zahteve zahtevajo glavo `X-CSRF-Token` z vrednostjo iz odgovora prijave oziroma `GET /api/auth/me`.

## Iskanje po knjižnici (F3)

- Iskalno polje v knjižnici počaka 300 ms po zadnjem vnosu in išče po naslovu skladbe ter imenu izvajalca.
- Iskanje se izvede od treh znakov dalje in ne razlikuje velikosti črk ali šumnikov; krajša poizvedba vrne prazno stanje brez napake.
- Rezultati so razdeljeni po 20. Trenutna stran in poizvedba se ohranita v naslovu URL, tako da paginacija in osvežitev ohranita iskanje.
- Vsak rezultat prikaže naslov, izvajalca, album in trajanje ter gumba **Play** in **+ Queue**. Play nastavi vidne rezultate kot čakalno vrsto, + Queue doda skladbo brez podvajanja.
- Odgovor `GET /api/tracks` je objekt z `items`, `page`, `page_size`, `total` in `total_pages`. Brez poizvedbe vrne zadnje dodane skladbe po straneh.

## Samodejni uvoz (F4)

- Skrbnik na strani **Settings** upravlja `auto_rip_on_miss`, `max_track_minutes` in neobvezni `llm_auto_approve`. Privzeto je uvoz izklopljen, največja dolžina pa 15 minut; LLM samodejno potrjevanje je privzeto izklopljeno.
- Iskanje vedno prikaže predogled zunanjih izdaj pod lokalnimi zadetki, ko je uvoz omogočen. Uporabnik izbere natančno izdajo prek **Play** ali **Queue**; ta pot ne uporablja LLM. `llm_auto_approve` ostaja za opravila, ustvarjena brez izbrane izdaje (na primer prek API-ja).
- Nastavitev velja za nova opravila; že ustvarjena opravila se ne prekličejo. Poslušalci in uredniki nastavitev ne morejo spreminjati.
- Deterministični razvrščevalnik samodejno sprejme jasnega zmagovalca (ujemanje naslova/izvajalca, uradni kanal, razlika pred drugim kandidatom). Žive, koncertne in nastopne različice so vedno uvrščene za vsemi studijskimi kandidati, ne glede na skladbo, izvajalca ali priljubljenost; če obstaja vsaj ena studijska različica, LLM nikoli ne izbere žive.
- Če je izbira nejasna in je vklopljen `llm_auto_approve`, delavec pošlje največ pet kandidatov lokalnemu modelu **Laya** prek Ollame. Laya je odločitveni model, zato ga kličemo prek Ollaminega `/v1/systemone` z izbiro med oštevilčenimi kandidati; vrne izbrano številko in verjetnosti. Izbere kandidata z najvišjo verjetnostjo; prag je privzeto 0. Če klic modela ne uspe, opravilo ostane v uredniškem pregledu.
- Ollama ni vključena v osnovni Docker Compose. Zaženite jo ločeno z `docker compose -f docker-compose.ollama.yml up -d`, model pa namestite z:
  ```powershell
  docker compose -f docker-compose.ollama.yml --profile llm-setup run --rm ollama-pull
  ```
  Delavec uporablja `OLLAMA_BASE_URL` iz `.env` (privzeto `http://host.docker.internal:11434`) in privzeti model `laya`. Če Ollama že teče na strežniku, lahko `OLLAMA_BASE_URL` kaže nanjo in ločene storitve ni treba zagnati.
- Opravila so trajna (`rip_jobs`) in imajo stanja `queued`, `searching`, `downloading`, `processing`, `needs_review`, `completed`, `failed` in `cancelled`.
- Ločena storitev `worker` prevzame opravila, poišče do pet kandidatov z `yt-dlp`, izloči predolge, pripravi MP3 z FFmpeg/ffprobe in doda skladbo v katalog.
- Uredniki in skrbniki na strani **Imports** pregledajo kandidate, popravijo naslov ali izvajalca ter jih potrdijo ali zavrnejo. Zavrnitev ne prenese ničesar.
- Testi zunanje klice `yt-dlp`/FFmpeg nadomestijo z nadomestki in ne potrebujejo zunanjih storitev.

## Predvajanje in čakalna vrsta (F5)

- Predvajanje poteka prek `GET /api/tracks/{id}/stream`. Zahteva veljavno sejo, preveri razpoložljivost skladbe in datoteko ter podpira `Range` z odgovoroma `200` in `206`; neveljavni ali nezadovoljivi obsegi vrnejo `416` s `Content-Range`.
- Datoteke niso neposredno dostopne prek statične poti; pot se preveri znotraj `MEDIA_STORAGE_PATH`, odgovor pa vsebuje `Accept-Ranges`, `Content-Type` in dolžino vsebine.
- Predvajalnik je v skupnem kontekstu nad postavitvijo, zato se predvajanje in čakalna vrsta ohranita med brskanjem po straneh. Gumb **Play** v knjižnici nastavi trenutne rezultate kot čakalno vrsto, **+ Queue** pa doda posamezno skladbo brez podvajanja.
- Na voljo so predvajanje/pavza, prejšnja/naslednja skladba, premikanje po skladbi, odstranjevanje iz čakalne vrste in čiščenje vrste. Media Session API posreduje metapodatke in sistemske kontrole.
- Iskanje prikaže predogled do osmih zunanjih izdaj s sličico, naslovom, izvajalcem, trajanjem in številom ogledov pod lokalnimi zadetki. Vsaka izdaja ima **Play** in **+ Queue**; Play odpre predvajalnik pri `0:00` in počaka na prenos, Queue pa prenese v ozadju in doda skladbo na konec čakalne vrste brez prekinitve predvajanja. Opravilo se ustvari z izbranim videom, zato iskanje ne uporablja LLM in delavec ne ponovi iskanja. Predolge izdaje in izdaje z neznanim trajanjem so onemogočene.
- Skrbnik lahko v knjižnici izbriše skladbo z gumbom **Delete**; API odstrani zapis in pripadajočo zvočno datoteko, pot pa mora ostati znotraj `MEDIA_STORAGE_PATH`.
- Na telefonu je predvajalnik pritrjen na dno, razširjen pogled pa je celozaslonski. Postavitev je enoročna in brez vodoravnega pomikanja.
- PWA je namestljiva prek `manifest.webmanifest`, ikon in servisnega delavca. Na Androidu jo v Chromu dodate z **Add to Home screen**; zagon z ikone odpre `/library`.

## Seznami predvajanja (F6)

- Uporabnik vidi in upravlja samo svoje sezname; vsak tuj seznam vrne `404`, ne glede na to, ali obstaja.
- Seznam vsebuje lastniške metapodatke in urejene postavke. Ista skladba se v posameznem seznamu ne more ponoviti; položaji so unikatni in po odstranitvi strnjeni.
- API omogoča ustvarjanje, preimenovanje, brisanje, dodajanje in odstranjevanje skladb ter pošiljanje celotnega novega vrstnega reda. Preureditev se shrani v bazi.
- Vmesnik **Playlists** prikaže kartice seznamov in obrazec za nov seznam. Podrobnosti omogočajo iskanje po knjižnici, dodajanje, odstranjevanje, vlečenje vrstic ter pomožna gumba za premik gor/dol.
- Gumb **Play all** naloži celoten seznam v skupno čakalno vrsto predvajalnika; posamezno skladbo je mogoče predvajati neposredno iz seznama.

## Odkrij podobno in radio (F7)

- Poslušalec izbere eno do tri skladbe iz lokalne knjižnice. Vmesnik onemogoči četrto izhodišče. Rezultati vsebujejo lokalne in zunanje skladbe.
- Za vsako izhodišče API prek Last.fm `track.getSimilar` pridobi do 20 podobnih skladb; ključ `LASTFM_API_KEY` ostane samo v okolju zalednega sistema. Za `track.getSimilar` zadostuje API ključ; shared secret in callback sta potrebna le za Last.fm Web Authentication, ki ga aplikacija ne uporablja.
- Kandidate normalizira in poveže z lokalnimi izvajalci ter naslovi. Združi ponovitve in različice iste skladbe (npr. Lyrics, Official Video, Live, Sped Up) ter razlike v zapisu izvajalca, izloči izhodišča in vrne največ 20 predlogov; lokalne skladbe so označene, zunanje pa se ob uporabi prenesejo. Če Last.fm za posamezno skladbo nima podatkov `track.getSimilar`, se uporabi rezerva prek podobnih izvajalcev in njihovih najbolj predvajanih skladb.
- Uvrstitev je vsota Last.fm podobnosti čez vsa izhodišča; pri izenačenju ima prednost kandidat, ki se pojavi pri več izhodiščih.
- Ob predvajanju se samodejno ustvari radio z zgodovino zadnjih 100 unikatnih skladb. Skladba se v zgodovino doda šele, ko postane aktivna; pri vsakem priporočilu se kot izhodišča pošlje zadnjih 5 skladb, predvajanih več kot 50 %, in 5 naključno izbranih iz preostalih skladb, predvajanih več kot 50 %; skladbe, ki niso bile predvajane več kot 50 %, se kot izhodišča ne uporabijo, sicer pa se uporabi prvotno izbrana skladba. Iz predlogov se izločijo vse skladbe iz zgodovine in čakalne vrste, tudi različice iste skladbe z drugačnim naslovom ali zapisom izvajalca; samodejni predlogi, ki se ob uvozu izkažejo za različico že prisotne skladbe, se iz čakalne vrste odstranijo. V pripravljenosti sta največ dve priporočili; ko eno postane trenutna skladba, se takoj zahteva eno novo, da se zaloga spet dopolni na dve, pri čemer se nikoli ne ustvarita dve naenkrat.
- Ročno dodane skladbe se vstavijo takoj za trenutno skladbo oziroma za že čakajoče ročne skladbe, pred samodejne predloge. Ročno dodajanje ne ponastavi seje; skladba postane izhodišče šele, ko se predvaja več kot 50 %. Nov izbor iz iskalnika ali knjižnice v celoti ponastavi sejo. V razširjenem predvajalniku so **Now playing**, **Your queue** in **Recommended** ločeni; ko samodejna skladba postane trenutna, se prestavi v Now playing in seznam Recommended se skrajša.
- Zunanje skladbe se prenesejo prek obstoječega uvoznega delavca; za tovrstna opravila je vsiljeno LLM samodejno potrjevanje. Če Last.fm ni dosegljiv ali ključ ni nastavljen, predvajanje, iskanje in seznami delujejo naprej.
- V pogledu **Discover** je mogoče zunanje predloge prenesti in dodati v čakalno vrsto, pri shranjevanju seznama pa se vse skladbe prenesejo, dodajo v nov osebni seznam in nato v čakalno vrsto.
## Nalaganje glasbe (F2)

- V uporabniškem vmesniku je na voljo stran **Upload**, vidna urednikom in skrbnikom.
- Sprejeta je samo datoteka MP3; dejanska vsebina se preveri z `mutagen`, ne le pripona.
- Največja velikost je določena z `MAX_UPLOAD_MB` (privzeto 50 MB). Ob prekoračitvi odgovor navede največjo dovoljeno velikost.
- Naslov in izvajalec se prebereta iz ID3 oznak (`TIT2`, `TPE1`), album iz `TALB`, leto pa iz `TDRC` oziroma `TYER`. Če naslov ali izvajalec manjkata, obrazec zahteva ročni vnos; ista izbrana datoteka se nato pošlje še enkrat.
- Datoteke se shranijo v `MEDIA_STORAGE_PATH/tracks/`; v bazi je relativna pot, SHA-256 vsebine pa prepreči podvojene skladbe.
- Po uspešnem uvozu se skladba prikaže v knjižnici in je takoj najdljiva ter predvajljiva.

## Razvojni proces

Projekt uporablja strategijo **GitHub Flow**:

1. Za vsako funkcionalnost se ustvari kratkotrajna veja z opisnim imenom (npr. `feature/f1-auth`).
2. Spremembe se objavijo v veji in združijo v `main` izključno prek pull requesta.
3. Veja `main` se spreminja izključno prek pull requestov; priporočena zaščita veje preprečuje neposredne push-e, prisilno prepisovanje zgodovine in brisanje veje.
4. Pomembne arhitekturne odločitve se dokumentirajo kot nov ADR; sprememba obstoječe odločitve se zabeleži z novim ADR-jem, ki navede, katero odločitev nadomešča.
