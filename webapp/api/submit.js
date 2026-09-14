// Fonction serveur Vercel : reçoit le formulaire et enregistre le résultat
// directement dans history.json sur GitHub (avec le token, gardé secret
// côté serveur — jamais visible depuis la page web).

const DOMAIN = process.env.TRACKED_DOMAIN || "cciamp.com";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { author = "", llm, label, prompt = "", response = "" } = req.body || {};
  if (!llm || !label || !response) {
    res.status(400).json({ error: "Champs manquants (llm, label, response requis)" });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    res.status(500).json({ error: "Variables d'environnement manquantes sur Vercel" });
    return;
  }

  const cited = response.toLowerCase().includes(DOMAIN.toLowerCase());
  const today = new Date().toISOString().slice(0, 10);
  const newEntry = {
    date: today,
    llm,
    label,
    prompt,
    author,
    status: "ok",
    excerpt: response.slice(0, 400),
    cited_urls: [],
    domain_cited_as_source: cited,
    domain_mentioned_in_text: cited,
  };

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/history.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    // On tente 2 fois au cas où deux personnes enregistrent en même temps
    // (conflit de version du fichier sur GitHub).
    for (let attempt = 0; attempt < 2; attempt++) {
      const getRes = await fetch(apiUrl, { headers });
      if (!getRes.ok) throw new Error(`Lecture de history.json impossible (${getRes.status})`);
      const file = await getRes.json();
      const current = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));
      current.push(newEntry);
      const updatedContent = Buffer.from(JSON.stringify(current, null, 2), "utf-8").toString("base64");

      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Ajout d'un test (${llm} — ${label})`,
          content: updatedContent,
          sha: file.sha,
        }),
      });

      if (putRes.ok) {
        res.status(200).json({ ok: true, cited });
        return;
      }
      if (putRes.status !== 409) {
        const errText = await putRes.text();
        throw new Error(`Échec de l'enregistrement (${putRes.status}) : ${errText}`);
      }
      // 409 = conflit, on retente une fois
    }
    throw new Error("Conflit persistant lors de l'enregistrement, réessaie.");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
