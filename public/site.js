import { el, compositionLibre } from '/commun.js';

const $ = (id) => document.getElementById(id);
const contenu = $('contenu');
const RUBRIQUES = { gravures: 'gravures', dessins: 'dessins', demarche: 'ma démarche', 'a-propos': 'à propos', contact: 'contact' };
const PAGES = { '': 'accueil', demarche: 'demarche', 'a-propos': 'apropos', contact: 'contact' };

let site;
let edition = null; // mode édition, chargé uniquement quand l'artiste est connectée

// ---------- Pages publiques ----------

function pageGalerie(categorie) {
  const { blocs } = site.galeries[categorie];
  if (!blocs.length) return el('p', { class: 'vide', text: 'Bientôt.' });
  return compositionLibre(blocs);
}

export function navigationOeuvre(categorie, slugs, slug) {
  const index = slugs.indexOf(slug);
  const precedente = slugs[index - 1];
  const suivante = slugs[index + 1];
  return el(
    'nav',
    { class: 'suite', 'aria-label': 'Autres œuvres' },
    precedente ? el('a', { href: `/${categorie}/${precedente}`, text: '← précédente' }) : el('span'),
    el('a', { href: `/${categorie}`, text: categorie }),
    suivante ? el('a', { href: `/${categorie}/${suivante}`, text: 'suivante →' }) : el('span'),
  );
}

export const boutonFermer = (categorie) =>
  el('a', { href: `/${categorie}`, class: 'fermer', 'aria-label': `Retour aux ${categorie}`, text: '×' });

function pageOeuvre(oeuvre) {
  const slugs = site.oeuvres.filter((o) => o.categorie === oeuvre.categorie).map((o) => o.slug);
  return el(
    'article',
    { class: 'oeuvre' },
    boutonFermer(oeuvre.categorie),
    compositionLibre(oeuvre.blocs),
    navigationOeuvre(oeuvre.categorie, slugs, oeuvre.slug),
  );
}

function pagePublique(route) {
  if (route.type === 'page') {
    const page = compositionLibre(site.pages[route.nom].blocs);
    // Les coordonnées de contact viennent des réglages, pas de la composition.
    if (route.nom === 'contact') page.append(liensContact());
    return page;
  }
  if (route.type === 'galerie') return pageGalerie(route.categorie);
  if (route.type === 'oeuvre') {
    const oeuvre = site.oeuvres.find((o) => o.categorie === route.categorie && o.slug === route.slug);
    if (oeuvre) return pageOeuvre(oeuvre);
  }
  return el('p', { class: 'vide' }, 'Page introuvable. ', el('a', { href: '/', text: "Retour à l'accueil" }));
}

function liensContact() {
  const { email, instagram } = site.site;
  return el(
    'div',
    { class: 'contact-liens' },
    email && el('a', { href: `mailto:${email}`, text: email }),
    instagram && el('a', { href: `https://www.instagram.com/${instagram}/`, target: '_blank', rel: 'noopener', text: `@${instagram}` }),
  );
}

// ---------- Navigation ----------

function routeActuelle() {
  const [rubrique = '', slug, ...reste] = decodeURIComponent(location.pathname).split('/').filter(Boolean);
  if (reste.length) return { type: 'introuvable', rubrique };
  if (rubrique in PAGES && !slug) return { type: 'page', nom: PAGES[rubrique], rubrique };
  if (rubrique === 'gravures' || rubrique === 'dessins') {
    return slug ? { type: 'oeuvre', categorie: rubrique, slug, rubrique } : { type: 'galerie', categorie: rubrique, rubrique };
  }
  return { type: 'introuvable', rubrique };
}

function rendre() {
  const route = routeActuelle();
  const page = edition?.rendre(route) ?? pagePublique(route);

  contenu.className = `contenu page-${route.type === 'page' ? route.nom : route.type}`;
  contenu.replaceChildren(page);

  let titre = RUBRIQUES[route.rubrique];
  if (route.type === 'oeuvre') {
    const oeuvre = site.oeuvres.find((o) => o.categorie === route.categorie && o.slug === route.slug);
    titre = oeuvre ? oeuvre.titre || 'Sans titre' : 'brouillon';
  }
  document.title = titre ? `${titre} — ${site.site.titre}` : site.site.titre;

  for (const lien of document.querySelectorAll('.menu a')) {
    lien.toggleAttribute('aria-current', lien.getAttribute('href') === `/${route.rubrique}`);
  }
  edition?.apresRendu(route);
}

function naviguer(url) {
  history.replaceState({ y: window.scrollY }, '');
  history.pushState({ y: 0 }, '', url);
  rendre();
  window.scrollTo(0, 0);
  contenu.focus({ preventScroll: true });
}

function activerNavigation() {
  history.scrollRestoration = 'manual';

  document.addEventListener('click', (e) => {
    const lien = e.target.closest('a[href^="/"]');
    if (!lien || lien.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    if (lien.getAttribute('href').startsWith('/admin')) return;
    e.preventDefault();
    if (lien.getAttribute('href') !== location.pathname) naviguer(lien.getAttribute('href'));
  });

  // Retour arrière : on retrouve la position dans la page (les canvas réservent déjà leur place).
  window.addEventListener('popstate', (e) => {
    rendre();
    window.scrollTo(0, e.state?.y ?? 0);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || edition?.actif()) return;
    const fermer = contenu.querySelector('.fermer');
    if (fermer) naviguer(fermer.getAttribute('href'));
  });
}

function activerProtection() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('canvas')) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => {
    if (e.target.closest?.('canvas, .carte')) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['s', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
  });
}

async function chargerSite() {
  site = await (await fetch('/api/site')).json();
  $('titre-site').textContent = site.site.titre;
  $('nom-artiste').textContent = site.site.nom;
  $('nom-pied').textContent = site.site.nom;
  const insta = $('instagram');
  insta.hidden = !site.site.instagram;
  insta.href = `https://www.instagram.com/${site.site.instagram}/`;
  insta.textContent = site.site.instagram;
}

async function demarrer() {
  activerProtection();
  activerNavigation();
  $('annee').textContent = new Date().getFullYear();

  const [, session] = await Promise.all([chargerSite(), fetch('/api/session').then((r) => r.json())]);
  if (session.connecte) {
    const module = await import('/edition.js');
    edition = await module.demarrerEdition({
      rendre,
      naviguer,
      contenu,
      // Après une publication, le site public est rechargé pour refléter la nouvelle version.
      rechargerPublic: chargerSite,
    });
  }

  history.replaceState({ y: 0 }, '');
  rendre();
}

demarrer();
