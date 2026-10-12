const $ = (id) => document.getElementById(id);
const PAR_ENVOI = 5;

let oeuvres = [];

async function api(url, { method = 'GET', json, formData } = {}) {
  const reponse = await fetch(url, {
    method,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : formData,
  });
  const donnees = reponse.status === 204 ? null : await reponse.json().catch(() => null);
  if (reponse.status === 401 && url !== '/api/connexion') {
    montrerConnexion();
  }
  if (!reponse.ok) throw new Error(donnees?.erreur ?? `Erreur ${reponse.status}`);
  return donnees;
}

function statut(element, message, type = '') {
  element.textContent = message;
  element.className = `statut ${type}`;
  if (type === 'ok') setTimeout(() => { if (element.textContent === message) element.textContent = ''; }, 2500);
}

// ---------- Connexion ----------

function montrerConnexion() {
  $('tableau').hidden = true;
  $('connexion').hidden = false;
}

$('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const champ = e.target.motdepasse;
  try {
    await api('/api/connexion', { method: 'POST', json: { motdepasse: champ.value } });
    champ.value = '';
    statut($('erreur-connexion'), '');
    ouvrirTableau();
  } catch (err) {
    statut($('erreur-connexion'), err.message, 'erreur');
  }
});

$('deconnexion').addEventListener('click', async () => {
  await api('/api/deconnexion', { method: 'POST' });
  montrerConnexion();
});

// ---------- Tableau de bord ----------

async function ouvrirTableau() {
  const { artiste, oeuvres: liste } = await api('/api/galerie');
  $('connexion').hidden = true;
  $('tableau').hidden = false;

  const form = $('form-artiste');
  form.nom.value = artiste.nom;
  form.presentation.value = artiste.presentation;

  oeuvres = liste;
  afficherListe();
}

$('form-artiste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const zone = form.querySelector('.statut');
  try {
    await api('/api/artiste', {
      method: 'PUT',
      json: { nom: form.nom.value, presentation: form.presentation.value },
    });
    statut(zone, 'Enregistré ✓', 'ok');
  } catch (err) {
    statut(zone, err.message, 'erreur');
  }
});

function afficherListe() {
  const liste = $('liste');
  const modele = $('modele-oeuvre');
  liste.replaceChildren();
  $('nombre').textContent = oeuvres.length ? `(${oeuvres.length})` : '';

  if (!oeuvres.length) {
    const vide = document.createElement('li');
    vide.className = 'aide';
    vide.textContent = 'Aucune œuvre pour le moment. Ajoutez vos premières photos ci-dessus.';
    liste.append(vide);
    return;
  }

  oeuvres.forEach((oeuvre, index) => {
    const carte = modele.content.firstElementChild.cloneNode(true);
    const form = carte.querySelector('form');
    const zone = carte.querySelector('.statut');

    carte.querySelector('.apercu').src = `/media/${oeuvre.id}/miniature`;
    form.titre.value = oeuvre.titre;
    form.texte.value = oeuvre.texte;
    carte.querySelector('[data-action="monter"]').disabled = index === 0;
    carte.querySelector('[data-action="descendre"]').disabled = index === oeuvres.length - 1;

    form.addEventListener('input', () => statut(zone, 'Modifications non enregistrées', 'attente'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const maj = await api(`/api/oeuvres/${oeuvre.id}`, {
          method: 'PATCH',
          json: { titre: form.titre.value, texte: form.texte.value },
        });
        Object.assign(oeuvre, maj);
        statut(zone, 'Enregistré ✓', 'ok');
      } catch (err) {
        statut(zone, err.message, 'erreur');
      }
    });

    carte.querySelector('.outils').addEventListener('click', async (e) => {
      const action = e.target.closest('button')?.dataset.action;
      if (action === 'monter') deplacer(index, -1);
      if (action === 'descendre') deplacer(index, 1);
      if (action === 'supprimer') supprimer(oeuvre);
    });

    liste.append(carte);
  });
}

async function deplacer(index, sens) {
  const cible = index + sens;
  [oeuvres[index], oeuvres[cible]] = [oeuvres[cible], oeuvres[index]];
  afficherListe();
  try {
    await api('/api/ordre', { method: 'PUT', json: { ids: oeuvres.map((o) => o.id) } });
  } catch (err) {
    alert(err.message);
    ouvrirTableau();
  }
}

async function supprimer(oeuvre) {
  const nom = oeuvre.titre ? `« ${oeuvre.titre} »` : 'cette œuvre';
  if (!confirm(`Supprimer définitivement ${nom} ?`)) return;
  try {
    await api(`/api/oeuvres/${oeuvre.id}`, { method: 'DELETE' });
    oeuvres = oeuvres.filter((o) => o !== oeuvre);
    afficherListe();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Envoi des photos ----------

async function envoyer(fichiers) {
  const images = [...fichiers].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;

  const zone = $('statut-envoi');
  const refusees = [];
  let envoyees = 0;

  for (let i = 0; i < images.length; i += PAR_ENVOI) {
    statut(zone, `Envoi en cours… ${envoyees} / ${images.length}`, 'attente');
    const lot = images.slice(i, i + PAR_ENVOI);
    const formData = new FormData();
    lot.forEach((f) => formData.append('photos', f));
    try {
      const resultat = await api('/api/oeuvres', { method: 'POST', formData });
      oeuvres.push(...resultat.ajoutees);
      refusees.push(...resultat.refusees);
    } catch (err) {
      statut(zone, err.message, 'erreur');
      afficherListe();
      return;
    }
    envoyees += lot.length;
    afficherListe();
  }

  if (refusees.length) {
    statut(zone, `Photos illisibles ignorées : ${refusees.join(', ')}`, 'erreur');
  } else {
    statut(zone, `${images.length} photo(s) ajoutée(s) ✓ — ajoutez maintenant leurs titres et textes ci-dessous.`, 'ok');
  }
}

$('fichiers').addEventListener('change', (e) => {
  envoyer(e.target.files);
  e.target.value = '';
});

const depot = $('depot');
depot.addEventListener('dragover', (e) => {
  e.preventDefault();
  depot.classList.add('survol');
});
depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
depot.addEventListener('drop', (e) => {
  e.preventDefault();
  depot.classList.remove('survol');
  envoyer(e.dataTransfer.files);
});

// ---------- Démarrage ----------

const { connecte } = await api('/api/session');
connecte ? ouvrirTableau() : montrerConnexion();
