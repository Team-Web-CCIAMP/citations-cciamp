// Fonction serveur Vercel : corrige à la main le résultat "Cité ?" d'une
// ligne de l'historique, et écrit la modification dans history.json sur
// GitHub. Conserve la trace de la détection automatique d'origine
// (auto_cited) et marque la ligne comme modifiée manuellement.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { index, cited, expect } = req.body || {};
  if (typeof index !== "number" || index < 0 || typeof cited !== "boolean") {
    res.status(400).json({ error: "Paramètres invalides (index et cited requis)" });
    return;
  }

  if (!TOKEN || !OWNER || !REPO) {
    res.status(500).json({ error: "Variables d'environnement manquantes sur Vercel" });
    return;
  }

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/history.json`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const getRes = await fetch(apiUrl, { headers });
      if (!getRes.ok) throw new Error(`Lecture de history.json impossible (${getRes.status})`);
      const file = await getRes.json();
      const current = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));

      const entry = current[index];
      if (!entry) {
        res.status(400).json({ error: "Cette ligne n'existe plus. Clique sur Actualiser puis réessaie." });
        return;
      }
      // Garde-fou : la ligne à cette position doit être celle que l'utilisateur voit.
      if (expect && (entry.date !== expect.date || entry.llm !== expect.llm || entry.label !== expect.label)) {
        res.status(400).json({ error: "La liste a changé entre-temps. Clique sur Actualiser puis réessaie." });
        return;
      }

      if (!("auto_cited" in entry)) {
        entry.auto_cited = !!(entry.domain_cited_as_source || entry.domain_mentioned_in_text);
      }
      entry.domain_cited_as_source = cited;
      entry.domain_mentioned_in_text = cited;
      entry.manual_override = true;

      const updatedContent = Buffer.from(JSON.stringify(current, null, 2), "utf-8").toString("base64");
      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Correction manuelle "Cité ?" (${entry.llm} — ${entry.label}) : ${cited ? "oui" : "non"}`,
          content: updatedContent,
          sha: file.sha,
        }),
      });

      if (putRes.ok) {
        res.status(200).json({ ok: true, history: current });
        return;
      }
      if (putRes.status !== 409) {
        const errText = await putRes.text();
        throw new Error(`Échec de l'enregistrement (${putRes.status}) : ${errText}`);
      }
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
    }
    throw new Error("Conflit persistant lors de l'enregistrement, réessaie.");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
