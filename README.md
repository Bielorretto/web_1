# Petite Nature Paris — Delphine Huard

Site de l'artiste, recréé sans Cargo : gravures, dessins, ma démarche, à propos, contact. Un espace artiste privé permet de tout modifier sans toucher au code. Le site s'adapte aux téléphones.

## Lancer le site

```bash
npm install
npm start
```

- Galerie : http://localhost:3000
- Espace artiste : http://localhost:3000/admin

Le mot de passe de l'espace artiste se règle dans le fichier `.env` (`ADMIN_PASSWORD`). **Changez-le avant la mise en ligne.**

## Modifier le site

1. Connectez-vous sur `/admin` : vous arrivez sur le site, avec une barre en bas de l'écran.
2. Sur n'importe quelle page, cliquez sur **« Modifier cette page »**.
3. Sur toutes les pages (accueil, galeries, pages d'œuvre, ma démarche, à propos, contact), **le placement est libre** :
   - glissez des images depuis votre ordinateur à l'endroit voulu (sur une galerie, chaque photo devient une œuvre) ;
   - attrapez un bloc n'importe où pour le déplacer, tirez le rond bleu de son coin pour le redimensionner ;
   - cliquez dans un texte pour l'écrire ; « + Texte » en ajoute un ;
   - bloc sélectionné : style (texte, titre, légende), alignement, gras, italique, lien, 📱 masquer sur téléphone, ✕ supprimer ; les flèches du clavier le décalent finement (Maj pour aller plus vite) ;
   - « Aperçu téléphone » montre la page sur mobile, où les blocs s'empilent automatiquement de haut en bas.
4. Sur une galerie, « Modifier l'œuvre → » ouvre la page de l'œuvre : titre (affiché sous l'image dans la galerie), adresse, images et textes.
5. Tout est enregistré **en brouillon**, automatiquement. Les visiteurs ne voient rien tant que vous n'avez pas cliqué sur **« Publier »**. « Abandonner le brouillon » revient à la version en ligne.

Chaque page se publie séparément. Publier une œuvre la fait apparaître dans sa galerie ; publier une galerie publie aussi ses nouvelles œuvres et supprime celles que vous avez retirées.

Les réglages (titre du site, nom, Instagram, e-mail) se modifient sur `/admin` et sont en ligne dès l'enregistrement.

Les anciennes adresses du site Cargo (`/presentation`, `/ma-démarche`, `/menu-gravures`…) redirigent vers les nouvelles. Pour qu'une ancienne page d'œuvre comme `/cigale-lions` continue de marcher, écrivez `cigale-lions` dans le champ « Adresse » de l'œuvre.

## Polices

Le site utilise des équivalents gratuits (Google Fonts) des polices Adobe de l'ancien site. Si l'artiste a un abonnement Adobe Fonts, on peut charger « Baskerville Display PT » : la feuille de style l'utilisera automatiquement (il faudra autoriser `use.typekit.net` dans la règle `Content-Security-Policy` de `server.js`).

## Protection des images

- Seules des copies réduites (1800 px max, sans métadonnées) est mise en ligne. L'original ne quitte jamais votre ordinateur.
- Les images sont dessinées dans un `<canvas>` : pas de « Enregistrer l'image sous… », pas de glisser-déposer, clic droit désactivé.
- L'adresse d'une image ne s'ouvre pas directement dans le navigateur et ne peut pas être affichée par un autre site.
- L'impression de la galerie est bloquée.

Aucun site ne peut empêcher une capture d'écran : ces mesures découragent la copie sans la rendre impossible.

## Fichiers

- `server.js` : le serveur (Node.js + Express)
- `public/` : le site (`index.html`, `site.js`, `commun.js`, `style.css`), le mode édition (`edition.js`, `edition.css`) et la page de connexion (`admin.*`)
- `contenu-initial.json` : les textes de départ, repris de l'ancien site
- `data/site.json` : les pages, œuvres et brouillons (créé automatiquement)
- Positions des blocs : en millièmes de la largeur de la page, pour que la composition garde ses proportions sur tous les écrans ; textes nettoyés côté serveur par `sanitize-html`
- `storage/` : les images (créé automatiquement)

Pour sauvegarder le site, copiez les dossiers `data/` et `storage/`.
