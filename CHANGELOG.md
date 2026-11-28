# Journal des modifications

Toutes les évolutions notables d'Eugéa. Le module Foundry a son propre journal dans le dépôt [eugea-importer](https://github.com/AlexisRodenas/eugea-importer/blob/main/CHANGELOG.md).

## 1.3.0

### Corrigé
- **Objets et toits décalés dans Foundry V14** : depuis la V14, la position d'une tuile désigne son centre et non plus son coin. Le module (1.3.0) et l'archive « Scènes JSON » placent désormais les tuiles au bon endroit.
- Les cartes importées n'étaient plus systématiquement sombres : la lumière se choisit (voir plus bas).

### Ajouté
- **Plan de ville** (générateur) : grande cité fortifiée en quartiers, ville ou bourg rural ; rues, place du marché, cathédrale, château, remparts avec une porte par route, rivière et ponts, champs et bois alentour, noms des quartiers. 1 case = 5 m.
- **Carte du monde** (générateur) : continent, archipel ou terres intérieures ; relief, côtes, climat et biomes, rivières, montagnes et forêts en pictogrammes, villes reliées par des routes, mers et chaînes nommées, rose des vents. 1 case = 5 km.
- Pictogrammes de cartes (catégorie *Cartes*) : montagne, collines, bosquets, ville, bourg, hameau, château, rose des vents.
- **Bâtiments réalistes** dans le générateur de village : chaque type a ses pièces et son mobilier (taverne avec comptoir, tabourets, cheminée, cuisine et réserve ; maison avec salle commune et chambres ; forge avec foyer, enclume et logement ; échoppe avec comptoir et réserve ; chapelle avec nef, bancs et autel ; grange avec stalles ; entrepôt), et ses abords (potager, bûches, abreuvoir, enseigne, petit cimetière…).
- **Étages automatiques** : maisons et échoppes à étage (proportion réglable), tavernes avec chambres à l'étage, escalier au même endroit sur les deux niveaux ; donjons sur plusieurs niveaux reliés par des escaliers.
- 22 nouveaux meubles et équipements : comptoir, tabouret, cheminée, four à pain, plan de travail, chaudron, armoire, étagère, lutrin, établi, foyer de forge, râtelier, sacs, tas de bûches, chandelier, potager, abreuvoir, banc d'église, bureau, tonneau couché, lit double, plante en pot.
- **Arbres en deux parties** : le tronc (au sol) et le feuillage. Dans Foundry ce sont deux tuiles : le feuillage passe au-dessus des jetons et s'efface quand un jeton passe dessous. La touche `K` montre les troncs.
- **Tous les objets en tuiles** dans Foundry (réglage par défaut) : chaque meuble, arbre ou objet se déplace, se cache ou se supprime ; le fond ne garde que sols, murs, portes, terrains et remparts. Ordre d'empilement respecté (sol, meubles, dessus, toits).
- **Jour, crépuscule ou nuit** : dans le panneau Carte et au moment de l'export. Les extérieurs générés sont de jour, les souterrains de nuit.
- Étages dans Foundry V14 : l'image d'un étage est transparente hors des bâtiments et laisse voir les rues du rez-de-chaussée.
- Images déjà présentes dans Foundry : en indiquant le chemin du dossier connecté (*Mes images → Dans Foundry*), l'export réutilise ces fichiers au lieu de les recopier.
- Recherche d'objets dans le panneau *Objets*.
- Nouvelle carte : choix de l'échelle (combat, plan de ville, région, monde).

### Modifié
- Barre d'outils regroupée (*Vue*, *Bâtir*, *Décorer*) avec le nom de chaque outil.
- Dessin simplifié des toits et des arbres vus de loin : les grands plans restent fluides.

## 1.2.0

### Ajouté
- **Remparts** (outil `M`) : murailles de pierre crénelées ou palissades, tours aux angles ; `Maj` + clic pour percer une porte. Portes fortifiées et portails de palissade, avec de vraies portes dans Foundry. Enceinte optionnelle autour des villages.
- **Passages** (outil `J`) : téléportation entre deux points, sur le même étage ou d'un étage à l'autre ; escaliers, échelles et trappes reliés automatiquement à l'étage voisin.
- Pinceau de dispersion (forêt mixte, sous-bois, rocaille, marais, objet ou image choisis).
- Ombres portées des objets, vignette, effets autour des murs désactivables, style de hachures au choix.

### Modifié
- Arbres, sapins, buissons, toits, statue, tente, enclume, panneau, lanterne, fleurs et ossements redessinés ; eau plus douce.

## 1.1.0

### Ajouté
- **Toits** (chaume, tuiles, ardoise, bardeaux, auvents, frondaisons), au-dessus des jetons dans Foundry ; touche `K` pour voir à travers.
- **Vos images** : dossier d'images connecté, recherche, glisser-déposer, remplacement des dessins intégrés par vos images.

### Modifié
- Le module Foundry a désormais son propre dépôt.

## 1.0.0

Première version : éditeur de cartes (salles, murs, portes, terrains, objets, lumières, textes, étages), générateurs (donjon, grotte, labyrinthe, forêt, village), export vers Foundry VTT, Universal VTT et image.
