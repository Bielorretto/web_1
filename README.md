# Galerie d'artiste

Site vitrine pour présenter des œuvres : une galerie publique qu'on fait défiler, et un espace artiste privé pour gérer les photos et leurs textes.

## Lancer le site

```bash
npm install
npm start
```

- Galerie : http://localhost:3000
- Espace artiste : http://localhost:3000/admin

Le mot de passe de l'espace artiste se règle dans le fichier `.env` (`ADMIN_PASSWORD`). **Changez-le avant la mise en ligne.**

## Utilisation (espace artiste)

1. Connectez-vous sur `/admin`.
2. Renseignez votre nom et un court texte de présentation.
3. Glissez vos photos dans la zone d'envoi (autant que vous voulez).
4. Pour chaque œuvre, écrivez un titre et un texte : ils s'affichent au-dessus de la photo dans la galerie.
5. Utilisez ↑ / ↓ pour choisir l'ordre de passage.

## Protection des images

- Seule une copie réduite (1800 px max, sans métadonnées) est mise en ligne. L'original ne quitte jamais votre ordinateur.
- Les images sont dessinées dans un `<canvas>` : pas de « Enregistrer l'image sous… », pas de glisser-déposer, clic droit désactivé.
- L'adresse d'une image ne s'ouvre pas directement dans le navigateur et ne peut pas être affichée par un autre site.
- L'impression de la galerie est bloquée.

Aucun site ne peut empêcher une capture d'écran : ces mesures découragent la copie sans la rendre impossible.

## Fichiers

- `server.js` : le serveur (Node.js + Express)
- `public/` : les pages (galerie et espace artiste)
- `data/galerie.json` : les textes et l'ordre des œuvres (créé automatiquement)
- `storage/` : les images (créé automatiquement)

Pour sauvegarder le site, copiez les dossiers `data/` et `storage/`.
