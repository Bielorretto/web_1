const $ = (id) => document.getElementById(id);

const toile = $('toile');
const scene = $('scene');
const bandeau = $('vignettes');
const cache = new Map();

let oeuvres = [];
let courante = 0;

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

function peindre(canvas, image, largeur, hauteur) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${largeur}px`;
  canvas.style.height = `${hauteur}px`;
  canvas.width = Math.round(largeur * dpr);
  canvas.height = Math.round(hauteur * dpr);
  if (!image) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function dimensionsAffichage(oeuvre) {
  const largeurMax = toile.parentElement.clientWidth;
  const hauteurMax = Math.min(window.innerHeight * 0.72, 1100);
  const ratio = Math.min(largeurMax / oeuvre.largeur, hauteurMax / oeuvre.hauteur);
  return [Math.floor(oeuvre.largeur * ratio), Math.floor(oeuvre.hauteur * ratio)];
}

async function afficher(index) {
  courante = (index + oeuvres.length) % oeuvres.length;
  const oeuvre = oeuvres[courante];

  $('compteur').textContent = `${courante + 1} / ${oeuvres.length}`;
  $('titre').textContent = oeuvre.titre || 'Sans titre';
  $('texte').textContent = oeuvre.texte;
  toile.setAttribute('aria-label', oeuvre.titre || 'Œuvre sans titre');
  history.replaceState(null, '', `#${courante + 1}`);

  for (const [i, bouton] of [...bandeau.children].entries()) {
    const active = i === courante;
    bouton.classList.toggle('active', active);
    bouton.toggleAttribute('aria-current', active);
    if (active) bouton.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  const [largeur, hauteur] = dimensionsAffichage(oeuvre);
  toile.classList.remove('visible');
  peindre(toile, null, largeur, hauteur);

  try {
    const image = await chargerImage(oeuvre.id, 'grand');
    if (oeuvres[courante] !== oeuvre) return;
    peindre(toile, image, largeur, hauteur);
    requestAnimationFrame(() => toile.classList.add('visible'));
  } catch {
    if (oeuvres[courante] === oeuvre) $('texte').textContent = "Impossible de charger l'image.";
  }

  // Précharge les voisines pour un défilement fluide.
  for (const decalage of [1, -1]) {
    const voisine = oeuvres[(courante + decalage + oeuvres.length) % oeuvres.length];
    chargerImage(voisine.id, 'grand').catch(() => {});
  }
}

function construireVignettes() {
  const observateur = new IntersectionObserver((entrees) => {
    for (const entree of entrees) {
      if (!entree.isIntersecting) continue;
      observateur.unobserve(entree.target);
      const canvas = entree.target.querySelector('canvas');
      const oeuvre = oeuvres[Number(entree.target.dataset.index)];
      chargerImage(oeuvre.id, 'miniature')
        .then((image) => {
          const cote = 72;
          const ratio = cote / Math.min(image.width, image.height);
          const dpr = window.devicePixelRatio || 1;
          canvas.width = canvas.height = cote * dpr;
          const ctx = canvas.getContext('2d');
          const l = image.width * ratio * dpr;
          const h = image.height * ratio * dpr;
          ctx.drawImage(image, (canvas.width - l) / 2, (canvas.height - h) / 2, l, h);
          canvas.classList.add('visible');
        })
        .catch(() => {});
    }
  }, { root: bandeau, rootMargin: '200px' });

  oeuvres.forEach((oeuvre, i) => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'vignette';
    bouton.dataset.index = i;
    bouton.setAttribute('aria-label', `${i + 1}. ${oeuvre.titre || 'Sans titre'}`);
    bouton.append(document.createElement('canvas'));
    bouton.addEventListener('click', () => afficher(i));
    bandeau.append(bouton);
    observateur.observe(bouton);
  });
}

function activerNavigation() {
  $('precedente').addEventListener('click', () => afficher(courante - 1));
  $('suivante').addEventListener('click', () => afficher(courante + 1));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') afficher(courante - 1);
    if (e.key === 'ArrowRight') afficher(courante + 1);
  });

  // Balayage au doigt sur mobile.
  let depart = null;
  scene.addEventListener('pointerdown', (e) => { depart = e.clientX; });
  scene.addEventListener('pointerup', (e) => {
    if (depart === null) return;
    const ecart = e.clientX - depart;
    depart = null;
    if (Math.abs(ecart) > 50) afficher(courante + (ecart < 0 ? 1 : -1));
  });

  let attente;
  window.addEventListener('resize', () => {
    clearTimeout(attente);
    attente = setTimeout(async () => {
      const oeuvre = oeuvres[courante];
      const image = await chargerImage(oeuvre.id, 'grand').catch(() => null);
      if (image && oeuvres[courante] === oeuvre) peindre(toile, image, ...dimensionsAffichage(oeuvre));
    }, 120);
  });
}

function activerProtection() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.scene, .vignettes')) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
  });
}

async function demarrer() {
  activerProtection();
  $('annee').textContent = new Date().getFullYear();

  const reponse = await fetch('/api/galerie');
  const { artiste, oeuvres: liste } = await reponse.json();

  document.title = artiste.nom;
  $('nom-artiste').textContent = artiste.nom;
  $('nom-pied').textContent = artiste.nom;
  $('presentation').textContent = artiste.presentation;

  oeuvres = liste;
  if (!oeuvres.length) {
    $('vide').hidden = false;
    return;
  }

  $('galerie').hidden = false;
  construireVignettes();
  activerNavigation();
  const depuisLien = Number(location.hash.slice(1)) - 1;
  afficher(depuisLien >= 0 && depuisLien < oeuvres.length ? depuisLien : 0);
}

demarrer();
