# Deploy su Render

## 1. Carica il progetto su GitHub
Carica **questa cartella** in un repository GitHub.

## 2. Crea il servizio su Render
Nel dashboard di Render:
- **New +** -> **Blueprint**
- collega il repository GitHub
- Render leggerà automaticamente il file `render.yaml`

## 3. Controlla la configurazione
Il progetto userà:
- **Build command**: `pip install -r requirements.txt`
- **Start command**: `gunicorn app:app`
- **Persistent disk** montato su `/var/data`
- **WTE_DATA_DIR** = `/var/data/wte-dashboard`

## 4. Primo avvio
Al primo deploy, se il disco è vuoto, l'app copia automaticamente i file iniziali da `data/current` dentro il disco persistente.

## 5. Aggiornamenti futuri
Dopo il deploy:
- la dashboard leggerà i file da `data/current` sul disco persistente
- gli upload dalla pagina Admin resteranno salvati anche dopo restart e nuovi deploy

## 6. Link finale
Alla fine Render ti darà un URL pubblico del tipo:
- `https://wte-dashboard.onrender.com`

## Nota
Per mantenere i file Excel tra i deploy serve un piano con **persistent disk**. Render documenta che i dischi persistenti non sono disponibili sui servizi Free.
