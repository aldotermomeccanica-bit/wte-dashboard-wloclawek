# GitHub Pages package

Questa cartella contiene la versione statica della dashboard pronta per GitHub Pages.

## Contenuto da caricare nel repository
- docs/

## Come pubblicare
1. Carica la cartella `docs` nella root del repository GitHub.
2. Vai su `Settings -> Pages`.
3. In `Build and deployment`, scegli `Deploy from a branch`.
4. Seleziona branch `main` e folder `/docs`.
5. Salva.

Il sito leggerà i dati da `docs/data/dashboard-data.json`.
Per aggiornare mensilmente il sito, basta sostituire questo file con una nuova snapshot e fare commit.
