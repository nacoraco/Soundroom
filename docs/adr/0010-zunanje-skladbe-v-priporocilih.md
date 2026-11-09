# 0010. Zunanje skladbe v priporočilih in prenos na zahtevo

- Status: sprejeto
- Datum: 2026-11-09
- Nadomešča: delno [0004](0004-lastfm-samo-za-priporocila.md)
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

ADR 0004 je priporočila omejil na lokalno knjižnico. Med implementacijo F7 se je pokazalo, da Last.fm vrne uporabne predloge, ki jih v lokalni knjižnici še ni; brez njih je seznam pogosto prazen ali zelo kratek. Uporabnik mora predloge lahko uporabiti brez ročnega iskanja, hkrati pa prenos ne sme biti samodejen in ne sme podvajati obstoječega uvoznega toka.

## Obravnavane alternative

- **Omejitev na lokalno knjižnico (obstoječa odločitev)** – preprosto in brez prenosov, vendar majhno pokritje in pogosta prazna stanja.
- **Zunanji predlogi samo kot povezave** – brez shranjevanja, a uporabnik zapusti aplikacijo in predvajanje ni povezano s čakalno vrsto.
- **Zunanji predlogi s prenosom prek obstoječega delavca** – uporabnik izbere predlog, delavec prenese in doda skladbo v knjižnico; ponovna uporaba obstoječe infrastrukture.

## Odločitev

Izbrana možnost: **zunanje skladbe v priporočilih s prenosom na zahtevo prek obstoječega uvoznega delavca**, ker razširi odkrivanje brez nove infrastrukture. Last.fm ostane samo vir metapodatkov. Predlogi se povežejo z lokalnim katalogom, kadar je to mogoče; zunanje skladbe se prenesejo šele, ko jih uporabnik izbere za predvajanje oziroma dodajanje v čakalno vrsto ali shrani predlog kot seznam. Za ta opravila se vsili samodejno potrjevanje z modelom Laya, da se zmanjša ročni pregled; če model ni dosegljiv, opravilo ostane v stanju `needs_review`.

## Posledice

- **Pozitivne:** večje pokritje priporočil; lokalne skladbe so še vedno takoj predvajljive; prenos se zgodi le na izrecno uporabnikovo zahtevo; ni nove storitve ali ločenega toka.
- **Negativne:** večja poraba prostora in pasovne širine; prenos je odvisen od YouTuba, `yt-dlp` in delavca; neuspešen prenos je treba prikazati v čakalni vrsti; priporočila niso več omejena na vsebino, ki je že v knjižnici.
