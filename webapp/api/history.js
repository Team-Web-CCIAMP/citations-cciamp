// Fonction serveur Vercel : lit history.json directement via l'API GitHub
// (pas via raw.githubusercontent.com, qui peut mettre plusieurs minutes à
// se mettre à jour après un changement). Garantit un affichage toujours à
// jour après un rechargement de page.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

module.exports = async (req, res) => {
  if (!TOKEN || !OWNER || !REPO) {
    res.status(500).json({ error: "Variables d'environnement manquantes (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)." });
    return;
  }

  try {
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/history.json`;
    const r = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!r.ok) throw new Error(`Lecture de history.json impossible (${r.status})`);
    const file = await r.json();
    const history = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8'));
    res.status(200).json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
