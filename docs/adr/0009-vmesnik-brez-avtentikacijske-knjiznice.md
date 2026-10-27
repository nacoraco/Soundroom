# 0009. Uporabniški vmesnik brez posebne avtentikacijske knjižnice

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Sejo v celoti upravlja zaledni sistem, brskalnik pa prejme le piškotek `HttpOnly`, ki ga JavaScript ne more brati. Uporabniški vmesnik mora kljub temu ugotoviti, ali je uporabnik prijavljen, zaščititi poti in ob poteku seje preusmeriti na prijavo. Izbira knjižnice ne sme privesti do tega, da bi se žeton hranil v brskalniku.

## Obravnavane alternative

- **Posebna avtentikacijska knjižnica, na primer Auth.js ali NextAuth** – prinaša veliko vgrajenih tokov, vendar je zasnovana okoli lastnega upravljanja seje oziroma žetonov in se slabo ujema s sejo, ki jo v celoti nadzoruje FastAPI.
- **Lastno globalno stanje prijave** – deluje, vendar ponovno uvaja predpomnjenje, osveževanje in obravnavo napak, ki jih že rešuje knjižnica za poizvedbe.
- **`@tanstack/react-query` in `react-router`** – stanje prijave iz `GET /api/auth/me`, zaščitene poti in preusmeritve brez dodatne avtentikacijske plasti.

## Odločitev

Izbrana možnost: **`@tanstack/react-query` za stanje prijave in `react-router` za zaščitene poti**, ker zaledni sistem že zagotavlja sejo in CSRF žeton. Vmesnik ob zagonu pokliče `GET /api/auth/me`, odgovor 401 sproži preusmeritev na prijavo, obrazci pa uporabljajo `react-hook-form` in `zod`. Piškotka vmesnik ne bere in ne shranjuje.

## Posledice

- **Pozitivne:** nobenega žetona v JavaScriptu ali `localStorage`; manj odvisnosti in manjša površina za napake; en vir resnice o prijavi je zaledni sistem; zaščitene poti in obrazci so preprosti.
- **Negativne:** obravnavo 401 in osveževanje stanja je treba dosledno izvesti v vmesniku; ni vgrajenih tokov za zunanje ponudnike prijave, ki pa v projektu niso predvideni; avtentikacijska logika je razdeljena med zaledje in nekaj vmesniških klicev.
