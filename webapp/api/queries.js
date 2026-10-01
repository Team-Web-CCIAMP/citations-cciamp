// Fonction serveur Vercel : réécrit entièrement queries.yaml sur GitHub,
// à partir du texte complet envoyé par la page (section "⚙️ Gérer mes
// requêtes"). Même principe de lecture-écriture que submit.js/delete.js.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { content } = req.body || {};
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "Contenu manquant" });
    return;
  }

  if (!TOKEN || !OWNER || !REPO) {
    res.status(500).json({ error: "Variables d'environnement manquantes sur Vercel" });
    return;
  }

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/queries.yaml`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const getRes = await fetch(apiUrl, { headers });
      if (!getRes.ok) throw new Error(`Lecture de queries.yaml impossible (${getRes.status})`);
      const file = await getRes.json();
      const updatedContent = Buffer.from(content, "utf-8").toString("base64");

      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: "Mise à jour des requêtes depuis le tracker",
          content: updatedContent,
          sha: file.sha,
        }),
      });

      if (putRes.ok) {
        res.status(200).json({ ok: true });
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
