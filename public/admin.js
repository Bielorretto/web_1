const $ = (id) => document.getElementById(id);

async function api(url, { method = 'GET', json } = {}) {
  const reponse = await fetch(url, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : undefined,
  });
  const donnees = await reponse.json().catch(() => null);
  if (reponse.status === 401 && url !== '/api/connexion') montrerConnexion();
  if (!reponse.ok) throw new Error(donnees?.erreur ?? `Erreur ${reponse.status}`);
  return donnees;
}

function statut(element, message, type = '') {
  element.textContent = message;
  element.className = `statut ${type}`;
}

function montrerConnexion() {
  $('tableau').hidden = true;
  $('connexion').hidden = false;
}

async function ouvrirTableau() {
  const { site } = await api('/api/site');
  const form = $('form-site');
  for (const champ of ['titre', 'nom', 'instagram', 'email']) form[champ].value = site[champ] ?? '';
  $('connexion').hidden = true;
  $('tableau').hidden = false;
}

$('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/connexion', { method: 'POST', json: { motdepasse: e.target.motdepasse.value } });
    // Une fois connectée, l'artiste modifie son site directement sur les pages.
    location.href = '/';
  } catch (err) {
    statut($('erreur-connexion'), err.message, 'erreur');
  }
});

$('deconnexion').addEventListener('click', async () => {
  await api('/api/deconnexion', { method: 'POST' });
  montrerConnexion();
});

$('form-site').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const zone = form.querySelector('.statut');
  try {
    const site = await api('/api/site', {
      method: 'PUT',
      json: { titre: form.titre.value, nom: form.nom.value, instagram: form.instagram.value, email: form.email.value },
    });
    form.instagram.value = site.instagram;
    statut(zone, 'Enregistré ✓', 'ok');
  } catch (err) {
    statut(zone, err.message, 'erreur');
  }
});

const { connecte } = await api('/api/session');
connecte ? ouvrirTableau() : montrerConnexion();
