// Fonctions partagées entre le site public (site.js) et le mode édition (edition.js).

const PIXELS = { grand: 1800, moyen: 900 };
const cache = new Map();

export function el(balise, attributs = {}, ...enfants) {
  const element = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (cle === 'class') element.className = valeur;
    else if (cle === 'text') element.textContent = valeur;
    else element.setAttribute(cle, valeur);
  }
  element.append(...enfants.filter((e) => e || e === 0));
  return element;
}

// ---------- Images protégées ----------

// Les images sont récupérées en mémoire puis peintes dans un <canvas> :
// aucune balise <img> ni URL d'image n'est exposée au visiteur.
function chargerImage(id, taille) {
  const cle = `${id}/${taille}`;
  if (!cache.has(cle)) {
    const promesse = fetch(`/media/${id}/${taille}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .catch((err) => {
        cache.delete(cle);
        throw err;
      });
    cache.set(cle, promesse);
  }
  return cache.get(cle);
}

const observateur = new IntersectionObserver((entrees) => {
  for (const entree of entrees) {
    if (!entree.isIntersecting) continue;
    observateur.unobserve(entree.target);
    const canvas = entree.target;
    chargerImage(canvas.dataset.id, canvas.dataset.taille)
      .then((image) => {
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.classList.add('visible');
      })
      .catch(() => canvas.classList.add('erreur'));
  }
}, { rootMargin: '400px' });

// Le canvas a dès le départ les proportions de l'image : la page ne « saute » pas au chargement.
export function toile(image, taille, description) {
  const echelle = Math.min(1, PIXELS[taille] / Math.max(image.largeur, image.hauteur));
  const canvas = el('canvas', { role: 'img', 'aria-label': description || 'Œuvre', class: 'toile' });
  canvas.width = Math.round(image.largeur * echelle);
  canvas.height = Math.round(image.hauteur * echelle);
  canvas.dataset.id = image.id;
  canvas.dataset.taille = taille;
  observateur.observe(canvas);
  return canvas;
}

export function figure(image, taille, legende) {
  return el(
    'figure',
    { class: 'figure' },
    toile(image, taille, legende),
    legende && el('figcaption', { class: 'legende', text: legende }),
  );
}

// ---------- Composition libre ----------
//
// Chaque bloc est placé en millièmes de la largeur de la page (--x, --y, --w).
// Toute la composition s'agrandit ou rétrécit avec l'écran ; sur téléphone, les blocs s'empilent (voir style.css).

export const trierBlocs = (blocs) => [...blocs].sort((a, b) => a.y - b.y || a.x - b.x);

export function classesBloc(bloc) {
  const classes = ['bloc', `bloc-${bloc.type}`];
  if (bloc.type === 'texte') classes.push(`style-${bloc.style}`, `align-${bloc.align}`);
  if (bloc.mobileMasque) classes.push('masque-mobile');
  return classes.join(' ');
}

export function placer(element, bloc) {
  element.style.setProperty('--x', bloc.x);
  element.style.setProperty('--y', bloc.y);
  element.style.setProperty('--w', bloc.w);
  element.style.setProperty('--z', bloc.z ?? 0);
}

// Le texte vient du serveur, qui ne garde que p, br, strong, em et a.
export function texteRiche(html) {
  const div = el('div', { class: 'texte-riche' });
  div.innerHTML = html;
  return div;
}

// Une tuile de galerie : l'image de l'œuvre et son titre, qui mènent à sa page.
export function tuileOeuvre(oeuvre, lien = true) {
  const contenu = figure(oeuvre.couverture, 'moyen', oeuvre.titre);
  return lien ? el('a', { href: `/${oeuvre.categorie}/${oeuvre.slug}`, class: 'carte' }, contenu) : contenu;
}

export function contenuBloc(bloc) {
  if (bloc.type === 'image') return figure(bloc.image, bloc.w >= 450 ? 'grand' : 'moyen', bloc.legende);
  if (bloc.type === 'oeuvre') return tuileOeuvre(bloc.oeuvre);
  return texteRiche(bloc.html);
}

export function compositionLibre(blocs) {
  const libre = el('div', { class: 'libre' });
  for (const bloc of trierBlocs(blocs)) {
    const element = el('div', { class: classesBloc(bloc) }, contenuBloc(bloc));
    placer(element, bloc);
    libre.append(element);
  }
  return el('div', { class: 'zone-libre' }, libre);
}
