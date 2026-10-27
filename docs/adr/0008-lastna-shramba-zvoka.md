# 0008. Lastna shramba zvoka namesto predvajanja iz zunanjih storitev

- Status: sprejeto
- Datum: 2026-10-27
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Soundroom je namenjen osebni glasbeni knjižnici, ki mora biti dostopna in predvajljiva neodvisno od zunanjih storitev. Last.fm ne posreduje zvoka, YouTube pa je vir za uvoz manjkajočih skladb. Predvajanje mora podpirati preskakovanje po skladbi in ne sme razkriti neposrednih povezav do datotek.

## Obravnavane alternative

- **Vdelava in predvajanje neposredno iz YouTuba** – ni shrambe, vendar odvisnost od zunanje platforme, omejitve pogojev uporabe, oglasov in povezave ter brez nadzora nad razpoložljivostjo.
- **Predvajanje 30-sekundnih vzorcev Last.fm** – preprosto, a ne omogoča poslušanja celotnih skladb in ne ustreza namenu osebne knjižnice.
- **Lastna shramba zvoka z uvozom prek `yt-dlp`** – datoteke so pod nadzorom aplikacije, pretakanje je enotno, priporočila pa se nanašajo na dejansko razpoložljive skladbe.

## Odločitev

Izbrana možnost: **lastna trajna shramba zvoka**, ker mora biti predvajanje stabilno, avtorizirano in neodvisno od zunanjih predvajalnikov. Datoteke se hranijo v shrambi, ki jo upravlja Soundroom; API jih pretaka s preverjanjem pravic in podporo HTTP Range. `yt-dlp` se uporablja samo za pridobitev manjkajoče vsebine, Last.fm pa samo za metapodatke priporočil.

## Posledice

- **Pozitivne:** enotno in stabilno predvajanje; priporočila vodijo do skladb, ki so res na voljo; možna je podpora delovanju brez povezave v poznejši fazi; ni odvisnosti od vdelanih predvajalnikov.
- **Negativne:** poraba prostora in potreba po varnostnem kopiranju; odgovornost za vsebino in upoštevanje pravic; `yt-dlp` se lahko pokvari ob spremembah vira; uspeh uvoza ni zagotovljen in zahteva pregled dvoumnih zadetkov.
