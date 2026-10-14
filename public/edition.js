// Mode édition : chargé uniquement quand l'artiste est connectée.
// Toute modification est enregistrée en brouillon ; les visiteurs ne voient que la version publiée.
//
// Placement libre : un bloc s'attrape n'importe où pour être déplacé, se redimensionne par son coin,
// et un clic sur un texte permet de l'écrire. Les positions sont en millièmes de la largeur de la page.

import { el, figure, classesBloc, texteRiche, trierBlocs, placer, tuileOeuvre, compositionLibre } from '/commun.js';
import { navigationOeuvre, boutonFermer } from '/site.js';

const LARGEUR = 1000;
const LARGEUR_MIN = 40;
const SEUIL_DEPLACEMENT = 4; // px : en dessous, c'est un clic et non un déplacement
const DELAI_ENREGISTREMENT = 700;

let ctx;
let db;
let actif = false;
let apercuMobile = false;
let courant = null; // { type, cle, element, version } : la page affichée et sa copie de travail
let blocsParId = new Map();
let selection = null; // id du bloc sélectionné
let minuterie = null;
let enregistrementEnCours = Promise.resolve();
let barre;

// ---------- Outils ----------

async function api(url, { method = 'GET', json, formData, keepalive } = {}) {
  const reponse = await fetch(url, {
    method,
    keepalive,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : formData,
  });
  const donnees = reponse.status === 204 ? null : await reponse.json().catch(() => null);
  if (reponse.status === 401) {
    alert('Votre session a expiré. Reconnectez-vous : vos dernières modifications non enregistrées seront perdues.');
    location.href = '/admin';
  }
  if (!reponse.ok) throw new Error(donnees?.erreur ?? `Erreur ${reponse.status}`);
  return donnees;
}

const bouton = (texte, attributs = {}) => el('button', { type: 'button', ...attributs }, texte);
const copie = (valeur) => structuredClone(valeur);
const nouvelId = () => crypto.randomUUID();
const borner = (valeur, min, max) => Math.min(max, Math.max(min, valeur));
const arrondir = (valeur) => Math.round(valeur * 10) / 10;
const versionCourante = (element) => element.brouillon ?? element.publie;
const libre = () => ctx.contenu.querySelector('.libre-edition');
const unite = () => libre().clientWidth / LARGEUR; // pixels par millième

// ---------- Page courante ----------

function trouverCourant(route) {
  if (route.type === 'page') return { type: 'page', cle: route.nom, element: db.pages[route.nom] };
  if (route.type === 'galerie') return { type: 'galerie', cle: route.categorie, element: db.galeries[route.categorie] };
  if (route.type === 'oeuvre') {
    const oeuvre = db.oeuvres.find((o) => o.categorie === route.categorie && o.slug === route.slug);
    if (oeuvre) return { type: 'oeuvre', cle: oeuvre.id, element: oeuvre };
  }
  return null;
}

const urlBrouillon = () => `/api/brouillon/${courant.type}/${encodeURIComponent(courant.cle)}`;

function planifierEnregistrement() {
  clearTimeout(minuterie);
  statut('Modifications en cours…');
  minuterie = setTimeout(enregistrer, DELAI_ENREGISTREMENT);
}

function enregistrer({ keepalive = false } = {}) {
  if (!minuterie || !courant) return enregistrementEnCours;
  clearTimeout(minuterie);
  minuterie = null;
  const { element, version } = courant;
  const url = urlBrouillon();
  enregistrementEnCours = enregistrementEnCours
    .then(() => api(url, { method: 'PUT', json: version, keepalive }))
    .then((maj) => {
      element.brouillon = maj.brouillon;
      if (courant?.element === element) {
        statut('Brouillon enregistré ✓ — pas encore visible par les visiteurs');
        majBarre();
      }
    })
    .catch((err) => statut(`Erreur : ${err.message}`, 'erreur'));
  return enregistrementEnCours;
}

// ---------- Barre d'édition ----------

let messageStatut = '';
let typeStatut = '';
function statut(message, type = '') {
  messageStatut = message;
  typeStatut = type;
  const zone = barre.querySelector('.barre-statut');
  if (zone) {
    zone.textContent = message;
    zone.className = `barre-statut ${type}`;
  }
}

function majBarre() {
  if (!courant) {
    barre.replaceChildren(
      el('span', { class: 'barre-statut', text: 'Cette page ne se modifie pas.' }),
      el('div', { class: 'barre-actions' }, el('a', { href: '/admin', class: 'bouton-lien', text: 'Réglages' })),
    );
    return;
  }
  const aUnBrouillon = !!courant.element.brouillon;

  if (!actif) {
    barre.replaceChildren(
      el('span', { class: 'barre-statut', text: aUnBrouillon ? 'Brouillon en cours, non publié' : 'Version publiée' }),
      el('div', { class: 'barre-actions' },
        el('a', { href: '/admin', class: 'bouton-lien', text: 'Réglages' }),
        bouton('Modifier cette page', { class: 'principal', 'data-action': 'modifier' })),
    );
    return;
  }

  const estGalerie = courant.type === 'galerie';
  const jamaisPubliee = courant.type === 'oeuvre' && !courant.element.publie;
  const fichiers = (libelle, action) =>
    el('label', { class: 'bouton' }, libelle, el('input', { type: 'file', accept: 'image/*', multiple: '', 'data-action': action }));
  barre.replaceChildren(
    el('span', { class: `barre-statut ${typeStatut}`, text: messageStatut || (aUnBrouillon ? 'Brouillon en cours, non publié' : 'Aucune modification') }),
    el('div', { class: 'barre-actions' },
      !apercuMobile && bouton('+ Texte', { 'data-action': 'texte' }),
      !apercuMobile && fichiers(estGalerie ? '+ Œuvres' : '+ Image', estGalerie ? 'oeuvres' : 'images'),
      bouton(apercuMobile ? "Retour à l'édition" : 'Aperçu téléphone', { 'data-action': 'apercu' }),
      aUnBrouillon && !jamaisPubliee && bouton('Abandonner le brouillon', { class: 'danger', 'data-action': 'abandonner' }),
      bouton('Publier', { class: 'principal', 'data-action': 'publier', ...(aUnBrouillon ? {} : { disabled: '' }) }),
      bouton('Terminer', { 'data-action': 'terminer' })),
  );
}

async function actionBarre(action) {
  if (action === 'modifier') {
    actif = true;
    messageStatut = '';
    ctx.rendre();
  } else if (action === 'terminer') {
    await enregistrer();
    actif = false;
    apercuMobile = false;
    ctx.rendre();
  } else if (action === 'apercu') {
    await enregistrer();
    apercuMobile = !apercuMobile;
    ctx.rendre();
  } else if (action === 'texte') {
    ajouterTexte();
  } else if (action === 'publier') {
    await publier();
  } else if (action === 'abandonner') {
    await abandonner();
  }
}

async function publier() {
  await enregistrer();
  statut('Publication…');
  try {
    const { type, cle } = courant;
    db = await api(`/api/publier/${type}/${encodeURIComponent(cle)}`, { method: 'POST' });
    await ctx.rechargerPublic();
    messageStatut = 'Publié ✓ — visible par tous';
    typeStatut = 'ok';
    // L'adresse d'une œuvre peut changer à sa première publication (titre → adresse).
    if (type === 'oeuvre') {
      const oeuvre = db.oeuvres.find((o) => o.id === cle);
      const url = `/${oeuvre.categorie}/${oeuvre.slug}`;
      if (url !== location.pathname) history.replaceState(history.state, '', url);
    }
    courant = null;
    ctx.rendre();
  } catch (err) {
    statut(`Erreur : ${err.message}`, 'erreur');
  }
}

async function abandonner() {
  if (!confirm('Abandonner le brouillon et revenir à la version publiée ? Vos modifications non publiées seront perdues.')) return;
  clearTimeout(minuterie);
  minuterie = null;
  await enregistrementEnCours;
  try {
    await api(urlBrouillon(), { method: 'DELETE' });
    db = await api('/api/edition');
    messageStatut = 'Brouillon abandonné';
    typeStatut = '';
    courant = null;
    ctx.rendre();
  } catch (err) {
    statut(`Erreur : ${err.message}`, 'erreur');
  }
}

// ---------- Rendu ----------

// Les tuiles de galerie affichent l'œuvre dans sa version la plus récente (brouillon compris).
function infosOeuvre(id) {
  const oeuvre = db.oeuvres.find((o) => o.id === id);
  if (!oeuvre) return null;
  const { titre, couverture } = versionCourante(oeuvre);
  return { categorie: oeuvre.categorie, slug: oeuvre.slug, titre, couverture, oeuvre };
}

function rendre(route) {
  enregistrer();
  const precedent = courant;
  courant = trouverCourant(route);
  if (courant) {
    // On reprend la copie de travail si on revient sur la même page (ex. après l'aperçu).
    const memePage = precedent && precedent.type === courant.type && precedent.cle === courant.cle;
    courant.version = memePage ? precedent.version : copie(versionCourante(courant.element));
    if (precedent && !memePage) {
      messageStatut = '';
      typeStatut = '';
    }
  }
  selection = null;
  if (!courant) return undefined;

  if (!actif) {
    // Une œuvre jamais publiée n'existe pas encore pour les visiteurs.
    if (courant.type === 'oeuvre' && !courant.element.publie) {
      return el('p', { class: 'vide', text: 'Cette œuvre est en brouillon. Cliquez sur « Modifier cette page » pour la compléter.' });
    }
    return undefined;
  }

  if (apercuMobile) {
    const blocs = courant.version.blocs.flatMap((b) => {
      if (b.type !== 'oeuvre') return [b];
      const oeuvre = infosOeuvre(b.oeuvreId);
      return oeuvre ? [{ ...b, oeuvre }] : [];
    });
    return el('div', { class: 'apercu-mobile' }, el('div', { class: 'apercu-cadre' }, compositionLibre(blocs)));
  }
  return courant.type === 'oeuvre' ? vueOeuvre() : vueComposition();
}

function apresRendu() {
  majBarre();
}

// ---------- Composition éditable ----------

function vueComposition() {
  blocsParId = new Map();
  const zone = el('div', { class: 'libre libre-edition' });
  for (const bloc of trierBlocs(courant.version.blocs)) zone.append(elementBloc(bloc));
  activerManipulation(zone);
  return el('div', { class: 'zone-libre zone-edition' }, zone,
    el('p', { class: 'aide-edition', text: courant.type === 'galerie'
      ? 'Glissez des photos sur la page pour ajouter des œuvres. Attrapez une œuvre pour la déplacer, tirez son coin pour la redimensionner.'
      : 'Glissez des images sur la page. Attrapez un bloc pour le déplacer, tirez son coin pour le redimensionner, cliquez dans un texte pour l’écrire.' }));
}

function elementBloc(bloc) {
  blocsParId.set(bloc.id, bloc);
  const element = el('div', { class: `${classesBloc(bloc)} bloc-edite`, tabindex: '-1', 'data-id': bloc.id });
  placer(element, bloc);

  let contenu;
  if (bloc.type === 'texte') {
    contenu = texteRiche(bloc.html);
    contenu.contentEditable = 'true';
    contenu.addEventListener('input', () => {
      bloc.html = contenu.innerHTML;
      planifierEnregistrement();
    });
    // Coller du texte sans la mise en forme d'origine (Word, sites web…).
    contenu.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  } else if (bloc.type === 'image') {
    contenu = figure(bloc.image, bloc.w >= 450 ? 'grand' : 'moyen', '');
    const legende = el('figcaption', { class: 'legende', 'data-indice': 'Ajouter une légende…' });
    legende.textContent = bloc.legende;
    legende.contentEditable = 'plaintext-only';
    legende.addEventListener('input', () => {
      bloc.legende = legende.innerText.trim();
      planifierEnregistrement();
    });
    contenu.append(legende);
  } else {
    const infos = infosOeuvre(bloc.oeuvreId);
    contenu = el('div', {},
      tuileOeuvre({ ...infos, titre: infos.titre || 'Sans titre' }, false),
      !infos.oeuvre.publie && el('span', { class: 'pastille', text: 'nouvelle' }),
      infos.oeuvre.publie && infos.oeuvre.brouillon && el('span', { class: 'pastille', text: 'brouillon' }));
  }

  element.append(outilsBloc(bloc, element, contenu), contenu, el('span', { class: 'poignee-taille', title: 'Redimensionner' }));
  return element;
}

function selectionner(id) {
  selection = id;
  for (const element of libre()?.querySelectorAll('.bloc-edite') ?? []) {
    element.classList.toggle('selectionne', element.dataset.id === id);
  }
}

// Place le curseur de texte à l'endroit cliqué.
function placerCurseur(x, y) {
  let range = document.caretRangeFromPoint?.(x, y);
  if (!range && document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  }
  if (!range) return;
  const choix = getSelection();
  choix.removeAllRanges();
  choix.addRange(range);
}

function activerManipulation(zone) {
  let geste = null;

  zone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const element = e.target.closest('.bloc-edite');
    if (!element) {
      selectionner(null);
      return;
    }
    if (e.target.closest('.outils-bloc')) return;
    const bloc = blocsParId.get(element.dataset.id);
    const editable = e.target.closest('[contenteditable]');
    // Pendant l'écriture, la souris sélectionne du texte au lieu de déplacer le bloc.
    if (editable && editable.contains(document.activeElement)) return;

    e.preventDefault();
    selectionner(bloc.id);
    element.focus({ preventScroll: true });
    geste = {
      type: e.target.closest('.poignee-taille') ? 'taille' : 'deplacement',
      element,
      bloc,
      editable,
      departX: e.pageX,
      departY: e.pageY,
      x: bloc.x,
      y: bloc.y,
      w: bloc.w,
      bouge: false,
    };
    element.setPointerCapture(e.pointerId);
  });

  zone.addEventListener('pointermove', (e) => {
    if (!geste) return;
    const dx = e.pageX - geste.departX;
    const dy = e.pageY - geste.departY;
    if (!geste.bouge && Math.hypot(dx, dy) < SEUIL_DEPLACEMENT) return;
    geste.bouge = true;
    geste.element.classList.add('en-mouvement');
    const { bloc } = geste;
    if (geste.type === 'taille') {
      bloc.w = arrondir(borner(geste.w + dx / unite(), LARGEUR_MIN, LARGEUR - bloc.x));
    } else {
      bloc.x = arrondir(borner(geste.x + dx / unite(), 0, LARGEUR - bloc.w));
      bloc.y = arrondir(Math.max(0, geste.y + dy / unite()));
      // Près du bas de l'écran, la page défile pour pouvoir descendre le bloc.
      if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
    }
    placer(geste.element, bloc);
  });

  const finir = (e) => {
    if (!geste) return;
    const { bouge, editable, element } = geste;
    geste = null;
    element.classList.remove('en-mouvement');
    if (bouge) planifierEnregistrement();
    else if (editable) {
      // Un simple clic dans un texte : on se met à écrire à cet endroit.
      editable.focus();
      placerCurseur(e.clientX, e.clientY);
    }
  };
  zone.addEventListener('pointerup', finir);
  zone.addEventListener('pointercancel', finir);
}

function supprimerBloc(bloc, element) {
  courant.version.blocs = courant.version.blocs.filter((b) => b !== bloc);
  blocsParId.delete(bloc.id);
  element.remove();
  selection = null;
  planifierEnregistrement();
}

function outilsBloc(bloc, element, contenu) {
  const outils = el('div', { class: 'outils-bloc' });
  const action = (libelle, titre, fn, attributs = {}) => {
    const b = bouton(libelle, { title: titre, ...attributs });
    // mousedown + preventDefault : la sélection dans le texte est conservée.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', fn);
    return b;
  };

  if (bloc.type === 'texte') {
    const style = el('select', { title: 'Style du texte' },
      ...[['texte', 'Texte'], ['titre', 'Titre'], ['legende', 'Légende']].map(([v, t]) => el('option', { value: v, text: t })));
    style.value = bloc.style;
    style.addEventListener('change', () => {
      bloc.style = style.value;
      element.className = `${classesBloc(bloc)} bloc-edite selectionne`;
      planifierEnregistrement();
    });
    const alignement = el('select', { title: 'Alignement' },
      ...[['gauche', '⯇ gauche'], ['centre', '≡ centré'], ['droite', 'droite ⯈']].map(([v, t]) => el('option', { value: v, text: t })));
    alignement.value = bloc.align;
    alignement.addEventListener('change', () => {
      bloc.align = alignement.value;
      element.className = `${classesBloc(bloc)} bloc-edite selectionne`;
      planifierEnregistrement();
    });
    const commande = (libelle, titre, fn) => action(libelle, titre, () => {
      contenu.focus();
      fn();
      bloc.html = contenu.innerHTML;
      planifierEnregistrement();
    });
    outils.append(
      style,
      alignement,
      commande('G', 'Gras', () => document.execCommand('bold')),
      commande('I', 'Italique', () => document.execCommand('italic')),
      commande('lien', 'Ajouter un lien sur le texte sélectionné', () => {
        const adresse = prompt('Adresse du lien (https://… ou mailto:adresse@exemple.fr) :');
        if (adresse) document.execCommand('createLink', false, adresse.trim());
      }),
    );
  } else if (bloc.type === 'image' && courant.type === 'oeuvre') {
    const estCouverture = courant.version.couverture?.id === bloc.image.id;
    outils.append(action(estCouverture ? '★ image de la galerie' : '☆ image de la galerie', 'Utiliser cette image dans la galerie', () => {
      courant.version.couverture = bloc.image;
      planifierEnregistrement();
      ctx.rendre();
    }, { 'aria-pressed': String(estCouverture) }));
  } else if (bloc.type === 'oeuvre') {
    const infos = infosOeuvre(bloc.oeuvreId);
    outils.append(el('a', { href: `/${infos.categorie}/${infos.slug}`, class: 'lien-outil', text: 'Modifier l’œuvre →' }));
  }

  const mobile = action('📱', 'Masquer sur téléphone', () => {
    bloc.mobileMasque = !bloc.mobileMasque;
    mobile.setAttribute('aria-pressed', String(bloc.mobileMasque));
    element.classList.toggle('masque-mobile', bloc.mobileMasque);
    planifierEnregistrement();
  }, { 'aria-pressed': String(bloc.mobileMasque) });

  outils.append(
    mobile,
    action('✕', bloc.type === 'oeuvre' ? 'Retirer de la galerie' : 'Supprimer', () => {
      const question = {
        image: 'Retirer cette image de la page ?',
        texte: 'Supprimer ce texte ?',
        oeuvre: 'Retirer cette œuvre de la galerie ? Elle sera supprimée à la publication.',
      }[bloc.type];
      if (confirm(question)) supprimerBloc(bloc, element);
    }, { class: 'danger' }),
  );
  return outils;
}

// ---------- Ajouts ----------

// Position (en millièmes) d'un point de l'écran dans la composition.
function positionDepuisEcran(clientX, clientY) {
  const rect = libre().getBoundingClientRect();
  return { x: (clientX - rect.left) / unite(), y: Math.max(0, (clientY - rect.top) / unite()) };
}

// Sans point précis : un peu sous le haut de l'écran visible.
const positionVisible = () => positionDepuisEcran(window.innerWidth * 0.3, window.innerHeight * 0.3);

function ajouterBloc(bloc) {
  bloc.z = courant.version.blocs.reduce((max, b) => Math.max(max, b.z ?? 0), 0) + 1;
  bloc.x = arrondir(borner(bloc.x, 0, LARGEUR - bloc.w));
  bloc.y = arrondir(bloc.y);
  courant.version.blocs.push(bloc);
  const element = elementBloc(bloc);
  libre().append(element);
  selectionner(bloc.id);
  planifierEnregistrement();
  return element;
}

function ajouterTexte() {
  const { x, y } = positionVisible();
  const element = ajouterBloc({
    id: nouvelId(), type: 'texte', x, y, w: 400, mobileMasque: false,
    html: '<p>Votre texte…</p>', style: 'texte', align: 'gauche',
  });
  const zone = element.querySelector('[contenteditable]');
  zone.focus();
  document.execCommand('selectAll');
}

async function ajouterImages(fichiers, position = positionVisible()) {
  const images = [...fichiers].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  statut(`Envoi de ${images.length} image(s)…`);
  const formData = new FormData();
  images.forEach((f) => formData.append('photos', f));
  try {
    const { images: envoyees, refusees } = await api('/api/images', { method: 'POST', formData });
    const largeur = envoyees.length > 1 ? 300 : 450;
    let { x, y } = position;
    for (const image of envoyees) {
      ajouterBloc({ id: nouvelId(), type: 'image', x, y, w: largeur, image, legende: '', mobileMasque: false });
      x += largeur + 40;
      if (x + largeur > LARGEUR) {
        x = 0;
        y += largeur * 1.2;
      }
    }
    if (refusees.length) alert(`Images illisibles ignorées : ${refusees.join(', ')}`);
  } catch (err) {
    statut(`Erreur : ${err.message}`, 'erreur');
  }
}

async function creerOeuvres(fichiers, position = positionVisible()) {
  const images = [...fichiers].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  await enregistrer();
  statut(`Envoi de ${images.length} œuvre(s)…`);
  const formData = new FormData();
  formData.append('categorie', courant.cle);
  formData.append('x', position.x);
  formData.append('y', position.y);
  images.forEach((f) => formData.append('photos', f));
  try {
    const { ajoutees, galerie, refusees } = await api('/api/oeuvres', { method: 'POST', formData });
    db.oeuvres.push(...ajoutees);
    courant.element.brouillon = galerie.brouillon;
    courant.version = copie(galerie.brouillon);
    messageStatut = `${ajoutees.length} œuvre(s) ajoutée(s) en brouillon — « Modifier l’œuvre » pour leur donner un titre`;
    typeStatut = 'ok';
    if (refusees.length) alert(`Images illisibles ignorées : ${refusees.join(', ')}`);
    ctx.rendre();
  } catch (err) {
    statut(`Erreur : ${err.message}`, 'erreur');
  }
}

// ---------- Page d'œuvre ----------

function vueOeuvre() {
  const { element: oeuvre, version } = courant;
  const titre = el('input', { maxlength: 200, placeholder: 'Sans titre' });
  titre.value = version.titre;
  titre.addEventListener('input', () => {
    version.titre = titre.value;
    planifierEnregistrement();
  });
  const adresse = el('input', { maxlength: 80, placeholder: 'créée depuis le titre' });
  adresse.value = version.slug || (oeuvre.slug === oeuvre.id.slice(0, 8) ? '' : oeuvre.slug);
  adresse.addEventListener('input', () => {
    version.slug = adresse.value;
    planifierEnregistrement();
  });

  const slugs = trierBlocs(db.galeries[oeuvre.categorie].publie.blocs)
    .filter((b) => b.type === 'oeuvre')
    .map((b) => db.oeuvres.find((o) => o.id === b.oeuvreId)?.slug)
    .filter(Boolean);

  return el('article', { class: 'oeuvre' },
    boutonFermer(oeuvre.categorie),
    el('div', { class: 'infos-oeuvre' },
      el('label', {}, 'Titre (sous l’image, dans la galerie)', titre),
      el('label', {}, `Adresse : /${oeuvre.categorie}/…`, adresse),
      !oeuvre.publie && el('p', { text: 'Cette œuvre n’est pas encore en ligne : « Publier » la fera apparaître dans la galerie.' })),
    vueComposition(),
    navigationOeuvre(oeuvre.categorie, slugs, oeuvre.slug));
}

// ---------- Fichiers glissés depuis l'ordinateur ----------

function activerDepot() {
  const voile = el('div', { class: 'voile-depot', text: 'Déposez vos images' });
  document.body.append(voile);
  const avecFichiers = (e) => actif && !apercuMobile && courant && e.dataTransfer?.types.includes('Files');

  document.addEventListener('dragover', (e) => {
    if (!avecFichiers(e)) return;
    e.preventDefault();
    voile.classList.add('visible');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) voile.classList.remove('visible');
  });
  document.addEventListener('drop', (e) => {
    voile.classList.remove('visible');
    if (!avecFichiers(e)) return;
    e.preventDefault();
    // Les images arrivent à l'endroit où elles ont été lâchées.
    const position = positionDepuisEcran(e.clientX, e.clientY);
    if (courant.type === 'galerie') creerOeuvres(e.dataTransfer.files, position);
    else ajouterImages(e.dataTransfer.files, position);
  });
}

// ---------- Clavier ----------

function activerClavier() {
  document.addEventListener('keydown', (e) => {
    if (!actif || !selection) return;
    const cibleActive = document.activeElement;
    if (cibleActive?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cibleActive?.tagName)) {
      // Échap quitte l'écriture et garde le bloc sélectionné.
      if (e.key === 'Escape' && cibleActive.isContentEditable) cibleActive.closest('.bloc-edite')?.focus();
      return;
    }
    const bloc = blocsParId.get(selection);
    const element = libre()?.querySelector(`[data-id="${selection}"]`);
    if (!bloc || !element) return;

    const pas = e.shiftKey ? 10 : 1;
    const deplacements = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
    if (deplacements[e.key]) {
      e.preventDefault();
      const [dx, dy] = deplacements[e.key];
      bloc.x = arrondir(borner(bloc.x + dx, 0, LARGEUR - bloc.w));
      bloc.y = arrondir(Math.max(0, bloc.y + dy));
      placer(element, bloc);
      planifierEnregistrement();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (bloc.type !== 'oeuvre' || confirm('Retirer cette œuvre de la galerie ? Elle sera supprimée à la publication.')) {
        supprimerBloc(bloc, element);
      }
    } else if (e.key === 'Escape') {
      selectionner(null);
    }
  });
}

// ---------- Démarrage ----------

export async function demarrerEdition(contexte) {
  ctx = contexte;
  document.head.append(el('link', { rel: 'stylesheet', href: '/edition.css' }));
  db = await api('/api/edition');
  document.execCommand('defaultParagraphSeparator', false, 'p');

  barre = el('div', { class: 'barre-edition', role: 'toolbar', 'aria-label': 'Édition du site' });
  document.body.append(barre);
  document.body.classList.add('avec-barre-edition');
  barre.addEventListener('click', (e) => {
    const action = e.target.closest('button[data-action]')?.dataset.action;
    if (action) actionBarre(action);
  });
  barre.addEventListener('change', (e) => {
    const { action } = e.target.dataset;
    if (action === 'images') ajouterImages(e.target.files);
    if (action === 'oeuvres') creerOeuvres(e.target.files);
    e.target.value = '';
  });

  activerDepot();
  activerClavier();

  // Dans un texte en cours d'édition, cliquer sur un lien ne doit pas quitter la page.
  document.addEventListener('click', (e) => {
    if (actif && e.target.closest('[contenteditable] a')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Avant de quitter : on enregistre ce qui ne l'est pas encore.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') enregistrer({ keepalive: true });
  });
  window.addEventListener('beforeunload', (e) => {
    if (minuterie) {
      enregistrer({ keepalive: true });
      e.preventDefault();
    }
  });

  return { rendre, apresRendu, actif: () => actif };
}
