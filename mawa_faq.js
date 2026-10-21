/**
 * FAQ MAWA — base de réponses prédéfinies de l'assistant DJASSACI.
 *
 * Objectif : pouvoir répondre aux questions fréquentes même lorsque Gemini est
 * temporairement indisponible (clé absente, 429, 502, timeout...).
 *
 * Toutes les informations présentes dans les réponses proviennent du code
 * réellement existant du projet (backend `server.js` + application Flutter).
 * Aucun prix, délai, Procedure ou fonctionnalité n'est inventé.
 *
 * Utilisation :
 *   const { findFaqAnswer, MAWA_FAQ_UNAVAILABLE_MESSAGE } = require('./mawa_faq');
 *   const hit = findFaqAnswer(message);            // correspondance stricte
 *   const soft = findFaqAnswer(message, { loose: true }); // repli élargi
 *
 * Structure d'une entrée :
 *   requirements : groupes de synonymes, TOUS obligatoires (concept exact).
 *   groups       : groupes de formulations de question, au moins 1 doit être
 *                  présent pour une correspondance stricte (sinon : mode loose).
 */

// ===== Constantes (miroir du code réel, voir server.js) =====
const CERTIFICATION_PRICE_FCFA = 1000; // server.js : MONTHLY_SUBSCRIPTION_FCFA
const CERTIFICATION_DURATION_DAYS = 30; // server.js : baseDate + 30 * 24 * 60 * 60 * 1000
const COMMISSION_RATE_PERCENT = 5; // server.js : commissionRate = 0.05
// Numéro WhatsApp professionnel déjà configuré côté application Flutter
// (lib/utils/constants.dart : whatsappBusinessNumber). Surchargeable par variable
// d'environnement pour éviter tout doublon de configuration.
const WHATSAPP_BUSINESS_NUMBER = (
  process.env.WHATSAPP_BUSINESS_NUMBER || '2250715926401'
).replace(/[^0-9]/g, '');

const MAWA_FAQ_ENTRIES = [
  // ===================== COMPTE =====================
  {
    categorie: 'Compte',
    question: 'Comment créer un compte ?',
    requirements: [
      ['creer', 'creation', 'inscrire', 'inscription', 'nouveau compte', 'souscrire', 'ouvrir un compte'],
      ['compte', 'inscription', 'profil', 'espace'],
    ],
    groups: [['comment', 'procedure', 'etapes', 'quoi', 'faire', 'ou', 'marche pas']],
    answer:
      "Pour créer un compte DJASSACI : appuyez sur le bouton d'inscription, puis renseignez votre nom, votre prénom, votre numéro de téléphone, votre adresse et un mot de passe d'au moins 6 caractères. Votre numéro de téléphone sert ensuite d'identifiant de connexion.",
  },
  {
    categorie: 'Compte',
    question: 'Comment se connecter à mon compte ?',
    requirements: [
      ['connecter', 'connexion', 'se connecter', 'login', 'entrer', 'acceder', 'session'],
      ['compte', 'application', 'session', 'profil'],
    ],
    groups: [['comment', 'faire', 'probleme', 'marche pas', 'echec']],
    answer:
      "La connexion se fait avec votre numéro de téléphone et votre mot de passe depuis l'écran de connexion. Votre session est conservée sur votre appareil : vous restez connecté au redémarrage de l'application.",
  },
  {
    categorie: 'Compte',
    question: "J'ai oublié mon mot de passe, que faire ?",
    requirements: [
      ['mot de passe', 'mdp', 'password'],
      ['oublie', 'oubliee', 'perdu', 'perdue', 'reinitialiser', 'reinitialisation', 'changer', 'modifier', 'changer mon mot de passe', 'nouveau mot de passe'],
    ],
    groups: [['comment', 'faire', 'ou', 'aider', 'que faire']],
    answer:
      "Depuis l'écran de connexion, utilisez « Mot de passe oublié » : saisissez votre numéro et un nouveau mot de passe (6 caractères minimum). DJASSACI vérifie votre demande via le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      " avant de valider la réinitialisation.",
  },
  {
    categorie: 'Compte',
    question: 'Comment modifier mon profil ou mon adresse ?',
    requirements: [
      ['profil', 'adresse', 'numero', 'telephone', 'coordonnees', 'informations personnelles'],
      ['modifier', 'changer', 'mettre a jour', 'editer', 'corriger'],
    ],
    groups: [['comment', 'ou', 'faire']],
    answer:
      "Vos informations se modifient depuis l'onglet Profil de l'application. L'adresse enregistrée sert aussi de localisation pour vos annonces et d'information de livraison pour vos commandes.",
  },

  // ===================== VENTE =====================
  {
    categorie: 'Vente',
    question: 'Comment publier un produit ?',
    requirements: [
      ['publier', 'publication', 'mettre en vente', 'deposer', 'lister', 'ajouter', 'creer', 'vendre', 'vente'],
      ['produit', 'annonce', 'article', 'objet', 'telephone', 'chaussure', 'vêtement', 'montre', 'sac', 'informatique', 'immobilier'],
    ],
    groups: [['comment', 'faire', 'etapes', 'procedure', 'obligatoire', 'champs', 'erreur', 'marche pas']],
    answer:
      "Pour publier : onglet « Vendre » → renseignez le nom, le prix en FCFA, la description et la catégorie (champs obligatoires), ajoutez au moins une photo, puis indiquez votre compte WhatsApp de vendeur, la méthode de paiement et le numéro de compte associé ainsi que votre localisation (rendue automatiquement depuis votre adresse de profil). Si un champ obligatoire manque, la publication est refusée et le motif est affiché.",
  },
  {
    categorie: 'Vente',
    question: 'Comment modifier ou supprimer une de mes annonces ?',
    requirements: [
      ['produit', 'annonce', 'article'],
      ['modifier', 'changer', 'supprimer', 'retirer', 'mettre a jour', 'editer', 'renommer', 'effacer'],
    ],
    groups: [['comment', 'ou', 'faire', 'mes produits']],
    answer:
      "Vos annonces sont gérées depuis « Mes produits » : vous pouvez modifier leurs informations ou les supprimer. La liste des produits de l'application est actualisée juste après.",
  },
  {
    categorie: 'Vente',
    question: 'Combien de photos faut-il pour publier un produit ?',
    requirements: [
      ['photo', 'photos', 'image', 'images', 'video', 'videos'],
      ['produit', 'annonce', 'article', 'publication', 'publier', 'obligatoire', 'requis', 'possible'],
    ],
    groups: [['combien', 'nombre', 'requis', 'obligatoire', 'possible', 'format', 'obligatoirement']],
    answer:
      "Au moins une photo est obligatoire pour publier un produit : les photos sont envoyées sur Cloudinary et la première sert d'image principale. Une vidéo peut également être associée à l'annonce.",
  },

  // ===================== ACHAT =====================
  {
    categorie: 'Achat',
    question: 'Comment acheter un produit ?',
    requirements: [
      ['acheter', 'achat', 'commander', 'commande', 'payer'],
      ['produit', 'article', 'objet', 'bien', 'vendeur', 'boutique'],
    ],
    groups: [['comment', 'faire', 'etapes', 'procedure', 'marche pas']],
    answer:
      "Pour acheter : ouvrez le produit, vérifiez les photos, le prix en FCFA et la description, puis ajoutez l'article au panier. Au moment de valider, renseignez le moyen de paiement (numéro et nom du compte payeur) et vos informations de livraison (nom, téléphone, ville/commune et quartier). La commande est enregistrée avec le statut « en_attente ».",
  },
  {
    categorie: 'Achat',
    question: 'Comment contacter le vendeur ?',
    requirements: [
      ['contacter', 'contact', 'joindre', 'ecrire', 'parler', 'message', 'appeler', 'telephone', 'whatsapp'],
      ['vendeur', 'boutique', 'annonce', 'produit'],
    ],
    groups: [['comment', 'faire', 'ou', 'possibilite', 'peut on']],
    answer:
      "Sur la fiche produit, le bloc « Contacter le vendeur » propose l'appel du vendeur et un message WhatsApp pré-rempli avec le nom, le prix et la description de l'article. Depuis le détail d'une commande, un bouton de discussion ouvre la messagerie interne avec le vendeur.",
  },
  {
    categorie: 'Achat',
    question: 'Comment suivre ma commande ?',
    requirements: [
      ['suivre', 'suivi', 'ou est', 'etat de', 'tracking', 'ou en est'],
      ['commande', 'commandee', 'colis', 'livraison', 'achat', 'article'],
    ],
    groups: [['comment', 'ou', 'faire', 'ou en est']],
    answer:
      "Toutes vos commandes sont regroupées dans « Commandes » : statut de la commande, statut de règlement côté vendeur et date y sont affichés. La réception se confirme depuis le détail de la commande, une fois que le vendeur l'a marquée comme livrée.",
  },

  // ===================== COMMANDES =====================
  {
    categorie: 'Commandes',
    question: "Quels sont les statuts possibles d'une commande ?",
    requirements: [
      ['statut', 'status', 'etat', 'etats', 'etape', 'etapes', 'ou en est', 'avancement'],
      ['commande', 'commandes', 'colis', 'livraison', 'paiement', 'achat'],
    ],
    groups: [['quels', 'quelles', 'quel', 'liste', 'comment', 'signifie', 'signific', 'que veut dire']],
    answer:
      "Côté acheteur : « en_attente » (commande créée), « payée » (paiement confirmé) ou « échouée » (paiement refusé), puis « livree » (le vendeur a marqué la livraison) et « livraison_confirmee » (vous avez confirmé la réception). Côté vendeur, le règlement passe de « a_payer_vendeur » à « paye_vendeur ».",
  },
  {
    categorie: 'Commandes',
    question: 'Comment confirmer la réception de ma commande ?',
    requirements: [
      ['confirmer', 'confirmation', 'valider', 'marquer', 'reception', 'recu'],
      ['livraison', 'commande', 'colis', 'reception', 'livre', 'livreur'],
    ],
    groups: [['comment', 'ou', 'faire', 'etapes']],
    answer:
      "Quand le vendeur a marqué la commande comme livrée, ouvrez le détail de la commande et confirmez la réception : le statut devient « livraison_confirmee ». La confirmation est refusée tant que la commande n'est pas marquée livrée.",
  },
  {
    categorie: 'Commandes',
    question: 'Que faire en cas de problème avec un colis ?',
    requirements: [
      ['probleme', 'pb', 'erreur', 'signaler', 'litige', 'casse', 'abime', 'manquant', 'perdu', 'retour', 'remboursement', 'annuler', 'annulation'],
      ['commande', 'commandee', 'colis', 'produit', 'article', 'livraison'],
    ],
    groups: [['comment', 'faire', 'ou', 'possible', 'que faire', 'dois']],
    answer:
      "Depuis le détail de la commande, le bouton de signalement ouvre un message WhatsApp pré-rempli à l'équipe DJASSACI avec le nom du colis, son prix et sa description. L'équipe traite la demande via le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      ".",
  },

  // ===================== PAIEMENTS =====================
  {
    categorie: 'Paiements',
    question: 'Quels moyens de paiement sont acceptés ?',
    requirements: [
      ['paiement', 'payer', 'regler', 'reglement', 'moyen de paiement', 'moyens de paiement', 'monnaie', 'mobile money', 'transaction'],
      ['moyen', 'moyens', 'methode', 'methodes', 'comment', 'quels', 'quelles', 'acceptes', 'disponibles', 'utiliser', 'faire'],
    ],
    groups: [['quels', 'quelles', 'comment', 'ou', 'disponibles', 'possibles', 'acceptes', 'liste']],
    answer:
      "Les moyens de paiement proposés dans l'application sont : Orange Money, MTN Money, Moov Money, Wave et Espèce. Pour le mobile money, l'application ouvre la page de paiement sécurisée GeniusPay ; le statut de la commande passe à « payée » après confirmation du paiement, ou « échouée » en cas d'échec.",
  },
  {
    categorie: 'Paiements',
    question: 'Quelle commission DJASSACI applique-t-il ?',
    requirements: [['commission', 'frais de service', 'frais djassaci', 'prelevement']],
    groups: [
      ['combien', 'quelle', 'quelles', 'quel', 'quoi', 'taux', 'pourcentage', 'pourcent', 'cout', 'coute', 'montant', 's applique'],
    ],
    answer:
      "DJASSACI prélève une commission de " +
      COMMISSION_RATE_PERCENT +
      " % sur le montant des articles de la commande. Le total affiché lors de la validation de la commande inclut cette commission.",
  },
  {
    categorie: 'Paiements',
    question: 'Puis-je payer à la livraison ?',
    requirements: [
      ['paiement', 'payer', 'regler'],
      ['livraison', 'espece', 'main propre', 'a la livraison', 'au livreur', 'retirer', 'a la reception'],
    ],
    groups: [['comment', 'possible', 'ou', 'moyen', 'est ce que', 'peut on']],
    answer:
      "Oui : « Espèce » fait partie des moyens de paiement proposés, ce qui permet de régler le vendeur à la livraison. Tant que le vendeur n'est pas réglé, le statut côté vendeur reste « a_payer_vendeur » ; il passe à « paye_vendeur » après paiement.",
  },
  {
    categorie: 'Paiements',
    question: "Mon paiement n'a pas abouti, que faire ?",
    requirements: [
      ['paiement', 'payer', 'transaction'],
      ['echec', 'echoue', 'erreur', 'bloque', 'bloquant', 'impossible', 'refuse', 'refusee', 'annule', 'probleme', 'pas abouti', 'ne marche pas'],
    ],
    groups: [['que faire', 'comment', 'faire', 'aider', 'pourquoi', 'que dois']],
    answer:
      "Un paiement mobile money non abouti laisse la commande au statut « échouée ». Vérifiez que le numéro saisi est bien votre numéro Money (Orange Money, MTN Money, Moov Money ou Wave) et que le compte est provisionné. Si le problème persiste, signalez le colis via le bouton de signalement (WhatsApp DJASSACI) ou contactez l'équipe au " +
      WHATSAPP_BUSINESS_NUMBER +
      ".",
  },

  // ===================== CERTIFICATION =====================
  {
    categorie: 'Certification',
    question: 'Combien coûte la certification vendeur ?',
    requirements: [
      ['certification', 'certifier', 'certifie', 'certifiee', 'certifications', 'badge', 'boutique certifiee', 'vendeur certifie'],
      ['prix', 'cout', 'coute', 'combien', 'tarif', 'montant', 'frais', 'duree', 'jours', 'mois', 'expire', 'expiration', 'renouveler', 'renouvellement', 'long', 'combien de temps'],
    ],
    groups: [['combien', 'prix', 'cout', 'coute', 'tarif', 'montant', 'duree', 'jours', 'mois', 'renouveler', 'expire']],
    answer:
      "La certification vendeur de DJASSACI coûte " +
      CERTIFICATION_PRICE_FCFA +
      " FCFA pour " +
      CERTIFICATION_DURATION_DAYS +
      " jours. Le badge « Certifié » s'affiche alors sur votre boutique et sur votre profil. À l'expiration, le badge est désactivé automatiquement et une bannière vous invite à renouveler ; le renouvellement se demande via le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      ".",
  },
  {
    categorie: 'Certification',
    question: 'Comment devenir boutique certifiée ?',
    requirements: [
      ['certification', 'certifier', 'certifie', 'certifiee', 'badge', 'boutique certifiee'],
      ['vendeur', 'boutique', 'vendeurs', 'obtenir', 'avoir', 'demander', 'devenir', 'faire', 'active'],
    ],
    groups: [['comment', 'faire', 'ou', 'etapes', 'procedure', 'demander', 'renouveler']],
    answer:
      "Depuis votre profil, le bouton « Devenir boutique certifiée » affiche une confirmation puis vous redirige vers le WhatsApp professionnel DJASSACI (" +
      WHATSAPP_BUSINESS_NUMBER +
      ") avec votre nom de vendeur. L'équipe vous demande les informations et justificatifs nécessaires pour vérifier votre identité et votre boutique, puis active la certification pour " +
      CERTIFICATION_DURATION_DAYS +
      " jours.",
  },
  {
    categorie: 'Certification',
    question: 'Que se passe-t-il quand ma certification expire ?',
    requirements: [
      ['badge', 'certifie', 'certification'],
      ['expire', 'expiration', 'renouveler', 'renouvellement', 'disparait', 'affiche', 'alerte', 'banniere'],
    ],
    groups: [['quand', 'comment', 'que se passe', 'marque', 'si']],
    answer:
      "Le badge « Certifié » reste affiché sur votre boutique et sur votre profil pendant toute la durée de l'abonnement. L'application affiche une bannière d'alerte quand il vous reste 4 jours ou moins, et le badge est retiré automatiquement dès que la certification expire.",
  },

  // ===================== PROMOTIONS =====================
  {
    categorie: 'Promotions',
    question: 'Où trouver les promotions ?',
    requirements: [['promotion', 'promotions', 'promo', 'remise', 'reductions', 'reduit', 'soldes']],
    groups: [['ou', 'comment', 'trouver', 'voir', 'consulter', 'existe', 'liste', 'offre', 'speciale']],
    answer:
      "L'onglet « Promotions » de l'accueil regroupe tous les produits en promotion, avec le prix remisé, le pourcentage de remise, la description et la catégorie. Vous pouvez filtrer par catégorie ou rechercher une promotion par mot-clé. Les nouvelles promotions sont aussi signalées par notification dans l'application.",
  },
  {
    categorie: 'Promotions',
    question: 'Comment sont calculés les prix en promotion ?',
    requirements: [
      ['promotion', 'promotions', 'promo', 'remise', 'reductions'],
      ['prix', 'remise', 'tarif', 'pourcentage', 'calcul', 'reduction de'],
    ],
    groups: [['comment', 'qui', 'par', 'cree', 'faire', 'calcul', 'prix remise']],
    answer:
      "Les promotions sont publiées par l'administration DJASSACI : chacune est définie par un nom, un prix, une description, une catégorie et un pourcentage de remise compris entre 1 et 100. Le prix remisé affiché est calculé automatiquement à partir du prix et du pourcentage de remise. Vos annonces, elles, se publient depuis l'onglet « Vendre ».",
  },

  // ===================== SECURITE =====================
  {
    categorie: 'Sécurité',
    question: 'Mes données sont-elles sécurisées ?',
    requirements: [
      ['securite', 'securise', 'sur', 'confidentiel', 'confidentialite', 'donnees', 'donnees personnelles', 'vie privee'],
      ['mot de passe', 'numero', 'compte', 'profil', 'informations', 'jwt', 'donnees'],
    ],
    groups: [['sont', 'est', 'comment', 'proteger', 'securise', 'sur', 'stocke', 'vrai']],
    answer:
      "Vos données sont rattachées à votre compte (numéro, nom, prénom, adresse). Votre mot de passe est enregistré sous forme de hash bcrypt, jamais en clair, et chaque appel à l'API est authentifié par un jeton JWT. Ne communiquez jamais votre mot de passe : l'équipe DJASSACI ne vous le demandera jamais.",
  },
  {
    categorie: 'Sécurité',
    question: 'Mon paiement est-il sécurisé ?',
    requirements: [
      ['paiement', 'carte', 'transaction', 'argent', 'numero de compte'],
      ['securise', 'securite', 'sur', 'sont', 'stocke', 'confidentiel', 'risque', 'safe'],
    ],
    groups: [['est', 'sont', 'sur', 'securise', 'confidentiel']],
    answer:
      "Les paiements mobiles passent par la page de paiement sécurisée GeniusPay : votre code secret de paiement n'est pas enregistré par DJASSACI. Sur chaque commande, le numéro et le nom du compte payeur sont conservés pour le suivi de la commande et le règlement du vendeur.",
  },
  {
    categorie: 'Sécurité',
    question: 'Comment signaler un vendeur ou une annonce douteuse ?',
    requirements: [
      ['arnaque', 'fraude', 'escroc', 'douteux', 'suspect', 'signaler', 'abus', 'litige', 'probleme', 'imposteur'],
      ['vendeur', 'annonce', 'produit', 'commande', 'colis', 'paiement', 'compte'],
    ],
    groups: [['comment', 'faire', 'ou', 'signaler', 'aider', 'contacter']],
    answer:
      "Si une annonce ou un vendeur vous semble douteux, signalez le colis depuis le détail de la commande : un message WhatsApp pré-rempli est envoyé à l'équipe DJASSACI avec le nom du produit, son prix et sa description. Pour tout autre signalement, utilisez le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      ".",
  },

  // ===================== ASSISTANCE =====================
  {
    categorie: 'Assistance',
    question: 'Comment contacter le support DJASSACI ?',
    requirements: [['support', 'assistance', 'service client', 'hotline', 'equipe djassaci', 'soutien']],
    groups: [['comment', 'ou', 'numero', 'contact', 'faire', 'joindre', 'whatsapp', 'contacter']],
    answer:
      "L'assistant MAWA, accessible depuis l'accueil, répond à vos questions sur les produits, les commandes, les paiements et la certification. Pour un traitement humain, l'équipe DJASSACI répond sur le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      " : indiquez votre numéro de téléphone et la nature de votre demande.",
  },
  {
    categorie: 'Assistance',
    question: "Qu'est-ce que MAWA et comment l'utiliser ?",
    requirements: [['mawa', 'assistant', 'assistant virtuel', 'bot']],
    groups: [['qui', 'quoi', 'comment', 'fonctionne', 'peut', 'fait', 'utiliser', 'c est', 'a quoi']],
    answer:
      "MAWA est l'assistant virtuel de DJASSACI, disponible depuis l'icône MAWA de l'accueil. Il répond aux questions fréquentes sur l'achat, la vente, les commandes, les paiements, les promotions et la certification. Le service accepte jusqu'à 10 questions par minute ; les échanges sont conservés une heure sur votre appareil.",
  },
  {
    categorie: 'Assistance',
    question: 'Puis-je parler avec un conseiller humain ?',
    requirements: [
      ['conseiller', 'humain', 'personne', 'quelqu un', 'agent', 'operateur', 'operatrice', 'vrai personne'],
      ['parler', 'discuter', 'contacter', 'joindre', 'assistance', 'support', 'aide'],
    ],
    groups: [['est ce possible', 'comment', 'peut on', 'ou', 'faire', 'possible']],
    answer:
      "Oui : pour toute demande hors FAQ, l'équipe DJASSACI prend le relais sur le WhatsApp professionnel " +
      WHATSAPP_BUSINESS_NUMBER +
      ". Indiquez votre numéro de téléphone, votre nom et l'objet de la demande (commande concernée, produit, certification...).",
  },
];

// ===== Normalisation =====

/**
 * Minuscules, suppression des accents, ponctuation remplacée par des espaces,
 * espaces multiples réduits à un seul.
 */
function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Découpe un texte normalisé en jetons. */
function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(' ');
}

/** Égalité tolérante au pluriel français (terminaison « s »). */
function sameToken(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const stemA = a.endsWith('s') ? a.slice(0, -1) : a;
  const stemB = b.endsWith('s') ? b.slice(0, -1) : b;
  return stemA === stemB;
}

/** Recherche une suite de mots (terme simple ou expression) dans les jetons. */
function containsTerm(tokens, termTokens) {
  if (termTokens.length === 0) return false;
  for (let i = 0; i + termTokens.length <= tokens.length; i++) {
    let matched = true;
    for (let j = 0; j < termTokens.length; j++) {
      if (!sameToken(tokens[i + j], termTokens[j])) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Un groupe de synonymes est satisfait si au moins un terme est présent. */
function groupMatches(tokens, group) {
  for (const term of group) {
    if (containsTerm(tokens, tokenize(term))) return true;
  }
  return false;
}

/**
 * Marqueurs de formulation : mots de question ou de demande classique.
 * Une question formulée (avec ou sans ponctuation) contient au moins un de ces
 * marqueurs. Ils ne suffisent jamais à déclencher une réponse : les exigences
 * (`requirements`) de l'entrée restent obligatoires.
 */
const GENERIC_MARKERS = [
  'comment', 'pourquoi', 'combien', 'quel', 'quelle', 'quels', 'quelles', 'qui', 'quoi',
  'ou', 'quand', 'ou est', 'ou sont', 'ou va', 'est ce que', 'est ce', 'c est quoi',
  'ca veut dire', 'signifie', 'que faire', 'que dois', 'comment faire', 'aide', 'aider',
  'je', 'j', 'je veux', 'je voudrais', 'je peux', 'je cherche', 'mon', 'ma', 'mes', 'moi',
  'ai', 'il faut', 'svp', 's il vous plait', 's il vous plaît', 'bonjour', 'salut', 'bjr',
  'peux', 'peut on', 'pourrais', 'savoir', 'dire', 'explique', 'expliquer', 'info',
  'y a t il', 'ya t il', 'y a', 'ya', 'dis moi', 'dites moi', 'affichez',
];

/**
 * Évalue une entrée contre un message déjà tokenisé.
 * Retourne null si les exigences ne sont pas satisfaites, sinon un score.
 */
function scoreEntry(tokens, entry) {
  const requirements = entry.requirements || [];
  for (const group of requirements) {
    if (!groupMatches(tokens, group)) return null;
  }
  let matchedGroups = 0;
  const groups = entry.groups || [];
  for (const group of groups) {
    if (groupMatches(tokens, group)) matchedGroups += 1;
  }
  const hasMarker = groupMatches(tokens, GENERIC_MARKERS);
  return { matchedGroups, totalGroups: groups.length, hasMarker };
}

/**
 * Recherche une réponse FAQ.
 *
 * @param {string} message
 * @param {{ loose?: boolean }} [options]
 *        loose = false (défaut) : correspondance stricte. Le message doit
 *        satisfaire les exigences de l'entrée ET ressembler à une question
 *        (marqueur de formulation ou groupe contextuel de l'entrée).
 *        loose = true : le concept suffit (exigences satisfaites), utilisé
 *        uniquement comme repli quand Gemini est indisponible.
 * @returns {{ reply: string, categorie: string, question: string }|null}
 */
function findFaqAnswer(message, options) {
  const loose = Boolean(options && options.loose);
  const tokens = tokenize(message);
  if (tokens.length === 0) return null;

  let best = null;
  for (const entry of MAWA_FAQ_ENTRIES) {
    const score = scoreEntry(tokens, entry);
    if (!score) continue;
    if (!loose && score.matchedGroups < 1 && !score.hasMarker) continue;
    if (!best || score.matchedGroups > best.score.matchedGroups) {
      best = { entry, score };
    }
  }

  if (!best) return null;
  return {
    reply: best.entry.answer,
    categorie: best.entry.categorie,
    question: best.entry.question,
  };
}

// ===== Message d'indisponibilité (aucune FAQ pertinente) =====
const MAWA_FAQ_UNAVAILABLE_MESSAGE =
  "Le service MAWA est temporairement indisponible. Merci de réessayer dans quelques instants ou de contacter l'équipe DJASSACI sur WhatsApp au " +
  WHATSAPP_BUSINESS_NUMBER +
  '.';

module.exports = {
  MAWA_FAQ_ENTRIES,
  MAWA_FAQ_UNAVAILABLE_MESSAGE,
  CERTIFICATION_PRICE_FCFA,
  CERTIFICATION_DURATION_DAYS,
  COMMISSION_RATE_PERCENT,
  WHATSAPP_BUSINESS_NUMBER,
  normalizeText,
  findFaqAnswer,
};
