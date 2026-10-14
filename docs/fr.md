# QNAP

Suivez un NAS QNAP sous QTS ou QuTS hero depuis Gladys : processeur, mémoire,
températures, ventilateurs, réseau, volumes, disques et l'onduleur qu'il
partage, avec des scènes quand un volume ou un disque demande attention ou
qu'une mise à jour du firmware sort, et un widget de tableau de bord.

L'intégration **lit**. La seule chose qu'elle peut faire sur le NAS est le
redémarrer ou l'éteindre depuis une scène, et seulement une fois que vous
l'avez autorisé dans la configuration (désactivé par défaut).

> **Développée sans le matériel : retours bienvenus.** L'intégration lit la
> même API web que l'intégration Home Assistant et la bibliothèque qnapstats,
> vérifiée sur les vraies réponses de neuf modèles QNAP (QTS 4.2 à 4.5). S'il
> manque quelque chose ou si une valeur est fausse sur le vôtre, ouvrez une
> issue : <https://github.com/guim31/gladys-qnap/issues>.

Non affiliée à QNAP. Ni approuvée ni sponsorisée par QNAP Systems, Inc. QNAP,
QTS et QuTS hero sont des marques de leurs propriétaires.

## Ce que vous obtenez

Après la configuration, l'onglet **Découverte** propose les appareils
suivants. Ajoutez ceux à suivre : rien n'est créé à votre place.

### Le NAS

- **En ligne** : 1 tant que le NAS répond, 0 dès qu'il ne répond plus.
- **Processeur** et **Mémoire** : utilisation, en %.
- **Température du processeur** et **Température du système**, en °C (quand le
  modèle les donne : certains modèles ARM n'ont pas de sonde processeur).
- **Ventilateur 1 (tr/min)**, **Ventilateur 2 (tr/min)**… : la vitesse de
  chaque ventilateur système. Gladys n'a pas d'unité « tr/min » : la valeur
  est un nombre simple, le nom porte l'unité.
- **Réception** et **Émission** de chaque interface réseau (`Réception LAN 1`,
  `Émission LAN 1`…), en Mbit/s.
- **Durée de fonctionnement**, en jours.
- **Version du firmware**, par exemple `5.2.1.3000 build 20261001`.
- **Mise à jour disponible** : 1 quand le NAS propose un firmware plus récent
  (vérifié toutes les 6 heures ; exige un compte administrateur, voir plus
  bas).

### Volumes

Un appareil par volume (`DataVol1`…) :

- **Espace utilisé**, en % ;
- **Capacité** et **Espace libre**, en Go ;
- **État** : Prêt, Reconstruction (reconstruction, resynchronisation ou
  migration RAID en cours), Dégradé ou anormal ;
- **Alerte** : 1 quand l'état demande attention, 0 sinon — pratique dans les
  scènes et l'historique.

QTS donne un code d'état pour chaque volume, et seul le code d'un volume prêt
est connu avec certitude. Tout autre code s'affiche **Dégradé ou anormal** et
lève l'alerte : manquer un RAID dégradé est pire qu'une fausse alerte. Le code
est écrit dans les logs : signalez-le avec ce qu'affiche QTS.

### Disques

Un appareil par disque, son modèle comme modèle de l'appareil :

- **Température**, en °C ;
- **État** : le résumé SMART de QTS — Bon, Avertissement ou Erreur ;
- **Alerte** : 1 pour Avertissement ou Erreur.

Les disques sont lus toutes les 5 minutes au plus, quelle que soit la
fréquence de relevé.

### L'onduleur

Quand le NAS partage son onduleur (voir plus bas), un appareil de plus :

- **Batterie**, en % ;
- **Autonomie**, en minutes ;
- **Charge**, en % ;
- **Sur batterie** : 1 sur batterie, 0 sur secteur ;
- **Batterie faible** : 1 quand l'onduleur signale une batterie faible.

## Avant de commencer

### Un compte dédié

Créez un compte sur le NAS pour Gladys (Panneau de configuration → Privilèges
→ Utilisateurs), sans accès aux dossiers partagés ni aux applications.

- **Pour lire** : sur les QTS et QuTS hero récents (avec l'**administration
  déléguée**), donnez à ce compte le rôle **Surveillance du système**. Sur les
  firmwares plus anciens, sans administration déléguée, le compte doit être
  dans le groupe **administrateurs** : QTS n'offre pas d'autre accès en
  lecture seule à ces informations.
- **Pour vérifier les mises à jour, redémarrer ou éteindre** : QTS ne
  l'autorise qu'à un administrateur. Avec un compte Surveillance du système,
  tout le reste fonctionne ; **Mise à jour disponible** reste sans valeur et
  les actions de scène sont refusées.

Connectez-vous une fois à l'interface web de QTS avec ce compte et acceptez
les conditions ou assistants que QTS affiche d'abord : jusque-là, QTS peut le
refuser.

### Vérification en 2 étapes

L'intégration ne peut pas saisir un code de vérification en 2 étapes :
utilisez un compte **sans** vérification en 2 étapes. Si votre politique de
sécurité l'impose à tous les comptes, gardez le NAS hors d'Internet, donnez
au compte de Gladys un long mot de passe aléatoire et aucun autre droit, et
limitez les adresses autorisées à joindre le NAS (Panneau de configuration →
Sécurité → Liste d'autorisation/de refus) à votre réseau local.

### HTTP ou HTTPS

- **HTTP** (port 8080 par défaut) : QTS reçoit le mot de passe encodé en
  base64, ce qui n'est pas un chiffrement. Acceptable sur un réseau domestique
  de confiance.
- **HTTPS** (port 443 par défaut) : le mot de passe est chiffré. Le certificat
  que génère QTS est auto-signé : cochez **Accepter un certificat auto-signé**,
  ou installez sur le NAS un certificat reconnu (Let's Encrypt).

### Partager l'onduleur

QTS n'a pas de moyen documenté de lire sa page onduleur. L'intégration lit
l'onduleur comme le font les autres NAS QNAP : avec Network UPS Tools (NUT),
port 3493.

1. Sur le NAS : Panneau de configuration → Périphérique externe → UPS, cochez
   **Activer la prise en charge de l'UPS réseau** (maître UPS réseau).
2. Ajoutez l'adresse IP de la machine qui fait tourner Gladys aux adresses IP
   autorisées.

Rien d'autre : lire l'onduleur ne demande aucun mot de passe. Sans cela,
l'intégration ne trouve simplement pas d'onduleur.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. **Adresse du NAS** : son adresse IP sur votre réseau, par exemple
   `192.168.1.50` : HTTP sur le port 8080. `https://192.168.1.50` utilise
   HTTPS sur le port 443 ; ajoutez le port si vous l'avez changé
   (`https://192.168.1.50:5001`).
3. **Nom d'utilisateur** et **Mot de passe** du compte ci-dessus. Le mot de
   passe n'est jamais écrit dans les logs.
4. **Accepter un certificat auto-signé** : HTTPS seulement, voir plus haut.
5. **Fréquence de relevé** : toutes les minutes (par défaut), toutes les 2 ou
   5 minutes.
6. **Lire l'onduleur du NAS** : activé par défaut ; désactivez-le si le NAS
   n'a pas d'onduleur.
7. **Autoriser les scènes à redémarrer ou éteindre le NAS** : désactivé par
   défaut. Laissez-le désactivé sauf si une scène en a vraiment besoin.
8. **Langue des noms et des états** : français par défaut. Gladys ne transmet
   pas votre langue à l'intégration : les noms des fonctionnalités, les états
   et les variables de scène utilisent celle-ci.
9. Enregistrez, puis utilisez **Tester la connexion** : elle lit le NAS et son
   onduleur maintenant et indique ce qu'elle a trouvé, par exemple « NAS :
   connecté, TS-464, QTS 5.2.1.3000 build 20261001, 1 volume(s), 4 disque(s),
   onduleur lu ». Ajoutez ensuite les appareils depuis l'onglet
   **Découverte**.

## Widget de tableau de bord

Ajoutez le widget **NAS QNAP** à un tableau de bord : deux jauges
(processeur, mémoire), la température, puis une liste où ce qui demande
attention passe en tête (un volume, un disque, un ventilateur en alerte,
l'onduleur sur batterie, une mise à jour du firmware), puis chaque volume avec
son occupation et son espace libre, l'onduleur et la durée de fonctionnement.
Le bouton **Actualiser** relit le NAS. Un NAS qui ne répond pas est dit en
toutes lettres.

## Déclencheurs de scène

- **Volume dégradé** : un volume passe en Reconstruction ou Dégradé ou
  anormal ; de nouveau s'il empire. Filtre : un volume, ou tous (vide).
  Variables : le NAS, le volume, son état.
- **Disque en alerte** : QTS juge un disque en Avertissement ou en Erreur ; de
  nouveau s'il passe d'Avertissement à Erreur. Filtre : un disque, ou tous.
  Variables : le NAS, le disque, son modèle, son état, sa température.
- **Mise à jour du firmware disponible** : le NAS propose un QTS ou QuTS hero
  plus récent ; une fois par version. Variables : le NAS, la version
  installée, la nouvelle.

Ces déclencheurs valent pour tous les volumes et disques, ajoutés à Gladys ou
non, et ne se répètent pas après un redémarrage de Gladys ou de
l'intégration. L'état trouvé au tout premier relevé est enregistré sans
événement.

## Actions de scène

- **Redémarrer le NAS QNAP** et **Éteindre le NAS QNAP** : refusées sauf si
  **Autoriser les scènes à redémarrer ou éteindre le NAS** est coché, et si le
  compte est administrateur. Un NAS éteint se rallume à la main, ou par
  Wake-on-LAN si vous l'avez activé sur le NAS.

## Idées de scènes

- **Un RAID dégradé** : déclencheur **Volume dégradé** → message
  « {{triggerEvent.data.volume_name}} est {{triggerEvent.data.state}} » à
  toute la maison, et une lampe passe au rouge.
- **Un disque fatigué** : déclencheur **Disque en alerte** → message avec le
  disque, son modèle et sa température, pour commander un disque de rechange
  avant la panne.
- **Coupure de courant** : déclencheur « état d'un appareil » sur **Sur
  batterie** = 1 → message ; puis, si **Batterie** descend sous 30 %,
  l'action **Éteindre le NAS QNAP** (option cochée). QTS peut aussi s'éteindre
  seul selon son propre réglage onduleur : préférez-le quand il suffit.
- **Mises à jour** : déclencheur **Mise à jour du firmware disponible** →
  message le dimanche matin avec `{{triggerEvent.data.new_version}}`.
- **Un NAS trop chaud** : déclencheur « état d'un appareil » sur
  **Température du système** au-dessus de 50 °C → message.

## À quel rythme le NAS est lu

À chaque relevé, trois requêtes à l'API web du NAS (système, volumes,
réseau) ; les disques toutes les 5 minutes ; la vérification du firmware
toutes les 6 heures ; l'onduleur à chaque relevé (toutes les 10 minutes tant
que le NAS n'en partage pas). Seules les valeurs qui changent sont envoyées à
Gladys, chaque valeur au moins toutes les 6 heures.

L'intégration garde sa session ouverte entre deux relevés et d'un redémarrage
à l'autre (rangée sous `/data`, jamais dans les logs) : elle ne remplit pas le
journal des connexions du NAS d'une connexion par minute. Un mot de passe
refusé n'est jamais réessayé seul : QTS bloque une adresse après quelques
échecs. Corrigez-le puis enregistrez, ou utilisez **Tester la connexion**.

## Dépannage

- **« nom d'utilisateur ou mot de passe refusé »** : vérifiez-les en vous
  connectant à l'interface web de QTS. Trop d'échecs ont pu bloquer l'adresse
  de Gladys : Panneau de configuration → Sécurité → Protection de l'accès IP.
- **« ce compte utilise la vérification en 2 étapes »** : utilisez un compte
  qui ne l'a pas.
- **« ce compte ne peut pas lire le système »** : donnez-lui le rôle
  Surveillance du système, ou mettez-le dans le groupe administrateurs.
- **« certificat HTTPS refusé »** : cochez **Accepter un certificat
  auto-signé**.
- **« pas d'interface QTS à cette adresse »** : vérifiez le port (Panneau de
  configuration → Paramètres généraux → Port du système ; port HTTPS dans
  Serveur web/Sécurité).
- **« ne répond pas »** : le NAS est-il allumé, sur le même réseau, l'adresse
  est-elle juste ?
- **Pas d'onduleur** : vérifiez la prise en charge de l'UPS réseau du NAS et
  que l'adresse de la machine de Gladys est autorisée. **Tester la connexion**
  indique « onduleur refusé (adresses IP autorisées ?) » quand le NAS refuse
  Gladys.
- **Plus de détails** : réglez `LOG_LEVEL=debug` sur l'intégration pour voir
  chaque relevé dans ses logs.

## Limites

- Un seul NAS par installation de l'intégration.
- Développée sans le matériel : les codes d'état de volume autres que « prêt »
  ne sont pas documentés par QNAP. QuTS hero devrait répondre comme QTS mais
  n'a pas été testé.
- Le rôle en lecture seule (Surveillance du système) n'atteint pas la
  vérification du firmware ; redémarrer et éteindre exigent un administrateur.
- Aucun pilotage des applications, dossiers partagés, instantanés, Container
  Station ou machines virtuelles.
- Les disques sans SMART (certains boîtiers USB) et les unités d'extension
  peuvent manquer ou être incomplets.
- Gladys n'a pas d'unité « tr/min » : les vitesses des ventilateurs sont des
  nombres simples.
