// Fonction serveur Vercel : supprime une entrée de history.json sur GitHub,
// identifiée par sa position (index) dans le tableau au moment de l'appel.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { indices } = req.body || {};
  if (!Array.isArray(indices) || indices.length === 0) {
    res.status(400).json({ error: "Indices manquants ou invalides" });
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    res.status(500).json({ error: "Variables d'environnement manquantes sur Vercel" });
    return;
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/history.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    // On tente 2 fois au cas où deux personnes modifient en même temps
    // (conflit de version du fichier sur GitHub).
    for (let attempt = 0; attempt < 2; attempt++) {
      const getRes = await fetch(apiUrl, { headers });
      if (!getRes.ok) throw new Error(`Lecture de history.json impossible (${getRes.status})`);
      const file = await getRes.json();
      const current = JSON.parse(Buffer.from(file.content, "base64").toString("utf-8"));

      if (indices.some(i => i >= current.length || i < 0)) {
        res.status(400).json({ error: "Une des entrées n'existe plus (la liste a peut-être changé entre-temps, recharge la page)." });
        return;
      }
      // On supprime en partant des index les plus grands pour ne pas décaler
      // les positions des entrées restant à supprimer.
      [...indices].sort((a, b) => b - a).forEach(i => current.splice(i, 1));
      const updatedContent = Buffer.from(JSON.stringify(current, null, 2), "utf-8").toString("base64");

      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: "Suppression d'un test",
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
        throw new Error(`Échec de la suppression (${putRes.status}) : ${errText}`);
      }
      // 409 = conflit, on retente une fois
    }
    throw new Error("Conflit persistant lors de la suppression, réessaie.");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
