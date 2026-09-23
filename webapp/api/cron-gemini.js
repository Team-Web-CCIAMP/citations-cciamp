// Fonction serveur Vercel : interroge Gemini (gratuit, avec recherche web)
// sur toutes les requêtes de queries.yaml, et ajoute les résultats à
// history.json sur GitHub. Déclenchée automatiquement chaque semaine par
// Vercel Cron (voir vercel.json), et peut aussi être lancée manuellement
// depuis le bouton "🚀 Lancer l'auto Gemini maintenant" de la page.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const DOMAIN_ALIASES = ['cciamp.com', 'cciamp'];

module.exports = async (req, res) => {
  if (!GEMINI_KEY || !TOKEN || !OWNER || !REPO) {
    res.status(500).json({ error: "Variables d'environnement manquantes (GEMINI_API_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)." });
    return;
  }

  try {
    const queries = await fetchQueries();
    const today = new Date().toISOString().slice(0, 10);
    const newEntries = [];

    for (const q of queries) {
      if (!q.label || !q.prompt) continue;
      const result = await queryGemini(q.prompt);
      newEntries.push({
        date: today,
        llm: 'Gemini',
        theme: q.theme || '',
        label: q.label,
        prompt: q.prompt,
        status: result.status,
        excerpt: result.excerpt,
        cited_urls: result.citedUrls,
        domain_cited_as_source: result.citedAsSource,
        domain_mentioned_in_text: result.mentioned,
      });
    }

    const finalHistory = await appendToHistory(newEntries);
    res.status(200).json({ ok: true, added: newEntries.length, history_size: finalHistory.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Lecture et interprétation (simplifiée) de queries.yaml ---
async function fetchQueries() {
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/queries.yaml?t=${Date.now()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Lecture de queries.yaml impossible (${r.status})`);
  const text = await r.text();
  return parseQueriesYaml(text);
}

function stripQuotes(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Ce parseur comprend uniquement la structure exacte de queries.yaml telle
// que documentée dans ce fichier (des blocs "- label: / theme: / prompt: /
// url:"). Si un jour la structure change fondamentalement, ce parseur devra
// être adapté en conséquence.
function parseQueriesYaml(text) {
  const queries = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const itemMatch = line.match(/^\s*-\s*label:\s*(.+)$/);
    if (itemMatch) {
      if (current) queries.push(current);
      current = { label: stripQuotes(itemMatch[1]), theme: '', prompt: '', url: '' };
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^\s*(theme|prompt|url):\s*(.*)$/);
    if (fieldMatch) {
      current[fieldMatch[1]] = stripQuotes(fieldMatch[2]);
    }
  }
  if (current) queries.push(current);
  return queries;
}

// --- Appel Gemini avec recherche web ---
async function queryGemini(prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    // Le nom de cet outil de recherche a changé selon les versions de
    // l'API Gemini par le passé. Si cet appel échoue avec une erreur 400,
    // vérifie la doc à jour : https://ai.google.dev/gemini-api/docs/google-search
    tools: [{ google_search: {} }],
  };

  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { status: 'error', excerpt: 'Erreur réseau : ' + e.message, citedUrls: [], citedAsSource: false, mentioned: false };
  }

  if (!r.ok) {
    const t = await r.text();
    return { status: 'error', excerpt: `Erreur API Gemini (${r.status}) : ${t.slice(0, 200)}`, citedUrls: [], citedAsSource: false, mentioned: false };
  }

  const data = await r.json();
  let text = '';
  let citedUrls = [];
  try {
    const candidate = data.candidates[0];
    text = (candidate.content?.parts || []).map(p => p.text || '').join(' ');
    const chunks = candidate.groundingMetadata?.groundingChunks || [];
    citedUrls = chunks.map(c => c.web?.uri).filter(Boolean);
  } catch (e) {
    // réponse inattendue de l'API : on garde des valeurs vides plutôt que de planter
  }

  const lower = text.toLowerCase();
  const mentioned = DOMAIN_ALIASES.some(a => lower.includes(a));
  const citedAsSource = citedUrls.some(u => DOMAIN_ALIASES.some(a => u.toLowerCase().includes(a)));

  return { status: 'ok', excerpt: text.slice(0, 400), citedUrls, citedAsSource, mentioned };
}

// --- Écriture de l'historique sur GitHub (même logique que submit.js) ---
async function appendToHistory(newEntries) {
  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/history.json`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const getRes = await fetch(apiUrl, { headers });
    if (!getRes.ok) throw new Error(`Lecture de history.json impossible (${getRes.status})`);
    const file = await getRes.json();
    const current = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    const updated = [...current, ...newEntries];
    const updatedContent = Buffer.from(JSON.stringify(updated, null, 2), 'utf-8').toString('base64');

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Auto-suivi Gemini : ${new Date().toISOString().slice(0, 10)}`,
        content: updatedContent,
        sha: file.sha,
      }),
    });

    if (putRes.ok) return updated;
    if (putRes.status !== 409) {
      const t = await putRes.text();
      throw new Error(`Échec de l'écriture (${putRes.status}) : ${t}`);
    }
    // 409 = conflit, on retente une fois
  }
  throw new Error('Conflit persistant lors de l\'écriture, réessaie.');
}
