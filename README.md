# Soundroom

Soundroom je spletna aplikacija za poslušanje osebne glasbene knjižnice. Uporabnikom omogoča iskanje in pretakanje skladb, sestavljanje seznamov predvajanja ter odkrivanje podobne glasbe, skrbnikom pa uvoz datotek in upravljanje uporabnikov ter nastavitev. Odjemalec je odzivna spletna aplikacija, ki jo je v telefonu z Androidom mogoče namestiti kot progresivno spletno aplikacijo (PWA).

Projekt je v fazi priprave repozitorija: `frontend/` in `backend/` za zdaj ne vsebujeta izvorne kode. Načrt, obseg in arhitektura so opisani v dokumentaciji.

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
| Frontend | React, TypeScript, Vite, `vite-plugin-pwa`, `@tanstack/react-query`, `react-router`, `react-hook-form`, `zod` |
| Backend | Python 3.12+, FastAPI, Pydantic 2, Uvicorn |
| Podatkovna baza | PostgreSQL, SQLAlchemy 2, Alembic |
| Avtentikacija | Argon2id, sejni piškotek `HttpOnly`, strežniško preverjanje vlog |
| Glasba in uvoz | Trajna shramba datotek, `yt-dlp`, FFmpeg/ffprobe, pretakanje HTTP Range |
| Priporočila | Last.fm API (`track.getSimilar`) |
| Lokalni razvoj | Docker Compose, `.env`, `pytest` |

## Struktura repozitorija

```text
.
├── README.md
├── .gitignore
├── frontend/          # spletni odjemalec (še brez kode)
├── backend/           # REST API in delavec za uvoz (še brez kode)
└── docs/
    ├── 01-zasnova-resitve.md
    ├── 02-funkcionalnosti-in-obseg.md
    ├── 03-podatkovni-model.md
    ├── 04-arhitektura-in-tehnoloski-sklad.md
    ├── 05-uporabniske-zgodbe.md
    ├── 06-wireframes.md
    ├── wireframes/
    │   ├── WF-01-sign-in.png
    │   ├── ...
    │   └── WF-08-mobile-player.png
    └── adr/
        ├── adr-template.md
        └── 0001–0009-*.md
```

## Razvojni proces

Projekt uporablja strategijo **GitHub Flow**:

1. Za vsako spremembo se ustvari kratkotrajna veja z opisnim imenom (npr. `feature/player-queue`).
2. Spremembe se objavijo v veji in združijo v `main` izključno prek pull requesta.
3. Veja `main` je zaščitena: neposredni pushi, prisilno prepisovanje zgodovine in brisanje veje niso dovoljeni.
4. Pomembne arhitekturne odločitve se dokumentirajo kot nov ADR; sprememba obstoječe odločitve se zabeleži z novim ADR-jem, ki navede, katero odločitev nadomešča.

Lokalni zagon bo opisan tukaj, ko bosta pripravljena prva različica zalednega sistema in uporabniškega vmesnika; predvideni koraki so v razdelku [Lokalni zagon](docs/04-arhitektura-in-tehnoloski-sklad.md#lokalni-zagon).
