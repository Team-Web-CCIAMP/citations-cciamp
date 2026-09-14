#!/usr/bin/env python3
"""
Citation Tracker — suit l'apparition d'un domaine dans les réponses
d'un LLM branché sur la recherche web (Gemini, gratuit) et construit
un petit dashboard HTML avec historique, tendance et badges.

Modes :
  - auto   : interroge Gemini (API gratuite + Google Search grounding)
             pour chaque requête définie dans queries.yaml
  - manual : enregistre à la main un test fait sur un LLM sans API
             gratuite (ChatGPT, Perplexity...), via les inputs du
             workflow GitHub Actions (déclenchement manuel).

Rien de payant : Gemini Flash a un tier gratuit qui inclut le
grounding Google Search jusqu'à un quota quotidien/mensuel (voir
README). Si tu changes de modèle, vérifie sur ai.google.dev/pricing
que le grounding reste gratuit pour ce modèle.
"""

import os
import sys
import json
import datetime
import argparse
import requests
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUERIES_FILE = os.path.join(ROOT, "queries.yaml")
HISTORY_FILE = os.path.join(ROOT, "history.json")
DASHBOARD_FILE = os.path.join(ROOT, "docs", "index.html")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)


# ---------------------------------------------------------------------------
# Appel Gemini (gratuit) avec grounding Google Search
# ---------------------------------------------------------------------------
def query_gemini(prompt: str, api_key: str) -> dict:
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        # NB: le nom de l'outil de grounding a changé selon les versions
        # de l'API Gemini ("google_search" pour les modèles 1.5+/2.x/3.x).
        # Vérifie la doc officielle si cet appel renvoie une erreur 400 :
        # https://ai.google.dev/gemini-api/docs/grounding
        "tools": [{"google_search": {}}],
    }
    r = requests.post(
        GEMINI_ENDPOINT,
        params={"key": api_key},
        json=payload,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def analyze_gemini_response(response: dict, domain: str) -> dict:
    text = ""
    cited_urls = []
    try:
        candidate = response["candidates"][0]
        parts = candidate.get("content", {}).get("parts", [])
        text = " ".join(p.get("text", "") for p in parts)
        grounding = candidate.get("groundingMetadata", {})
        for chunk in grounding.get("groundingChunks", []):
            uri = chunk.get("web", {}).get("uri", "")
            if uri:
                cited_urls.append(uri)
    except (KeyError, IndexError):
        pass

    return {
        "excerpt": text[:400],
        "cited_urls": cited_urls,
        "domain_cited_as_source": any(domain in u for u in cited_urls),
        "domain_mentioned_in_text": domain in text,
    }


# ---------------------------------------------------------------------------
# Historique
# ---------------------------------------------------------------------------
def load_history() -> list:
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    return []


def save_history(history: list) -> None:
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def append_run(history: list, entries: list) -> list:
    run_date = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    for e in entries:
        e["date"] = run_date
    history.extend(entries)
    return history


# ---------------------------------------------------------------------------
# Mode automatique (Gemini, gratuit)
# ---------------------------------------------------------------------------
def run_auto(api_key: str) -> list:
    with open(QUERIES_FILE, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    domain = config["domain"]
    entries = []
    for q in config["queries"]:
        print(f"→ Interrogation Gemini : {q['label']}")
        try:
            raw = query_gemini(q["prompt"], api_key)
            result = analyze_gemini_response(raw, domain)
            status = "error" if False else "ok"
        except requests.HTTPError as exc:
            print(f"  ⚠️ Erreur API pour '{q['label']}': {exc}")
            result = {
                "excerpt": f"Erreur API: {exc}",
                "cited_urls": [],
                "domain_cited_as_source": False,
                "domain_mentioned_in_text": False,
            }
            status = "error"

        entries.append(
            {
                "llm": "Gemini",
                "label": q["label"],
                "prompt": q["prompt"],
                "status": status,
                **result,
            }
        )
    return entries


# ---------------------------------------------------------------------------
# Mode manuel (pour ChatGPT / Perplexity sans API gratuite)
# Déclenché via workflow_dispatch avec des inputs texte.
# ---------------------------------------------------------------------------
def run_manual(llm: str, label: str, prompt: str, pasted_response: str, domain: str, author: str = "") -> list:
    cited = domain in pasted_response
    return [
        {
            "llm": llm,
            "label": label,
            "prompt": prompt,
            "author": author.strip(),
            "status": "ok",
            "excerpt": pasted_response[:400],
            "cited_urls": [],
            "domain_cited_as_source": cited,
            "domain_mentioned_in_text": cited,
        }
    ]


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
def compute_stats(history: list) -> dict:
    if not history:
        return {"runs": [], "streak": 0, "score": 0, "total": 0, "badges": []}

    by_date = {}
    for e in history:
        by_date.setdefault(e["date"], []).append(e)

    dates = sorted(by_date.keys())
    runs = []
    for d in dates:
        entries = by_date[d]
        cited = sum(1 for e in entries if e["domain_cited_as_source"] or e["domain_mentioned_in_text"])
        runs.append({"date": d, "cited": cited, "total": len(entries)})

    # streak = nombre de dates consécutives (les plus récentes) avec >=1 citation
    streak = 0
    for r in reversed(runs):
        if r["cited"] > 0:
            streak += 1
        else:
            break

    last = runs[-1]
    score = round(100 * last["cited"] / last["total"]) if last["total"] else 0

    badges = []
    if streak >= 3:
        badges.append(f"🔥 {streak} suivis consécutifs avec citation")
    if score == 100:
        badges.append("🏆 Score parfait sur le dernier passage")
    if len(runs) >= 2 and runs[-1]["cited"] > runs[-2]["cited"]:
        badges.append("📈 Progression depuis le dernier suivi")
    new_citations = [
        e for e in history
        if e["date"] == last["date"]
        and (e["domain_cited_as_source"] or e["domain_mentioned_in_text"])
    ]
    if new_citations:
        badges.append(f"✨ {len(new_citations)} citation(s) détectée(s) ce passage")

    # Classement ludique des contributeurs (uniquement les entrées avec un auteur renseigné)
    leaderboard_count = {}
    for e in history:
        author = (e.get("author") or "").strip()
        if not author:
            continue
        leaderboard_count[author] = leaderboard_count.get(author, 0) + 1
    leaderboard = sorted(leaderboard_count.items(), key=lambda kv: kv[1], reverse=True)

    return {
        "runs": runs, "streak": streak, "score": score, "total": last["total"],
        "badges": badges, "leaderboard": leaderboard,
    }


def build_dashboard(history: list, site_label: str) -> str:
    stats = compute_stats(history)
    history_json = json.dumps(history, ensure_ascii=False)
    runs_json = json.dumps(stats["runs"], ensure_ascii=False)
    badges_html = "".join(f'<span class="badge">{b}</span>' for b in stats["badges"]) or (
        '<span class="badge muted">Pas encore de badge — au prochain passage !</span>'
    )

    medals = ["🥇", "🥈", "🥉"]
    leaderboard_rows = "".join(
        f"<tr><td>{medals[i] if i < 3 else '　'}</td><td>{name}</td><td>{count}</td></tr>"
        for i, (name, count) in enumerate(stats["leaderboard"][:8])
    )
    leaderboard_html = ""
    if stats["leaderboard"]:
        leaderboard_html = f"""
  <h2>🏆 Chasseurs de citations</h2>
  <table><thead><tr><th></th><th>Contributeur·rice</th><th>Tests réalisés</th></tr></thead>
  <tbody>{leaderboard_rows}</tbody></table>
"""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Suivi citations IA — {site_label}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<style>
  body {{ font-family: -apple-system, Segoe UI, sans-serif; background:#0f1117; color:#e8e8ef; margin:0; padding:2rem; }}
  h1 {{ font-size:1.4rem; margin-bottom:0.2rem; }}
  .sub {{ color:#9a9ab0; margin-bottom:1.5rem; }}
  .cards {{ display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1.5rem; }}
  .card {{ background:#1b1e2b; border-radius:12px; padding:1rem 1.4rem; min-width:150px; }}
  .card .big {{ font-size:2rem; font-weight:700; }}
  .card .lbl {{ color:#9a9ab0; font-size:0.85rem; }}
  .badge {{ display:inline-block; background:#26304a; padding:0.35rem 0.7rem; border-radius:999px; margin:0.2rem; font-size:0.85rem; }}
  .badge.muted {{ background:#20222e; color:#7d7d90; }}
  table {{ width:100%; border-collapse:collapse; margin-top:1rem; font-size:0.9rem; }}
  th, td {{ text-align:left; padding:0.5rem 0.6rem; border-bottom:1px solid #262838; }}
  th {{ color:#9a9ab0; font-weight:600; }}
  .yes {{ color:#4ade80; font-weight:700; }}
  .no {{ color:#5a5a6e; }}
  canvas {{ background:#1b1e2b; border-radius:12px; padding:1rem; max-width:100%; }}
</style>
</head>
<body>
  <h1>🔎 Suivi des citations IA — {site_label}</h1>
  <div class="sub">Dernière mise à jour automatique. Domaine suivi : <b>{site_label}</b></div>

  <div class="cards">
    <div class="card"><div class="big">{stats['score']}%</div><div class="lbl">Score du dernier passage</div></div>
    <div class="card"><div class="big">{stats['streak']}</div><div class="lbl">Streak (passages consécutifs cités)</div></div>
    <div class="card"><div class="big">{len(stats['runs'])}</div><div class="lbl">Passages historisés</div></div>
  </div>

  <div>{badges_html}</div>

  <canvas id="trend" height="90"></canvas>
{leaderboard_html}
  <h2>Détail du dernier passage</h2>
  <table id="detail-table">
    <thead><tr><th>LLM</th><th>Requête</th><th>Cité ?</th><th>Extrait</th></tr></thead>
    <tbody></tbody>
  </table>

<script>
const history = {history_json};
const runs = {runs_json};

new Chart(document.getElementById('trend'), {{
  type: 'line',
  data: {{
    labels: runs.map(r => r.date),
    datasets: [{{
      label: 'Requêtes citant {site_label}',
      data: runs.map(r => r.cited),
      borderColor: '#4ade80',
      backgroundColor: 'rgba(74,222,128,0.15)',
      tension: 0.3,
      fill: true,
    }},
    {{
      label: 'Total requêtes testées',
      data: runs.map(r => r.total),
      borderColor: '#5a5a6e',
      borderDash: [4,4],
      tension: 0.3,
    }}]
  }},
  options: {{
    plugins: {{ legend: {{ labels: {{ color: '#e8e8ef' }} }} }},
    scales: {{
      x: {{ ticks: {{ color: '#9a9ab0' }}, grid: {{ color: '#262838' }} }},
      y: {{ ticks: {{ color: '#9a9ab0' }}, grid: {{ color: '#262838' }}, beginAtZero: true }}
    }}
  }}
}});

const lastDate = runs.length ? runs[runs.length - 1].date : null;
const lastEntries = history.filter(e => e.date === lastDate);
const tbody = document.querySelector('#detail-table tbody');
lastEntries.forEach(e => {{
  const cited = e.domain_cited_as_source || e.domain_mentioned_in_text;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${{e.llm}}</td><td>${{e.label}}</td><td class="${{cited ? 'yes' : 'no'}}">${{cited ? '✅ Oui' : '— Non'}}</td><td>${{(e.excerpt || '').slice(0,140)}}…</td>`;
  tbody.appendChild(tr);
}});
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Notification gratuite optionnelle (ntfy.sh — aucune inscription requise)
# ---------------------------------------------------------------------------
def notify(entries: list, domain: str) -> None:
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        return
    cited = [e for e in entries if e["domain_cited_as_source"] or e["domain_mentioned_in_text"]]
    msg = (
        f"✅ {len(cited)}/{len(entries)} requêtes citent {domain} aujourd'hui"
        if entries else "Aucune requête testée."
    )
    try:
        requests.post(f"https://ntfy.sh/{topic}", data=msg.encode("utf-8"), timeout=15)
    except requests.RequestException as exc:
        print(f"  ⚠️ Notification ntfy.sh échouée : {exc}")


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["auto", "manual"], default="auto")
    parser.add_argument("--llm", default="")
    parser.add_argument("--label", default="")
    parser.add_argument("--prompt", default="")
    parser.add_argument("--response", default="")
    parser.add_argument("--author", default="")
    args = parser.parse_args()

    with open(QUERIES_FILE, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    domain = config["domain"]
    site_label = config["site_label"]

    history = load_history()

    if args.mode == "auto":
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("❌ Variable d'environnement GEMINI_API_KEY manquante.")
            sys.exit(1)
        entries = run_auto(api_key)
    else:
        if not (args.llm and args.label and args.response):
            print("❌ Mode manuel : --llm, --label et --response sont requis.")
            sys.exit(1)
        entries = run_manual(args.llm, args.label, args.prompt, args.response, domain, args.author)

    history = append_run(history, entries)
    save_history(history)

    dashboard_html = build_dashboard(history, site_label)
    os.makedirs(os.path.dirname(DASHBOARD_FILE), exist_ok=True)
    with open(DASHBOARD_FILE, "w", encoding="utf-8") as f:
        f.write(dashboard_html)

    notify(entries, domain)
    print(f"✅ {len(entries)} entrée(s) ajoutée(s). Dashboard régénéré : {DASHBOARD_FILE}")


if __name__ == "__main__":
    main()
