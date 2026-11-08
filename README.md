# Soundroom

Soundroom je spletna aplikacija za poslušanje osebne glasbene knjižnice. Uporabnikom omogoča iskanje in pretakanje skladb, sestavljanje seznamov predvajanja ter odkrivanje podobne glasbe, skrbnikom pa uvoz datotek in upravljanje uporabnikov ter nastavitev. Odjemalec je odzivna spletna aplikacija, ki jo je v telefonu z Androidom mogoče namestiti kot progresivno spletno aplikacijo (PWA).

## Stanje implementacije

- **F1 – Prijava, odjava in vloge uporabnikov:** implementirano (prijava, seja, CSRF zaščita, odjava, skrbniško upravljanje uporabnikov).
- **F2 – Uvoz glasbe v knjižnico:** implementirano (nalaganje MP3, branje ID3 metapodatkov, ročna dopolnitev, trajna shramba datotek, zaznavanje dvojnikov, seznam zadnjih dodanih skladb).
- **F3 – Iskanje po lokalni knjižnici:** implementirano (iskanje po naslovu in izvajalcu brez razlikovanja velikosti črk in šumnikov, najmanj trije znaki, paginacija po 20 zadetkov, prazna stanja in pripravljena gumba za predvajanje ter čakalno vrsto).
- **F4 – Samodejni uvoz ob manjkajočem zadetku:** implementirano (skrbniške nastavitve, trajna opravila uvoja, ločen delavec z `yt-dlp`/FFmpeg, stanja opravil, uredniški pregled dvoumnih zadetkov, zahteva za uvoz iz praznega iskanja in neobvezno odločanje z modelom Laya).
- **F5–F7:** v načrtu; naloge in napredek so na [GitHub Projectu Soundroom MVP](https://github.com/users/nacoraco/projects/5).

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
| Frontend | React, TypeScript, Vite, `@tanstack/react-query`, `react-router`, `react-hook-form`, `zod`; PWA v F5 |
| Backend | Python 3.12+, FastAPI, Pydantic 2, Uvicorn |
| Podatkovna baza | PostgreSQL, SQLAlchemy 2, Alembic |
| Avtentikacija | Argon2id, sejni piškotek `HttpOnly`, strežniško preverjanje vlog, CSRF žeton |
| Glasba in uvoz | Trajna shramba datotek, `mutagen` za ID3 metapodatke, `yt-dlp`, FFmpeg/ffprobe, pretakanje HTTP Range (F2–F5) |
| Priporočila | Last.fm API (`track.getSimilar`, F7) |
| Lokalni razvoj | Docker Compose, `.env`, `pytest` |

## Struktura repozitorija

```text
.
├── README.md
├── docker-compose.yml
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
npm run build
```

## API (F1–F4)

| Metoda | Pot | Namen |
|---|---|---|
| `POST` | `/api/auth/login` | Prijava in ustvarjanje seje |
| `GET` | `/api/auth/me` | Trenutni uporabnik in CSRF žeton |
| `POST` | `/api/auth/logout` | Preklic seje in odjava |
| `GET` | `/api/admin/users` | Seznam uporabnikov (skrbnik) |
| `POST` | `/api/admin/users` | Ustvarjanje poslušalca ali urednika (skrbnik) |
| `PATCH` | `/api/admin/users/{id}` | Sprememba vloge ali aktivnosti (skrbnik) |
| `GET` | `/api/tracks?q=&page=` | Iskanje in paginacija razpoložljivih skladb (prijavljeni uporabniki) |
| `POST` | `/api/tracks` | Nalaganje MP3 (urednik ali skrbnik, multipart) |
| `GET/PUT` | `/api/admin/settings` | Skrbniške nastavitve samodejnega uvoza |
| `GET` | `/api/import-jobs/config` | Razpoložljivost samodejnega uvoza za prijavljene uporabnike |
| `POST` | `/api/import-jobs` | Zahteva za uvoz manjkajoče skladbe z združevanjem aktivnih opravil |
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
- Vsak rezultat prikaže naslov, izvajalca, album, trajanje in pripravljena gumba **Play** ter **+ Queue**; povezava na predvajalnik in čakalno vrsto pride v F5.
- Odgovor `GET /api/tracks` je objekt z `items`, `page`, `page_size`, `total` in `total_pages`. Brez poizvedbe vrne zadnje dodane skladbe po straneh.

## Samodejni uvoz (F4)

- Skrbnik na strani **Settings** upravlja `auto_rip_on_miss`, `max_track_minutes` in neobvezni `llm_auto_approve`. Privzeto je uvoz izklopljen, največja dolžina pa 15 minut; LLM samodejno potrjevanje je privzeto izklopljeno.
- Nastavitev velja za nova opravila; že ustvarjena opravila se ne prekličejo. Poslušalci in uredniki nastavitev ne morejo spreminjati.
- Deterministični razvrščevalnik samodejno sprejme jasnega zmagovalca (ujemanje naslova/izvajalca, uradni kanal, razlika pred drugim kandidatom).
- Če je izbira nejasna in je vklopljen `llm_auto_approve`, delavec pošlje največ pet kandidatov lokalnemu modelu **Laya** prek Ollame. Laya je odločitveni model, zato ga kličemo prek Ollaminega `/v1/systemone` z izbiro med oštevilčenimi kandidati; vrne izbrano številko in verjetnosti. Izbere kandidata z najvišjo verjetnostjo; prag je privzeto 0. Če klic modela ne uspe, opravilo ostane v uredniškem pregledu.
- Ollama je vključena v Docker Compose, model pa se ne prenaša samodejno. Po zagonu storitev ga namestite z:
  ```powershell
  docker compose --profile llm-setup run --rm ollama-pull
  ```
  Delavec uporablja `OLLAMA_BASE_URL=http://ollama:11434` in privzeti model `laya`.
- Opravila so trajna (`rip_jobs`) in imajo stanja `queued`, `searching`, `downloading`, `processing`, `needs_review`, `completed`, `failed` in `cancelled`.
- Ločena storitev `worker` prevzame opravila, poišče do pet kandidatov z `yt-dlp`, izloči predolge, pripravi MP3 z FFmpeg/ffprobe in doda skladbo v katalog.
- Uredniki in skrbniki na strani **Imports** pregledajo kandidate, popravijo naslov ali izvajalca ter jih potrdijo ali zavrnejo. Zavrnitev ne prenese ničesar.
- Testi zunanje klice `yt-dlp`/FFmpeg nadomestijo z nadomestki in ne potrebujejo zunanjih storitev.

## Nalaganje glasbe (F2)

- V uporabniškem vmesniku je na voljo stran **Upload**, vidna urednikom in skrbnikom.
- Sprejeta je samo datoteka MP3; dejanska vsebina se preveri z `mutagen`, ne le pripona.
- Največja velikost je določena z `MAX_UPLOAD_MB` (privzeto 50 MB). Ob prekoračitvi odgovor navede največjo dovoljeno velikost.
- Naslov in izvajalec se prebereta iz ID3 oznak (`TIT2`, `TPE1`), album iz `TALB`, leto pa iz `TDRC` oziroma `TYER`. Če naslov ali izvajalec manjkata, obrazec zahteva ročni vnos; ista izbrana datoteka se nato pošlje še enkrat.
- Datoteke se shranijo v `MEDIA_STORAGE_PATH/tracks/`; v bazi je relativna pot, SHA-256 vsebine pa prepreči podvojene skladbe.
- Po uspešnem uvozu se skladba prikaže v knjižnici in je takoj najdljiva z iskanjem. Predvajanje se doda v F5.

## Razvojni proces

Projekt uporablja strategijo **GitHub Flow**:

1. Za vsako funkcionalnost se ustvari kratkotrajna veja z opisnim imenom (npr. `feature/f1-auth`).
2. Spremembe se objavijo v veji in združijo v `main` izključno prek pull requesta.
3. Veja `main` je zaščitena: neposredni pushi, prisilno prepisovanje zgodovine in brisanje veje niso dovoljeni.
4. Pomembne arhitekturne odločitve se dokumentirajo kot nov ADR; sprememba obstoječe odločitve se zabeleži z novim ADR-jem, ki navede, katero odločitev nadomešča.
