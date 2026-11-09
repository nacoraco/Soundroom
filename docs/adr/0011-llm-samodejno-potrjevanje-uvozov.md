# 0011. Samodejno potrjevanje dvoumnih uvozov z lokalnim modelom Laya

- Status: sprejeto
- Datum: 2026-11-09
- Nadomešča: /
- Odločitev sprejeli: projektna ekipa

## Kontekst in problem

Delavec pri uvozu pogosto dobi več podobnih kandidatov. Deterministični razvrščevalnik lahko jasnega zmagovalca sprejme sam, pri nejasnih pa je potreben ročni pregled urednika. Ročni pregled je počasen, zato želimo neobvezno samodejno odločitev, ki ne uvaja zunanjega ponudnika ali pošiljanja podatkov v oblak in ki ob napaki ne blokira opravila.

## Obravnavane alternative

- **Vedno ročni pregled** – varen in preprost, vendar zamuden in ne izkorišča razpoložljivih podatkov.
- **Zunanji LLM API** – lahko boljša kakovost, vendar stroški, odvisnost in pošiljanje podatkov ponudniku.
- **Lokalni model Laya prek Ollame** – brez zunanjih ključev in stroškov na klic, a zahteva ločeno nameščeno Ollamo in ima omejeno kakovost.

## Odločitev

Izbrana možnost: **neobvezni lokalni model Laya prek Ollame**, ker ostane obdelava znotraj okolja in je odločitev mogoče vklopiti ali izklopiti. Ko je `llm_auto_approve` vklopljen oziroma je za opravilo vsiljeno, delavec pri nejasni izbiri pošlje največ pet oštevilčenih kandidatov modelu prek Ollaminega `/v1/systemone`; model vrne izbrano številko in verjetnosti, uporabi se kandidat z najvišjo verjetnostjo oziroma prag `LLM_CONFIDENCE_THRESHOLD`. Deterministični razvrščevalnik in ročni pregled ostaneta; če klic ne uspe, opravilo ostane v stanju `needs_review`. Nastavitev je privzeto izklopljena in jo upravlja skrbnik.

## Posledice

- **Pozitivne:** manj ročnega pregleda pri jasnih ali dovolj verjetnih primerih; ni zunanjih ključev ali stroškov na klic; ob nedosegljivem modelu se nič ne izgubi.
- **Negativne:** Ollama ni del osnovnega Docker Compose in jo je treba namestiti ločeno; kakovost in hitrost sta odvisni od modela in strojne opreme; napačna samodejna potrditev je možna, zato je treba hraniti kandidate in omogočiti ročni pregled.
