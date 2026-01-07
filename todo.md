7.2. Flow per frame
Schrijf in pseudo-stappen:

Neem keypoints van MoveNet.

Bereken (in lib/pose/angles.ts):

Ellebooghoek, kniehoek, heuprotatie, etc.

Stuur deze naar lib/scoring/scoreTechnique.ts.

Krijg een ScoreResult terug (score + lijst korte feedbackpunten).

UI:

Toon score in een Shadcn Badge of Card.

Toon per fout een kort bullet in een feedbackpaneel.

Stuur markeringen naar Babylon overlay (foute joints rood).

Alleen deze mental map is al superwaardevol voor later.

9. UX-flow & schermen
   Denk je app als 3–4 schermen:

Home / Dashboard

Uitleg wat de tool doet.

Button “Start Training”.

Training

Links: video / 3D skeleton.

Rechts: feedback (tekst, score, toggles voor audio).

Onder: gekozen techniek + progressie.

Settings

Camera source selectie (als je dat later wil).

Audio toggles.

Sensitiviteit van scoring (sliders).

About / Help

Privacy uitleg (GDPR).

Korte handleiding.

Je kan alvast globaal nadenken over content & componenten, zonder te implementeren.

10. Aanpak- en volgorde-advies
    Stel je project op in iteraties, niet alles tegelijk.

Iteratie 1 – Skeleton van de app
Next.js app draait, Tailwind & Shadcn werken.
​
​

Pagina’s: /, /training, /settings.

Layouts & basiscomponenten zonder logica.

Iteratie 2 – Camera & 3D-placeholder
WebRTC camera werkt op /training (video met live feed).

Babylon canvas of react-babylonjs scene wordt gerenderd (ook al is het nog een kubus).

Iteratie 3 – Pose-detectie
MoveNet model wordt geladen.

Je toont keypoints of een simpel overlay (geen scoring).

Check dat FPS ok is (DevTools performance tab).

Iteratie 4 – Scoring & visuele feedback
Bereken enkele hoeken (elleboog, knie).

Simpele regel-gebaseerde score.

Toon feedback in UI (Shadcn kaarten, badges).

Markeer joints visueel (kleur, cirkel in 3D of HTML overlay).

Iteratie 5 – Audio & polish
Hook voor geluid en audio cues koppelen aan fouten.

Settings werken (audio aan/uit, gevoeligheid slider).

Dark mode + theming afronden.

Copy/UX tekst nalopen.
