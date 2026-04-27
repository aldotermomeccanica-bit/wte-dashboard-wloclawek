from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from dashboard_engine import DashboardEngine, save_snapshot
from report_exporter import generate_excel_report

BASE_DIR = Path(__file__).resolve().parent
SEED_DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR / "config" / "settings.json"
DATA_DIR = Path(os.environ.get("WTE_DATA_DIR", str(SEED_DATA_DIR)))
CURRENT_DIR = DATA_DIR / "current"
GENERATED_DIR = DATA_DIR / "generated"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"
REPORTS_DIR = DATA_DIR / "reports"
DASHBOARD_JSON = GENERATED_DIR / "dashboard-data.json"

ALLOWED_EXTENSIONS = {".xlsx", ".xlsm"}



def ensure_runtime_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for runtime_dir in (CURRENT_DIR, GENERATED_DIR, SNAPSHOTS_DIR, REPORTS_DIR):
        runtime_dir.mkdir(parents=True, exist_ok=True)

    # If a persistent disk is mounted and starts empty, seed it with the bundled files.
    seed_current = SEED_DATA_DIR / "current"
    if seed_current.exists() and not any(CURRENT_DIR.iterdir()):
        for item in seed_current.iterdir():
            if item.is_file():
                shutil.copy2(item, CURRENT_DIR / item.name)

    seed_generated = SEED_DATA_DIR / "generated"
    if seed_generated.exists() and not DASHBOARD_JSON.exists():
        seed_dashboard = seed_generated / "dashboard-data.json"
        if seed_dashboard.exists():
            shutil.copy2(seed_dashboard, DASHBOARD_JSON)


ensure_runtime_directories()

app = Flask(__name__, static_folder="static", template_folder="templates")
engine = DashboardEngine(CONFIG_PATH)


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def current_files() -> dict[str, Path | None]:
    budget = next(iter(sorted(CURRENT_DIR.glob("*Budget*.xls*"))), None)
    procurement = next(iter(sorted(CURRENT_DIR.glob("*Procurement*.xls*"))), None)
    scurve = next(iter(sorted([p for p in CURRENT_DIR.glob("*.xls*") if ("curve" in p.name.lower() or "scuvrve" in p.name.lower()) and p != budget and p != procurement])), None)
    ecdecision = next(iter(sorted([p for p in CURRENT_DIR.glob("*.xls*") if ("ec decision" in p.name.lower() or "recommendation register" in p.name.lower()) and p != budget and p != procurement and p != scurve])), None)
    statusprogress = next(iter(sorted([p for p in CURRENT_DIR.glob("*.xls*") if ("status_eng_proc_cons" in p.name.lower() or "eng_proc_cons" in p.name.lower()) and p != budget and p != procurement and p != scurve and p != ecdecision])), None)
    if not budget:
        budget = next(iter(sorted(CURRENT_DIR.glob("*.xlsm"))), None)
    if not procurement:
        candidates = [p for p in CURRENT_DIR.glob("*.xlsx") if p != budget and p != scurve]
        procurement = candidates[0] if candidates else None
    return {"budget": budget, "procurement": procurement, "scurve": scurve, "ecdecision": ecdecision, "statusprogress": statusprogress}


def refresh_dashboard(files: dict[str, Path | None] | None = None) -> dict:
    files = files or current_files()
    if not files["budget"] or not files["procurement"]:
        return empty_payload()
    payload = engine.generate_payload(files["budget"], files["procurement"], files.get("scurve"), files.get("ecdecision"), files.get("statusprogress"))
    report_path = generate_excel_report(payload, REPORTS_DIR)
    payload.setdefault("meta", {})["reportFile"] = report_path.name
    payload.setdefault("meta", {})["reportPath"] = str(report_path.relative_to(BASE_DIR)).replace('\\', '/')
    save_snapshot(payload, DASHBOARD_JSON, SNAPSHOTS_DIR)
    return payload


def empty_payload() -> dict:
    return {
        "meta": {
            "projectTitle": engine.config["project_title"],
            "generatedAt": None,
            "currency": engine.config["currency"],
            "sourceFiles": {"budget": None, "procurement": None, "scurve": None, "ecdecision": None, "statusprogress": None},
            "columnMapping": {
                "budgetTotal": engine.config["budget"]["total_column"],
                "updatedBudget": engine.config["procurement"]["updated_budget_column"],
                "contracted": engine.config["procurement"]["contracted_column"],
            },
            "reportFile": None,
            "reportPath": None,
            "scurveReferenceMonth": None,
            "scurveUploadedAt": None,
        },
        "summary": {
            "overallStatus": "NO DATA",
            "overallTone": "neutral",
            "executiveMessage": "Upload Budget e Procurement in Admin per attivare la dashboard.",
            "budgetAbTotal": 0,
            "updatedBudgetTotal": 0,
            "contractedTotal": 0,
            "legacyBudgetTotal": 0,
            "varianceAmount": 0,
            "variancePct": 0,
            "contractCoveragePct": 0,
            "completionPct": 0,
            "weightedProgressPct": 0,
            "valueToAward": 0,
            "closedCount": 0,
            "openCount": 0,
            "overdueCount": 0,
            "contractPrepCount": 0,
            "pctApprovalCount": 0,
            "contractPrepValue": 0,
            "pctApprovalValue": 0,
            "specsIssuedCount": 0,
            "specsIssuedValue": 0,
        },
        "overview": {
            "sCurve": {"months": [], "labels": [], "procPct": [], "budgetPct": [], "contractedPct": [], "procAbs": [], "budgetAbs": [], "contractedAbs": []},
            "costBreakdown": [],
            "categoryBreakdown": [],
            "ordersClosing": {"count": 0, "value": 0, "items": []},
            "specsIssued": {"count": 0, "value": 0, "items": []},
            "timeline": {"months": [], "labels": [], "items": []},
        },
        "statusFunnel": [],
        "criticalPackages": [],
        "topOverruns": [],
        "rootGroups": [],
        "delayedByRoot": [],
        "upcomingMilestones": [],
        "directPackages": [],
        "notes": [],
        "ecDecision": {"title": "EC decision", "headers": [], "rows": [], "sourceSheet": "EC decision"},
        "statusProgress": {"title": "Status progress", "headers": [], "rows": [], "sourceSheet": "Eng_Proc_Cons"},
    }


def dashboard_is_stale() -> bool:
    if not DASHBOARD_JSON.exists():
        return True
    dash_mtime = DASHBOARD_JSON.stat().st_mtime
    for p in current_files().values():
        if p and p.exists() and p.stat().st_mtime > dash_mtime:
            return True
    return False


def latest_dashboard() -> dict:
    if DASHBOARD_JSON.exists() and not dashboard_is_stale():
        return json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
    files = current_files()
    if files["budget"] and files["procurement"]:
        return refresh_dashboard(files)
    return empty_payload()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/dashboard")
def api_dashboard():
    return jsonify(latest_dashboard())


@app.route("/api/admin/config", methods=["GET", "POST"])
def api_admin_config():
    global engine
    if request.method == "GET":
        return jsonify(engine.config)

    incoming = request.get_json(force=True)
    DashboardEngine._deep_update(engine.config, incoming)
    engine.save_config(CONFIG_PATH)
    engine = DashboardEngine(CONFIG_PATH)
    files = current_files()
    if files["budget"] and files["procurement"]:
        refresh_dashboard(files)
    return jsonify({"ok": True, "config": engine.config})


@app.route("/api/admin/upload", methods=["POST"])
def api_admin_upload():
    budget = request.files.get("budget")
    procurement = request.files.get("procurement")
    scurve = request.files.get("scurve")
    ecdecision = request.files.get("ecdecision")

    if not budget and not procurement and not scurve and not ecdecision:
        return jsonify({"ok": False, "error": "Carica almeno un file Excel."}), 400

    CURRENT_DIR.mkdir(parents=True, exist_ok=True)
    if budget:
        if not allowed_file(budget.filename):
            return jsonify({"ok": False, "error": "Budget file non valido."}), 400
        budget_name = secure_filename(budget.filename) or "Budget.xlsm"
        budget.save(CURRENT_DIR / budget_name)
    if procurement:
        if not allowed_file(procurement.filename):
            return jsonify({"ok": False, "error": "Procurement file non valido."}), 400
        proc_name = secure_filename(procurement.filename) or "Procurement.xlsx"
        procurement.save(CURRENT_DIR / proc_name)
    if scurve:
        if not allowed_file(scurve.filename):
            return jsonify({"ok": False, "error": "S-Curve file non valido."}), 400
        scurve_name = secure_filename(scurve.filename) or "S_Curve.xlsx"
        scurve.save(CURRENT_DIR / scurve_name)
    if ecdecision:
        if not allowed_file(ecdecision.filename):
            return jsonify({"ok": False, "error": "EC decision file non valido."}), 400
        ec_name = secure_filename(ecdecision.filename) or "EC_decision.xlsx"
        ecdecision.save(CURRENT_DIR / ec_name)

    files = current_files()
    if not files["budget"] or not files["procurement"]:
        return jsonify({"ok": False, "error": "Servono sia Budget che Procurement."}), 400

    payload = refresh_dashboard(files)
    return jsonify({"ok": True, "snapshot": Path(payload.get("meta", {}).get("reportFile") or "").stem, "dashboard": payload})


@app.route("/api/admin/history")
def api_admin_history():
    rows = []
    for path in sorted(SNAPSHOTS_DIR.glob("dashboard-*.json"), reverse=True):
        rows.append({"file": path.name, "modified": path.stat().st_mtime})
    return jsonify(rows)


@app.route("/api/admin/restore", methods=["POST"])
def api_admin_restore():
    data = request.get_json(force=True)
    file_name = data.get("file")
    path = SNAPSHOTS_DIR / file_name
    if not path.exists():
        return jsonify({"ok": False, "error": "Snapshot non trovato."}), 404
    DASHBOARD_JSON.write_bytes(path.read_bytes())
    return jsonify({"ok": True})


@app.route("/api/admin/reports")
def api_admin_reports():
    rows = []
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(REPORTS_DIR.glob("*.xlsx"), reverse=True):
        rows.append({"file": path.name, "modified": path.stat().st_mtime})
    return jsonify(rows)


@app.route("/reports/<path:filename>")
def download_report(filename: str):
    return send_from_directory(REPORTS_DIR, filename, as_attachment=True)


@app.route("/download/<path:filename>")
def download_file(filename: str):
    return send_from_directory(GENERATED_DIR, filename, as_attachment=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False)
