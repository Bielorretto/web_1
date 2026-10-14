import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import sanitizeHtml from 'sanitize-html';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_DIR = path.join(ROOT, 'storage');
const DB_FILE = path.join(DATA_DIR, 'site.json');
const CONTENU_INITIAL = path.join(ROOT, 'contenu-initial.json');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 8 * 60 * 60 * 1000;
// Seules des versions réduites sont servies : l'original n'est jamais conservé ni exposé.
const TAILLES = {
  grand: { px: 1800, qualite: 82 },
  moyen: { px: 900, qualite: 80 },
  miniature: { px: 360, qualite: 72 },
};
const CATEGORIES = ['gravures', 'dessins'];
const PAGES = ['accueil', 'demarche', 'apropos', 'contact'];
// Une image envoyée mais jamais placée dans une page est supprimée après ce délai.
const DELAI_ORPHELINE_MS = 60 * 60 * 1000;

// Un mot de passe vide laisserait n'importe qui se connecter : il doit au moins exister.
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD doit être défini dans le fichier .env.');
  process.exit(1);
}

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(STORAGE_DIR, { recursive: true });

// ---------- Données ----------
//
// Chaque page, œuvre et galerie a une version « publie » (vue par les visiteurs)
// et une version « brouillon » (null tant que l'artiste n'a rien modifié).

// Positions des blocs : en millièmes de la largeur de la page (x, y, w de 0 à 1000 pour la largeur).
// La composition garde ainsi les mêmes proportions sur tous les écrans d'ordinateur.
const LARGEUR = 1000;

let db = await chargerDb();

async function chargerDb() {
  let donnees;
  try {
    donnees = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    donnees = JSON.parse(await fs.readFile(CONTENU_INITIAL, 'utf8'));
  }
  return donnees.version === 2 ? donnees : migrerDepuisGrille(donnees);
}

// Version 1 : blocs sur une grille de 12 colonnes et galeries en simple liste.
// Version 2 : placement libre partout, galeries comprises.
function migrerDepuisGrille(ancien) {
  const convertirBlocs = (blocs) =>
    blocs.map(({ h, ...bloc }, z) => ({
      ...bloc,
      x: (bloc.x * LARGEUR) / 12,
      y: (bloc.y * LARGEUR) / 48,
      w: (bloc.w * LARGEUR) / 12,
      z,
    }));
  const convertirVersion = (version) => version && { ...version, blocs: convertirBlocs(version.blocs) };
  for (const page of Object.values(ancien.pages)) {
    page.publie = convertirVersion(page.publie);
    page.brouillon = convertirVersion(page.brouillon);
  }
  for (const oeuvre of ancien.oeuvres) {
    oeuvre.publie = convertirVersion(oeuvre.publie);
    oeuvre.brouillon = convertirVersion(oeuvre.brouillon);
  }
  const parId = new Map(ancien.oeuvres.map((o) => [o.id, o]));
  for (const galerie of Object.values(ancien.galeries)) {
    galerie.publie = { blocs: tuilesEnColonnes(galerie.publie, parId) };
    galerie.brouillon = galerie.brouillon && { blocs: tuilesEnColonnes(galerie.brouillon, parId) };
  }
  ancien.version = 2;
  return ancien;
}

// Dispose des œuvres sur trois colonnes, comme l'ancienne mosaïque.
function tuilesEnColonnes(ids, parId, depart = 0) {
  const hauteurs = [depart, depart, depart];
  return ids.flatMap((id, z) => {
    const oeuvre = parId.get(id);
    const couverture = (oeuvre?.brouillon ?? oeuvre?.publie)?.couverture;
    if (!couverture) return [];
    const colonne = hauteurs.indexOf(Math.min(...hauteurs));
    const bloc = { id: crypto.randomUUID(), type: 'oeuvre', oeuvreId: id, x: colonne * 360, y: hauteurs[colonne], w: 280, z, mobileMasque: false };
    hauteurs[colonne] += (280 * couverture.hauteur) / couverture.largeur + 90;
    return [bloc];
  });
}

let fileEcriture = Promise.resolve();
function sauverDb() {
  const contenu = JSON.stringify(db, null, 2);
  fileEcriture = fileEcriture.catch(() => {}).then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, contenu);
    await fs.rename(tmp, DB_FILE);
  });
  return fileEcriture;
}

const texte = (valeur, max) => (typeof valeur === 'string' ? valeur.trim().slice(0, max) : undefined);
const entier = (valeur, min, max) => Math.min(max, Math.max(min, Math.round(Number(valeur) || 0)));
const versionCourante = (element) => element.brouillon ?? element.publie;

function slugifier(valeur) {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function slugUnique(base, oeuvre) {
  let slug = base || oeuvre.id.slice(0, 8);
  for (let n = 2; db.oeuvres.some((o) => o !== oeuvre && o.slug === slug); n++) slug = `${base}-${n}`;
  return slug;
}

// ---------- Images ----------

const fichierImage = (id, taille) => path.join(STORAGE_DIR, `${id}-${taille}.webp`);
const imagesStockees = new Set();
for (const nom of await fs.readdir(STORAGE_DIR)) {
  const id = nom.match(/^([0-9a-f-]{36})-grand\.webp$/)?.[1];
  if (id) imagesStockees.add(id);
}

async function enregistrerImage(buffer) {
  const id = crypto.randomUUID();
  try {
    // rotate() applique l'orientation EXIF ; sharp supprime les métadonnées (GPS, appareil…).
    const source = sharp(buffer, { failOn: 'error' }).rotate();
    let infos;
    for (const [taille, { px, qualite }] of Object.entries(TAILLES)) {
      const resultat = await source
        .clone()
        .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: qualite })
        .toFile(fichierImage(id, taille));
      if (taille === 'grand') infos = resultat;
    }
    imagesStockees.add(id);
    return { id, largeur: infos.width, hauteur: infos.height };
  } catch {
    await supprimerFichiers(id);
    return null;
  }
}

function supprimerFichiers(id) {
  imagesStockees.delete(id);
  return Promise.all(Object.keys(TAILLES).map((t) => fs.rm(fichierImage(id, t), { force: true })));
}

function imagesUtilisees() {
  const ids = new Set();
  const parcourir = (version) => {
    if (!version) return;
    if (version.couverture) ids.add(version.couverture.id);
    for (const bloc of version.blocs ?? []) if (bloc.image) ids.add(bloc.image.id);
  };
  for (const page of Object.values(db.pages)) [page.publie, page.brouillon].forEach(parcourir);
  for (const o of db.oeuvres) [o.publie, o.brouillon].forEach(parcourir);
  return ids;
}

const oeuvresDe = (version) => (version?.blocs ?? []).filter((b) => b.type === 'oeuvre').map((b) => b.oeuvreId);
const ordreDeLecture = (blocs) => [...blocs].sort((a, b) => a.y - b.y || a.x - b.x);

// Supprime les œuvres retirées de toutes les galeries et les images plus utilisées nulle part.
async function faireLeMenage() {
  const dansUneGalerie = new Set(
    Object.values(db.galeries).flatMap((g) => [...oeuvresDe(g.publie), ...oeuvresDe(g.brouillon)]),
  );
  db.oeuvres = db.oeuvres.filter((o) => dansUneGalerie.has(o.id));
  await sauverDb();

  const utilisees = imagesUtilisees();
  for (const id of [...imagesStockees]) {
    if (utilisees.has(id)) continue;
    const infos = await fs.stat(fichierImage(id, 'grand')).catch(() => null);
    if (!infos || Date.now() - infos.mtimeMs > DELAI_ORPHELINE_MS) await supprimerFichiers(id);
  }
}

// ---------- Validation des blocs ----------

const STYLES = ['texte', 'titre', 'legende'];
const ALIGNEMENTS = ['gauche', 'centre', 'droite'];
const nombre = (valeur, min, max) => Math.min(max, Math.max(min, Math.round((Number(valeur) || 0) * 10) / 10));

const nettoyerHtml = (html) =>
  sanitizeHtml(String(html ?? '').slice(0, 50000), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'a'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      div: 'p',
      a: (balise, attributs) => ({
        tagName: 'a',
        attribs: /^https?:/.test(attributs.href ?? '')
          ? { href: attributs.href, target: '_blank', rel: 'noopener' }
          : { href: attributs.href ?? '' },
      }),
    },
  });

function nettoyerImage(image) {
  if (!image || !imagesStockees.has(image.id)) return null;
  return { id: image.id, largeur: entier(image.largeur, 1, 20000), hauteur: entier(image.hauteur, 1, 20000) };
}

// categorie : pour une galerie, seules ses propres œuvres peuvent y être placées.
function nettoyerBlocs(blocs, categorie = null) {
  if (!Array.isArray(blocs)) return [];
  const propres = [];
  const dejaPlacees = new Set();
  for (const bloc of blocs.slice(0, 500)) {
    const w = nombre(bloc?.w, 20, LARGEUR);
    const base = {
      id: /^[\w-]{1,40}$/.test(bloc?.id) ? bloc.id : crypto.randomUUID(),
      x: nombre(bloc?.x, 0, LARGEUR - w),
      y: nombre(bloc?.y, 0, 200000),
      w,
      z: entier(bloc?.z, 0, 10000),
      mobileMasque: bloc?.mobileMasque === true,
    };
    if (bloc?.type === 'image' && !categorie) {
      const image = nettoyerImage(bloc.image);
      if (image) propres.push({ ...base, type: 'image', image, legende: texte(bloc.legende, 500) ?? '' });
    } else if (bloc?.type === 'texte') {
      propres.push({
        ...base,
        type: 'texte',
        html: nettoyerHtml(bloc.html),
        style: STYLES.includes(bloc.style) ? bloc.style : 'texte',
        align: ALIGNEMENTS.includes(bloc.align) ? bloc.align : 'gauche',
      });
    } else if (bloc?.type === 'oeuvre' && categorie) {
      const oeuvre = db.oeuvres.find((o) => o.id === bloc.oeuvreId && o.categorie === categorie);
      if (oeuvre && !dejaPlacees.has(oeuvre.id)) {
        dejaPlacees.add(oeuvre.id);
        propres.push({ ...base, type: 'oeuvre', oeuvreId: oeuvre.id });
      }
    }
  }
  return propres;
}

// ---------- Vue publique ----------

function vuePublique() {
  const parId = new Map(db.oeuvres.map((o) => [o.id, o]));
  const oeuvres = [];
  const galeries = {};
  for (const categorie of CATEGORIES) {
    // Chaque tuile de galerie embarque ce qu'il faut pour l'afficher (image, titre, lien).
    const blocs = db.galeries[categorie].publie.blocs.flatMap((bloc) => {
      if (bloc.type !== 'oeuvre') return [bloc];
      const o = parId.get(bloc.oeuvreId);
      if (!o?.publie) return [];
      return [{ ...bloc, oeuvre: { categorie, slug: o.slug, titre: o.publie.titre, couverture: o.publie.couverture } }];
    });
    galeries[categorie] = { blocs };
    // « précédente / suivante » suivent l'ordre de lecture de la galerie.
    for (const bloc of ordreDeLecture(blocs)) {
      if (bloc.type !== 'oeuvre') continue;
      const o = parId.get(bloc.oeuvreId);
      oeuvres.push({ categorie, slug: o.slug, titre: o.publie.titre, blocs: o.publie.blocs });
    }
  }
  const pages = Object.fromEntries(PAGES.map((nom) => [nom, { blocs: db.pages[nom].publie.blocs }]));
  return { site: db.site, pages, galeries, oeuvres };
}

// ---------- Authentification ----------

const signer = (valeur) => crypto.createHmac('sha256', SECRET).update(valeur).digest('hex');
const egalSur = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

function lireCookie(req, nom) {
  for (const partie of (req.headers.cookie || '').split(';')) {
    const [cle, ...valeur] = partie.trim().split('=');
    if (cle === nom) return decodeURIComponent(valeur.join('='));
  }
  return null;
}

function estAdmin(req) {
  const jeton = lireCookie(req, 'session');
  if (!jeton) return false;
  const [expiration, signature] = jeton.split('.');
  return Number(expiration) > Date.now() && !!signature && egalSur(signature, signer(expiration));
}

function exigerAdmin(req, res, next) {
  if (estAdmin(req)) return next();
  res.status(401).json({ erreur: 'Session expirée, reconnectez-vous.' });
}

// Limite les essais de mot de passe : 5 échecs → blocage 15 minutes par adresse IP.
const echecs = new Map();
function estBloque(ip) {
  const e = echecs.get(ip);
  return e && e.bloqueJusqua > Date.now();
}
function noterEchec(ip) {
  const e = echecs.get(ip) ?? { nombre: 0, bloqueJusqua: 0 };
  e.nombre += 1;
  if (e.nombre >= 5) {
    e.nombre = 0;
    e.bloqueJusqua = Date.now() + 15 * 60 * 1000;
  }
  echecs.set(ip, e);
}

// ---------- Application ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

// Images : jamais en accès direct (URL tapée dans le navigateur, lien depuis un autre site).
app.get('/media/:id/:taille', (req, res) => {
  const { id, taille } = req.params;
  if (!TAILLES[taille] || !imagesStockees.has(id)) return res.sendStatus(404);

  const destination = req.get('sec-fetch-dest');
  const site = req.get('sec-fetch-site');
  if (destination === 'document' || (site && site !== 'same-origin')) return res.sendStatus(403);

  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'X-Robots-Tag': 'noindex, noimageindex',
  });
  res.sendFile(fichierImage(id, taille));
});

app.get('/api/site', (req, res) => res.json(vuePublique()));
app.get('/api/edition', exigerAdmin, (req, res) => res.json(db));

app.get('/api/session', (req, res) => {
  res.json({ connecte: estAdmin(req) });
});

app.post('/api/connexion', (req, res) => {
  const ip = req.ip;
  if (estBloque(ip)) return res.status(429).json({ erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });

  if (typeof req.body?.motdepasse !== 'string' || !egalSur(req.body.motdepasse, ADMIN_PASSWORD)) {
    noterEchec(ip);
    return res.status(401).json({ erreur: 'Mot de passe incorrect.' });
  }
  echecs.delete(ip);
  const expiration = String(Date.now() + SESSION_MS);
  res.cookie('session', `${expiration}.${signer(expiration)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_MS,
  });
  res.json({ connecte: true });
});

app.post('/api/deconnexion', (req, res) => {
  res.clearCookie('session');
  res.json({ connecte: false });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

async function enregistrerEnvoi(fichiers) {
  const images = [];
  const refusees = [];
  for (const fichier of fichiers ?? []) {
    const image = await enregistrerImage(fichier.buffer);
    image ? images.push(image) : refusees.push(fichier.originalname);
  }
  return { images, refusees };
}

// --- Réglages (appliqués immédiatement) ---

app.put('/api/site', exigerAdmin, async (req, res) => {
  const champs = { titre: 120, nom: 120, instagram: 60, email: 200 };
  for (const [champ, max] of Object.entries(champs)) {
    const valeur = texte(req.body?.[champ], max);
    if (valeur !== undefined) db.site[champ] = valeur;
  }
  db.site.instagram = db.site.instagram.replace(/^@/, '');
  await sauverDb();
  res.json(db.site);
});

// --- Images glissées dans une page ---

app.post('/api/images', exigerAdmin, upload.array('photos'), async (req, res) => {
  res.status(201).json(await enregistrerEnvoi(req.files));
});

// --- Œuvres : chaque photo glissée sur une galerie devient une œuvre en brouillon ---

app.post('/api/oeuvres', exigerAdmin, upload.array('photos'), async (req, res) => {
  const categorie = CATEGORIES.includes(req.body?.categorie) ? req.body.categorie : CATEGORIES[0];
  const { images, refusees } = await enregistrerEnvoi(req.files);
  const galerie = db.galeries[categorie];
  galerie.brouillon ??= structuredClone(galerie.publie);
  const blocs = galerie.brouillon.blocs;

  // Les nouvelles œuvres arrivent là où les photos ont été lâchées, côte à côte.
  const largeur = 280;
  const basDePage = blocs.reduce((max, b) => Math.max(max, b.y), -400) + 400;
  let x = nombre(req.body?.x ?? 0, 0, LARGEUR - largeur);
  let y = nombre(req.body?.y ?? basDePage, 0, 200000);
  let z = blocs.reduce((max, b) => Math.max(max, b.z), 0);

  const ajoutees = images.map((image) => {
    const oeuvre = { id: crypto.randomUUID(), categorie, slug: '', publie: null };
    oeuvre.slug = slugUnique('', oeuvre);
    oeuvre.brouillon = {
      titre: '',
      couverture: image,
      blocs: [{ id: crypto.randomUUID(), type: 'image', x: 200, y: 0, w: 600, z: 0, mobileMasque: false, image, legende: '' }],
    };
    blocs.push({ id: crypto.randomUUID(), type: 'oeuvre', oeuvreId: oeuvre.id, x, y, w: largeur, z: ++z, mobileMasque: false });
    x += largeur + 60;
    if (x > LARGEUR - largeur) {
      x = 0;
      y += 500;
    }
    return oeuvre;
  });
  db.oeuvres.push(...ajoutees);
  await sauverDb();
  res.status(201).json({ ajoutees, galerie, refusees });
});

// --- Brouillons et publication ---

function cible(type, cle) {
  if (type === 'page' && PAGES.includes(cle)) return db.pages[cle];
  if (type === 'galerie' && CATEGORIES.includes(cle)) return db.galeries[cle];
  if (type === 'oeuvre') return db.oeuvres.find((o) => o.id === cle);
  return null;
}

function nettoyerBrouillon(type, element, cle, corps) {
  if (type === 'page') return { blocs: nettoyerBlocs(corps?.blocs) };
  if (type === 'galerie') return { blocs: nettoyerBlocs(corps?.blocs, cle) };
  return {
    titre: texte(corps?.titre, 200) ?? '',
    slug: texte(corps?.slug, 80) ?? '',
    couverture: nettoyerImage(corps?.couverture) ?? versionCourante(element).couverture,
    blocs: nettoyerBlocs(corps?.blocs),
  };
}

app.put('/api/brouillon/:type/:cle', exigerAdmin, async (req, res) => {
  const { type, cle } = req.params;
  const element = cible(type, cle);
  if (!element) return res.status(404).json({ erreur: 'Page introuvable.' });
  element.brouillon = nettoyerBrouillon(type, element, cle, req.body);
  await sauverDb();
  res.json(element);
});

app.delete('/api/brouillon/:type/:cle', exigerAdmin, async (req, res) => {
  const { type, cle } = req.params;
  const element = cible(type, cle);
  if (!element) return res.status(404).json({ erreur: 'Page introuvable.' });
  if (type === 'oeuvre' && !element.publie) {
    return res.status(400).json({ erreur: "Cette œuvre n'a jamais été publiée : retirez-la plutôt de la galerie." });
  }
  element.brouillon = null;
  await faireLeMenage();
  res.json(element);
});

function publierOeuvre(oeuvre) {
  if (!oeuvre.brouillon) return;
  const { titre, slug, couverture, blocs } = oeuvre.brouillon;
  // L'adresse ne change plus une fois choisie, sauf si l'artiste la modifie elle-même.
  if (slug && slug !== oeuvre.slug) oeuvre.slug = slugUnique(slugifier(slug), oeuvre);
  else if (oeuvre.slug === oeuvre.id.slice(0, 8) && titre) oeuvre.slug = slugUnique(slugifier(titre), oeuvre);
  oeuvre.publie = { titre, couverture, blocs };
  oeuvre.brouillon = null;
}

app.post('/api/publier/:type/:cle', exigerAdmin, async (req, res) => {
  const { type, cle } = req.params;
  const element = cible(type, cle);
  if (!element) return res.status(404).json({ erreur: 'Page introuvable.' });

  if (type === 'oeuvre') {
    publierOeuvre(element);
    // Publier une œuvre la fait apparaître dans sa galerie, à l'endroit prévu dans le brouillon de la galerie.
    const galerie = db.galeries[element.categorie];
    if (!oeuvresDe(galerie.publie).includes(element.id)) {
      const tuile = galerie.brouillon?.blocs.find((b) => b.oeuvreId === element.id);
      const bas = galerie.publie.blocs.reduce((max, b) => Math.max(max, b.y), -500) + 500;
      galerie.publie.blocs.push(tuile ? structuredClone(tuile) : {
        id: crypto.randomUUID(), type: 'oeuvre', oeuvreId: element.id, x: 0, y: bas, w: 280, z: 0, mobileMasque: false,
      });
    }
  } else if (type === 'galerie') {
    if (element.brouillon) element.publie = element.brouillon;
    element.brouillon = null;
    for (const id of oeuvresDe(element.publie)) {
      const oeuvre = db.oeuvres.find((o) => o.id === id);
      if (oeuvre && !oeuvre.publie) publierOeuvre(oeuvre);
    }
  } else if (element.brouillon) {
    element.publie = element.brouillon;
    element.brouillon = null;
  }
  await faireLeMenage();
  res.json(db);
});

// ---------- Pages ----------

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use(express.static(PUBLIC_DIR, { index: false }));

// Anciennes adresses du site Cargo → nouvelles adresses.
const ANCIENNES_ADRESSES = {
  '/page-accueil': '/',
  '/menu-gravures': '/gravures',
  '/menu-dessins': '/dessins',
  '/ma-démarche': '/demarche',
  '/presentation': '/a-propos',
};

const TITRES = { gravures: 'gravures', dessins: 'dessins', demarche: 'ma démarche', 'a-propos': 'à propos', contact: 'contact' };
const modelePage = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const echapper = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

app.get('*chemin', (req, res, next) => {
  let chemin;
  try {
    chemin = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  } catch {
    return next();
  }
  if (ANCIENNES_ADRESSES[chemin]) return res.redirect(301, ANCIENNES_ADRESSES[chemin]);

  const [rubrique, slug, ...reste] = chemin.split('/').filter(Boolean);
  const oeuvre = db.oeuvres.find((o) => o.slug === (slug ?? rubrique) && (!slug || o.categorie === rubrique));
  // Ancienne page d'œuvre Cargo (/cigale-lions) → /gravures/cigale-lions.
  if (rubrique && !slug && !TITRES[rubrique] && oeuvre?.publie) return res.redirect(301, `/${oeuvre.categorie}/${oeuvre.slug}`);

  let titre = null;
  if (!rubrique) titre = '';
  else if (!reste.length && TITRES[rubrique]) titre = slug ? (oeuvre?.publie ? oeuvre.publie.titre || 'Sans titre' : null) : TITRES[rubrique];
  // Les œuvres en brouillon restent accessibles à l'artiste connectée.
  if (titre === null && slug && oeuvre && estAdmin(req)) titre = 'brouillon';

  const titreComplet = titre ? `${titre} — ${db.site.titre}` : db.site.titre;
  res.status(titre === null ? 404 : 200).type('html');
  res.send(modelePage.replace(/<title>.*<\/title>/, `<title>${echapper(titreComplet)}</title>`));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'Une photo dépasse 40 Mo.',
      LIMIT_FILE_COUNT: 'Trop de photos envoyées en une fois.',
    };
    return res.status(400).json({ erreur: messages[err.code] ?? "Erreur lors de l'envoi." });
  }
  console.error(err);
  res.status(500).json({ erreur: 'Erreur du serveur.' });
});

await faireLeMenage();

app.listen(PORT, () => {
  console.log(`Site : http://localhost:${PORT}`);
  console.log(`Espace artiste : http://localhost:${PORT}/admin`);
});
