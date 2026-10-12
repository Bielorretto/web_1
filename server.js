import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STORAGE_DIR = path.join(ROOT, 'storage');
const DB_FILE = path.join(DATA_DIR, 'galerie.json');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 8 * 60 * 60 * 1000;
// Seules des versions réduites sont servies : l'original n'est jamais conservé ni exposé.
const TAILLES = { grand: { px: 1800, qualite: 82 }, miniature: { px: 360, qualite: 72 } };

if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD doit être défini dans le fichier .env (8 caractères minimum).');
  process.exit(1);
}

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(STORAGE_DIR, { recursive: true });

// ---------- Données ----------

let db = await chargerDb();

async function chargerDb() {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return { artiste: { nom: "Nom de l'artiste", presentation: '' }, oeuvres: [] };
  }
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

const vuePublique = (o) => ({ id: o.id, titre: o.titre, texte: o.texte, largeur: o.largeur, hauteur: o.hauteur });
const fichierImage = (id, taille) => path.join(STORAGE_DIR, `${id}-${taille}.webp`);

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
app.use(express.json({ limit: '100kb' }));

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
  if (!TAILLES[taille] || !db.oeuvres.some((o) => o.id === id)) return res.sendStatus(404);

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

app.get('/api/galerie', (req, res) => {
  res.json({ artiste: db.artiste, oeuvres: db.oeuvres.map(vuePublique) });
});

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

app.post('/api/oeuvres', exigerAdmin, upload.array('photos'), async (req, res) => {
  const ajoutees = [];
  const refusees = [];

  for (const fichier of req.files ?? []) {
    const id = crypto.randomUUID();
    try {
      // rotate() applique l'orientation EXIF ; sharp supprime les métadonnées (GPS, appareil…).
      const source = sharp(fichier.buffer, { failOn: 'error' }).rotate();
      let infos;
      for (const [taille, { px, qualite }] of Object.entries(TAILLES)) {
        const resultat = await source
          .clone()
          .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: qualite })
          .toFile(fichierImage(id, taille));
        if (taille === 'grand') infos = resultat;
      }
      const oeuvre = {
        id,
        titre: '',
        texte: '',
        largeur: infos.width,
        hauteur: infos.height,
        ajouteeLe: new Date().toISOString(),
      };
      db.oeuvres.push(oeuvre);
      ajoutees.push(oeuvre);
    } catch {
      await Promise.all(Object.keys(TAILLES).map((t) => fs.rm(fichierImage(id, t), { force: true })));
      refusees.push(fichier.originalname);
    }
  }

  await sauverDb();
  res.status(201).json({ ajoutees, refusees });
});

app.patch('/api/oeuvres/:id', exigerAdmin, async (req, res) => {
  const oeuvre = db.oeuvres.find((o) => o.id === req.params.id);
  if (!oeuvre) return res.status(404).json({ erreur: 'Œuvre introuvable.' });

  if (typeof req.body?.titre === 'string') oeuvre.titre = req.body.titre.trim().slice(0, 200);
  if (typeof req.body?.texte === 'string') oeuvre.texte = req.body.texte.trim().slice(0, 5000);
  await sauverDb();
  res.json(oeuvre);
});

app.delete('/api/oeuvres/:id', exigerAdmin, async (req, res) => {
  const index = db.oeuvres.findIndex((o) => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ erreur: 'Œuvre introuvable.' });

  const [oeuvre] = db.oeuvres.splice(index, 1);
  await sauverDb();
  await Promise.all(Object.keys(TAILLES).map((t) => fs.rm(fichierImage(oeuvre.id, t), { force: true })));
  res.sendStatus(204);
});

app.put('/api/ordre', exigerAdmin, async (req, res) => {
  const ids = req.body?.ids;
  const actuels = new Set(db.oeuvres.map((o) => o.id));
  if (!Array.isArray(ids) || ids.length !== actuels.size || !ids.every((id) => actuels.has(id))) {
    return res.status(400).json({ erreur: 'Ordre invalide, rechargez la page.' });
  }
  const parId = new Map(db.oeuvres.map((o) => [o.id, o]));
  db.oeuvres = ids.map((id) => parId.get(id));
  await sauverDb();
  res.json({ ok: true });
});

app.put('/api/artiste', exigerAdmin, async (req, res) => {
  const { nom, presentation } = req.body ?? {};
  if (typeof nom === 'string') db.artiste.nom = nom.trim().slice(0, 120);
  if (typeof presentation === 'string') db.artiste.presentation = presentation.trim().slice(0, 2000);
  await sauverDb();
  res.json(db.artiste);
});

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use(express.static(PUBLIC_DIR));

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

app.listen(PORT, () => {
  console.log(`Galerie : http://localhost:${PORT}`);
  console.log(`Espace artiste : http://localhost:${PORT}/admin`);
});
