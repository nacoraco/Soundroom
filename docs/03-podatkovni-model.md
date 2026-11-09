# Soundroom: podatkovni model

## Izhodišča

Relacijska baza PostgreSQL hrani uporabnike, metapodatke, sezname predvajanja in stanje opravil. Velike zvočne datoteke niso shranjene kot binarni podatki v bazi: hranijo se v konfigurirani trajni shrambi, v tabeli `tracks` pa je shranjena njihova relativna pot. V prvi različici ima skladba enega glavnega izvajalca in največ en album; podpora za več izvajalcev na skladbo je mogoča kot poznejša nadgradnja.

## Entitete in glavna polja

| Entiteta | Glavna polja | Namen |
|---|---|---|
| `users` | `id` (PK), `email` (UNIQUE), `display_name`, `password_hash`, `role` (`listener`, `editor`, `admin`), `is_active`, `created_at` | Računi in avtorizacija. Geslo se shrani samo kot zgoščena vrednost, nikoli kot navadno besedilo. |
| `user_sessions` | `id` (PK), `user_id` (FK), `token_hash` (UNIQUE, SHA-256), `created_at`, `expires_at`, `revoked_at` (NULL) | Strežniške prijavne seje; v bazi je SHA-256 zgoščena vrednost naključnega žetona, ne vrednost sejnega piškotka. |
| `artists` | `id` (PK), `name`, `normalized_name` (UNIQUE) | Kanonični zapis izvajalca za prikaz in iskanje. |
| `albums` | `id` (PK), `artist_id` (FK), `title`, `release_year` (NULL), `cover_path` (NULL) | Metapodatki albuma; skladba je lahko brez znanega albuma. |
| `tracks` | `id` (PK), `artist_id` (FK), `album_id` (FK, NULL), `title`, `normalized_title` (indeks), `duration_seconds`, `file_path` (UNIQUE), `mime_type`, `source_type` (`upload` ali `youtube`), `source_url` (NULL), `audio_sha256` (UNIQUE), `is_available`, `created_at` | Metapodatki skladbe in sklic na datoteko v shrambi. Normaliziran naslov podpira iskanje in ujemanje z Last.fm; `audio_sha256` pomaga zaznati podvojene datoteke. |
| `playlists` | `id` (PK), `owner_id` (FK), `name`, `created_at`, `updated_at` | Uporabniku pripadajoči zasebni seznami predvajanja. V različici MVP ima vsak seznam enega lastnika in samo ime; opis, vrsta in deljenje niso implementirani. |
| `playlist_items` | `id` (PK), `playlist_id` (FK), `track_id` (FK), `position`, `added_at` | Povezovalna entiteta med seznamom in skladbo. Enolična sta para (`playlist_id`, `track_id`) in (`playlist_id`, `position`), zato seznam nima podvojenih skladb ali dveh skladb na istem mestu; `position` določa vrstni red. |
| `rip_jobs` | `id` (PK), `requested_by_user_id` (FK), `query_text`, `normalized_query`, `status`, `candidate_url` (NULL), `candidate_title` (NULL), `candidate_artist` (NULL), `candidate_duration_seconds` (NULL), `force_llm_approval`, `track_id` (FK, NULL do uspešnega uvoza), `error_message` (NULL), `created_at`, `started_at` (NULL), `finished_at` (NULL) | Trajna vrsta opravil za samodejni uvoz. Kandidatna polja uredniku prikažejo zadetek in mu omogočijo popravek metapodatkov pred potrditvijo. `status` je eden od stanj, opisanih v dokumentu [funkcionalnosti](02-funkcionalnosti-in-obseg.md); `force_llm_approval` vsili samodejno potrjevanje z modelom Laya pri opravilih, ustvarjenih iz zunanjih predlogov. |
| `app_settings` | `id` (PK, v različici MVP ena vrstica), `auto_rip_on_miss`, `llm_auto_approve`, `max_track_minutes`, `updated_by_user_id` (FK), `updated_at` | Globalne nastavitve, ki jih upravlja skrbnik; stikalo za samodejni uvoz ob neuspešnem iskanju, stikalo za samodejno potrjevanje z modelom Laya in omejitev dolžine skladbe. Začetne vrednosti so `auto_rip_on_miss = false`, `llm_auto_approve = false` in `max_track_minutes = 15`. |

## Povezave med entitetami

- En `artist` ima lahko več `tracks`; vsaka skladba ima enega glavnega izvajalca.
- En `artist` ima lahko več `albums`; album ima enega glavnega izvajalca.
- En `album` lahko vsebuje več skladb; `tracks.album_id` je lahko prazen, če podatek ni znan.
- En `user` ima lahko več `playlists`; vsak seznam ima natanko enega lastnika.
- En `user` ima lahko več `user_sessions`; vsaka seja pripada enemu uporabniku in jo je mogoče preklicati ob odjavi ali deaktivaciji računa.
- `playlists` in `tracks` so povezani mnogo-proti-mnogo prek `playlist_items`.
- En `user` lahko sproži več `rip_jobs`; po uspešnem opravilu se `rip_jobs.track_id` poveže z uvoženo skladbo. Uvožene in naložene skladbe so enaki zapisi v `tracks`; `source_type` pove, ali izvirajo iz nalaganja (`upload`) ali iz YouTuba (`youtube`).
- Skrbnik lahko spremeni sistemsko nastavitev; `app_settings.updated_by_user_id` beleži zadnjega skrbnika, ki jo je spremenil.

## Osnutek modela

```mermaid
erDiagram
    USERS ||--o{ PLAYLISTS : owns
    USERS ||--o{ USER_SESSIONS : authenticates
    USERS ||--o{ RIP_JOBS : requests
    ARTISTS ||--o{ ALBUMS : releases
    ARTISTS ||--o{ TRACKS : performs
    ALBUMS o|--o{ TRACKS : contains
    PLAYLISTS ||--o{ PLAYLIST_ITEMS : contains
    TRACKS ||--o{ PLAYLIST_ITEMS : appears_in
    TRACKS o|--o{ RIP_JOBS : produced_by
    USERS ||--o| APP_SETTINGS : last_updated_by

    USERS {
        uuid id PK
        string email UK
        string display_name
        string password_hash
        string role
        boolean is_active
    }
    USER_SESSIONS {
        uuid id PK
        uuid user_id FK
        string token_hash UK
        datetime created_at
        datetime expires_at
        datetime revoked_at
    }
    ARTISTS {
        uuid id PK
        string name
        string normalized_name UK
    }
    ALBUMS {
        uuid id PK
        uuid artist_id FK
        string title
        int release_year
        string cover_path
    }
    TRACKS {
        uuid id PK
        uuid artist_id FK
        uuid album_id FK
        string title
        string normalized_title
        int duration_seconds
        string file_path UK
        string source_type
        string audio_sha256 UK
        boolean is_available
    }
    PLAYLISTS {
        uuid id PK
        uuid owner_id FK
        string name
        datetime created_at
        datetime updated_at
    }
    PLAYLIST_ITEMS {
        uuid id PK
        uuid playlist_id FK
        uuid track_id FK
        int position
        datetime added_at
    }
    RIP_JOBS {
        uuid id PK
        uuid requested_by_user_id FK
        uuid track_id FK
        string query_text
        string status
        string candidate_url
        string candidate_title
        string candidate_artist
        int candidate_duration_seconds
        boolean force_llm_approval
        datetime created_at
    }
    APP_SETTINGS {
        int id PK
        boolean auto_rip_on_miss
        boolean llm_auto_approve
        int max_track_minutes
        uuid updated_by_user_id FK
        datetime updated_at
    }
```

## Celovitost podatkov in datotek

- Zunanji ključi preprečujejo sezname brez lastnika ali elemente seznama brez obstoječe skladbe.
- Za `playlist_items` veljata enoličnost (`playlist_id`, `track_id`) in enoličen položaj (`playlist_id`, `position`), da seznam nima podvojenih skladb ali dveh skladb na istem mestu.
- Za `rip_jobs` je indeks na `normalized_query` in `status`; pri ustvarjanju novega opravila API transakcijsko preveri, ali za isto normalizirano poizvedbo že obstaja aktivno opravilo.
- Pred ustvarjanjem `tracks` delavec preveri, da so naslov, izvajalec in datoteka veljavni; potrjeni izvajalec se poveže z obstoječim zapisom `artists` ali se ustvari nov.
- Brisanje skladbe (skrbnik) izbriše zapis v `tracks` in pripadajočo zvočno datoteko; pot se pred brisanjem preveri znotraj `MEDIA_STORAGE_PATH`. Povezane vrstice v `playlist_items` se zaradi kaskade odstranijo. Polje `is_available` ostaja za primere, ko datoteka ni dosegljiva.
- Delavec naj datoteko najprej pripravi v začasnem imeniku in jo šele po uspešnem preverjanju premakne na končno pot. V bazi se skladba označi kot razpoložljiva šele po uspešnem zapisu datoteke.
- Poizvedbe za sezname predvajanja vedno preverijo lastništvo. Uporabnik ne more z ugibanjem ID-ja spreminjati seznama drugega uporabnika.
- V prvi različici zgodovina poslušanja, všečki in povezani računi Last.fm niso obvezni za priporočila; priporočilni seznam nastane iz skladb, ki jih uporabnik izbere kot izhodišče.
