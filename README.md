# Soundroom

Soundroom je spletna aplikacija za poslušanje osebne glasbene knjižnice. Uporabnikom omogoča iskanje in pretakanje skladb, sestavljanje seznamov predvajanja ter odkrivanje podobne glasbe, skrbnikom pa uvoz datotek in upravljanje uporabnikov ter nastavitev. Odjemalec je odzivna spletna aplikacija, ki jo je v telefonu z Androidom mogoče namestiti kot progresivno spletno aplikacijo (PWA).

## Stanje implementacije

- **F1 – Prijava, odjava in vloge uporabnikov:** implementirano (prijava, seja, CSRF zaščita, odjava, skrbniško upravljanje uporabnikov).
- **F2–F7:** v načrtu; naloge in napredek so na [GitHub Projectu Soundroom MVP](https://github.com/users/nacoraco/projects/5).

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
| Glasba in uvoz | Trajna shramba datotek, `yt-dlp`, FFmpeg/ffprobe, pretakanje HTTP Range (F2–F5) |
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

   Pred prvim zagonom obvezno spremenite vsaj `APP_SECRET_KEY`, `POSTGRES_PASSWORD` in `INITIAL_ADMIN_PASSWORD`.

2. Zaženite storitve:

   ```powershell
   docker compose up --build
   ```

3. Odprite:
   - uporabniški vmesnik: <http://localhost:5173>
   - dokumentacija API-ja: <http://localhost:8000/docs>
   - zdravstvena točka: <http://localhost:8000/api/health>

4. Prijavite se z računom iz `.env` (`INITIAL_ADMIN_EMAIL` in `INITIAL_ADMIN_PASSWORD`). Skrbnik lahko nato na strani **Users** ustvari račune za poslušalce in urednike.

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

## API (F1)

| Metoda | Pot | Namen |
|---|---|---|
| `POST` | `/api/auth/login` | Prijava in ustvarjanje seje |
| `GET` | `/api/auth/me` | Trenutni uporabnik in CSRF žeton |
| `POST` | `/api/auth/logout` | Preklic seje in odjava |
| `GET` | `/api/admin/users` | Seznam uporabnikov (skrbnik) |
| `POST` | `/api/admin/users` | Ustvarjanje poslušalca ali urednika (skrbnik) |
| `PATCH` | `/api/admin/users/{id}` | Sprememba vloge ali aktivnosti (skrbnik) |
| `GET` | `/api/health` | Stanje API-ja in baze |

Spreminjajoče zahteve zahtevajo glavo `X-CSRF-Token` z vrednostjo iz odgovora prijave oziroma `GET /api/auth/me`.

## Razvojni proces

Projekt uporablja strategijo **GitHub Flow**:

1. Za vsako funkcionalnost se ustvari kratkotrajna veja z opisnim imenom (npr. `feature/f1-auth`).
2. Spremembe se objavijo v veji in združijo v `main` izključno prek pull requesta.
3. Veja `main` je zaščitena: neposredni pushi, prisilno prepisovanje zgodovine in brisanje veje niso dovoljeni.
4. Pomembne arhitekturne odločitve se dokumentirajo kot nov ADR; sprememba obstoječe odločitve se zabeleži z novim ADR-jem, ki navede, katero odločitev nadomešča.
