# 0007. Avtorizacija in preverjanje pravic na strežniku

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Aplikacija ima tri vloge (`listener`, `editor`, `admin`) in zasebne sezname predvajanja. Končna točka za pretakanje zvoka ne sme biti javno dostopna, uporabnik pa ne sme z ugibanjem ID-ja spreminjati tujih podatkov. Skrivanje gumbov v uporabniškem vmesniku ne prepreči neposrednih zahtevkov na API.

## Obravnavane alternative

- **Preverjanje vlog samo v uporabniškem vmesniku** – preprosto, vendar varnostno nezadostno, ker je API neposredno dosegljiv.
- **JWT v `localStorage`** – priljubljen vzorec, a žeton je dostopen JavaScriptu in s tem morebitnim napadom XSS; preklic sej je zapleten.
- **Strežniška seja s piškotkom `HttpOnly` in preverjanje pravic v API-ju** – žeton ni dostopen JavaScriptu, sejo je mogoče preklicati, pravice pa se preverjajo na enem mestu.

## Odločitev

Izbrana možnost: **strežniška seja in preverjanje pravic v API-ju**, ker mora biti meja varnosti na strežniku. Gesla se zgoščujejo z Argon2id, naključni sejni žeton se pošlje v piškotku `HttpOnly`, `SameSite=Lax` in `Secure` pri HTTPS; v bazi se hrani le njegova zgoščena vrednost SHA-256. Vsaka zaščitena pot preveri sejo in vlogo, lastništvo seznamov ter pravico do pretakanja; spreminjajoče zahteve preverijo izvor oziroma CSRF žeton.

## Posledice

- **Pozitivne:** enotno preverjanje pravic za vse odjemalce; seje je mogoče preklicati ob odjavi ali deaktivaciji; žeton ni dosegljiv JavaScriptu; zvočne datoteke niso javno dostopne; vloge in lastništvo so preverjeni ne glede na vmesnik.
- **Negativne:** vsaka zaščitena zahteva potrebuje poizvedbo seje; potrebno je pravilno obravnavati CSRF in piškotke; zahteva HTTPS in skrbno konfiguracijo domene; več zaledne kode kot pri preverjanju samo v vmesniku.
