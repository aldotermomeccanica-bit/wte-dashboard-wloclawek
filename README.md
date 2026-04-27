# WtE Dashboard V4 locale

Questa versione mantiene **Admin** e **Portfolio** e migliora ancora la pagina **Overview**.

## Novità V4
- **Curva S** più vicina al file status:
  - linea **blu** = procurement schedule cumulativo
  - linea **verde** = budget / programma cliente cumulativo
  - **pallino rosso** = stato attuale
- etichette mesi **verticali** sull'asse X
- blocco ordini con **grafico a torta con label visibili**
- dettagli cliccabili con pulsante **Back**
- generazione automatica di un **report Excel combinato** a ogni refresh/upload
- cartella dedicata per i report: `data/reports/`

## Avvio
```bash
py -m pip install -r requirements.txt
py app.py
```

Apri:
```text
http://127.0.0.1:8000
```

## Dove mettere i file Excel
Puoi caricarli da **Admin** oppure copiarli qui:
```text
data\current\Budget.xlsm
data\current\Procurement.xlsx
```

## Report Excel automatico
Ogni volta che aggiorni la dashboard viene creato un file `.xlsx` qui:
```text
data\reports\
```

Il report contiene:
- `Executive Summary`
- `S_Curve_Data`
- `Orders_Status`
- `Direct_Packages`
- `Notes`

## Dati usati
- Budget KPI totale: **colonna AB**
- Procurement Updated Budget: **colonna S**
- Procurement Contracted: configurabile, default **T**
- Completion: **closed/finalized + PCT Approval**
- Contract preparation mostrato separatamente
- curva budget cliente letta dalla riga **TKW Razem** del file budget

## File principali
- `app.py` → server locale Flask + upload admin
- `dashboard_engine.py` → parser Excel + payload dashboard
- `report_exporter.py` → report Excel automatico con grafici
- `templates/index.html` → layout
- `static/js/app.js` → rendering UI e dettagli cliccabili
- `static/css/styles.css` → grafica
- `data/generated/dashboard-data.json` → snapshot corrente
- `data/reports/` → report Excel generati


V19: fascia alta più compatta con Procurement check ridotto e allineato a Last refresh / Source files.
