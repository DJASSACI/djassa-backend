// Backend Server for Djassa CI - E-commerce Platform // Author: Djassa CI Team
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();
const { findFaqAnswer, MAWA_FAQ_UNAVAILABLE_MESSAGE } = require('./mawa_faq');

// ===== HASHAGE DE MOT DE PASSE (bcrypt avec migration SHA-256 / texte clair) =====
async function hashPassword(password) {
  return await bcryptjs.hash(password, 10);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;

  // Hash bcrypt existant ($2a$, $2b$, $2y$)
  if (
    storedHash.startsWith('$2a$') ||
    storedHash.startsWith('$2b$') ||
    storedHash.startsWith('$2y$')
  ) {
    return await bcryptjs.compare(password, storedHash);
  }

  // Fallback SHA-256 (comptes existants)
  const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
  if (storedHash === sha256Hash) return true;

  // Fallback texte clair (comptes très anciens)
  if (storedHash === password) return true;

  return false;
}

async function hashAndMigrate(password, users, userIndex) {
  const newHash = await bcryptjs.hash(password, 10);
  users[userIndex] = { ...users[userIndex], password: newHash };
  writeJSONFile(USERS_FILE, users);
  return newHash;
}

const GENIUSPAY_API_KEY = process.env.GENIUSPAY_API_KEY;
const GENIUSPAY_SECRET_KEY = process.env.GENIUSPAY_SECRET_KEY;
const fetch = require('node-fetch');

const chatRoutes = require('./routes/chatRoutes');

const admin = require('firebase-admin');
let firebaseAdminReady = false;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      ),
    });
    firebaseAdminReady = true;
    console.log('✅ Firebase Admin initialisé');
  } catch (e) {
    console.error('❌ Échec initialisation Firebase Admin:', e.message);
  }
} else {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT manquant, notifications FCM désactivées');
}

function isFirebaseAdminInitialized() {
  return firebaseAdminReady && admin.apps && admin.apps.length > 0;
}

// Normalise toutes les valeurs de data en chaînes (contrainte FCM).
function fcmData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

// Envoie une notification FCM à un jeton unique (non bloquant, ne révèle pas le jeton).
async function sendFcmToToken(fcmToken, { title, body, type, data = {} }) {
  if (!isFirebaseAdminInitialized()) {
    console.error('FCM non envoyé: Firebase Admin non initialisé');
    return false;
  }
  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim() === '') {
    console.error('FCM non envoyé: jeton manquant ou invalide');
    return false;
  }
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: { type, ...fcmData(data) },
    });
    return true;
  } catch (e) {
    console.error('Erreur envoi FCM (jeton):', e.message || e);
    return false;
  }
}

// Envoie une notification FCM à un topic (non bloquant).
async function sendFcmToTopic(topic, { title, body, type, data = {} }) {
  if (!isFirebaseAdminInitialized()) {
    console.error(`FCM topic ${topic} non envoyé: Firebase Admin non initialisé`);
    return false;
  }
  if (!topic || typeof topic !== 'string') {
    console.error('FCM topic non envoyé: topic manquant');
    return false;
  }
  try {
    await admin.messaging().send({
      topic,
      notification: { title, body },
      data: { type, ...fcmData(data) },
    });
    return true;
  } catch (e) {
    console.error(`Erreur envoi FCM (topic ${topic}):`, e.message || e);
    return false;
  }
}

// Envoie une notification à plusieurs utilisateurs dédupliqués par jeton (non bloquant par destinataire).
// users: tableau d'objets { id, fcmToken }. Ignore les doublons de jeton et les utilisateurs sans jeton valide.
async function sendFcmToUsers(users, { title, body, type, data = {} }) {
  if (!isFirebaseAdminInitialized()) {
    console.error('FCM users non envoyé: Firebase Admin non initialisé');
    return { sent: 0, skipped: 0, errors: 0 };
  }
  if (!Array.isArray(users) || users.length === 0) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const seenTokens = new Set();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const u of users) {
    if (!u || !u.fcmToken || typeof u.fcmToken !== 'string') {
      skipped++;
      continue;
    }
    const token = u.fcmToken.trim();
    if (token === '' || seenTokens.has(token)) {
      skipped++;
      continue;
    }
    seenTokens.add(token);
    try {
      const ok = await sendFcmToToken(token, { title, body, type, data });
      if (ok) sent++; else errors++;
    } catch (e) {
      console.error(`Erreur envoi FCM utilisateur ${u.id}:`, e.message || e);
      errors++;
    }
  }

  console.log(`FCM users: sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}

// (Notifications team/savings, additif) Résout les destinataires par id utilisateur.
// Effet secondaire best-effort: ne jamais bloquer le traitement métier.
function resolveFcmUsersByIds(userIds, usersArray) {
  try {
    const ids = Array.isArray(userIds) ? Array.from(new Set(userIds.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n) && n > 0))) : [];
    const all = Array.isArray(usersArray) ? usersArray : readJSONFile(USERS_FILE);
    const arr = Array.isArray(all) ? all : [];
    return ids.map((id) => arr.find((u) => u && parseInt(u.id, 10) === id)).filter(Boolean);
  } catch (e) {
    console.error('resolveFcmUsersByIds error:', e && e.message ? e.message : e);
    return [];
  }
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// F6-D: auth JWT spécifique chat équipe (sans bloquer les connexions historiques/payment_update)
function getSocketTeamAuthUser(socket) {
  try {
    const rawAuth = socket && socket.handshake && socket.handshake.auth ? socket.handshake.auth.token : null;
    const header = socket && socket.handshake && socket.handshake.headers ? socket.handshake.headers.authorization : null;
    const headerToken = (typeof header === 'string' && header.startsWith('Bearer ')) ? header.slice(7).trim() : null;
    const token = (typeof rawAuth === 'string' && rawAuth.trim()) ? rawAuth.trim() : headerToken;
    if (!token) return { ok: false, error: 'unauthorized' };
    let user;
    try { user = jwt.verify(token, JWT_SECRET); } catch (_) { return { ok: false, error: 'unauthorized' }; }
    if (!user || !user.id) return { ok: false, error: 'unauthorized' };
    // Suspension (même logique qu'authenticateToken)
    const users = readJSONFile(USERS_FILE);
    const dbUser = Array.isArray(users) ? users.find((u) => Number(u.id) === Number(user.id)) : null;
    if (dbUser && dbUser.suspended === true) return { ok: false, error: 'forbidden' };
    return { ok: true, user: { id: Number(user.id), role: user.role || null } };
  } catch (_) { return { ok: false, error: 'unauthorized' }; }
}

function normalizeTeamSocketId(teamIdInput) {
  const raw = String(teamIdInput ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return parseInt(raw, 10);
}

function teamSocketReply(socket, event, payload) {
  try { socket.emit(event, payload); } catch (_) {}
}

io.on('connection', (socket) => {
  console.log('Client connecte Socket.IO :', socket.id);
  // Connexion acceptée pour compat (payment_update / clients historiques). Auth exigée par opération team chat.

  socket.on('join_team', (payload) => {
    const auth = getSocketTeamAuthUser(socket);
    if (!auth.ok) return teamSocketReply(socket, 'team_join_error', { ok: false, error: auth.error, message: 'Authentification requise' });
    const teamId = normalizeTeamSocketId(payload && payload.teamId);
    if (!teamId) return teamSocketReply(socket, 'team_join_error', { ok: false, error: 'invalid_team_id', message: 'Identifiant équipe invalide' });
    const team = findTeamById(teamId);
    if (!team) return teamSocketReply(socket, 'team_join_error', { ok: false, error: 'not_found', message: 'Équipe introuvable' });
    // Jamais de userId client: identité = token vérifié. Membership réelle obligatoire.
    if (!isTeamMember(team, auth.user.id)) return teamSocketReply(socket, 'team_join_error', { ok: false, error: 'forbidden', message: 'Accès refusé' });
    try { socket.join('team:' + teamId); } catch (_) {
      return teamSocketReply(socket, 'team_join_error', { ok: false, error: 'join_failed', message: 'Impossible de rejoindre le chat' });
    }
    return teamSocketReply(socket, 'team_joined', { ok: true, teamId });
  });

  socket.on('leave_team', (payload) => {
    const auth = getSocketTeamAuthUser(socket);
    if (!auth.ok) return teamSocketReply(socket, 'team_leave_error', { ok: false, error: auth.error, message: 'Authentification requise' });
    const teamId = normalizeTeamSocketId(payload && payload.teamId);
    if (!teamId) return teamSocketReply(socket, 'team_leave_error', { ok: false, error: 'invalid_team_id', message: 'Identifiant équipe invalide' });
    // Quitte uniquement la room demandée (pas leaveAll / autres rooms).
    try { socket.leave('team:' + teamId); } catch (_) {
      return teamSocketReply(socket, 'team_leave_error', { ok: false, error: 'leave_failed', message: 'Impossible de quitter le chat' });
    }
    return teamSocketReply(socket, 'team_left', { ok: true, teamId });
  });

  socket.on('disconnect', () => {
    console.log('Client deconnecte :', socket.id);
  });
});

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("La variable d'environnement JWT_SECRET est obligatoire.");
}
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer for uploads images
const multer = require('multer');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  },
});

// (Upload multer non utilisé dans ce serveur actuellement)
// const upload = multer({
//   storage,
//   limits: { fileSize: 5 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith('image/')) {
//       cb(null, true);
//     } else {
//       cb(new Error('Seule les images sont autorisées'));
//     }
//   },
// });


// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.send('Djassa CI Backend OK 🚀');
});

// File paths for JSON storage (Render Persistent Disk)
// Render Persistent Disk is mounted at /data (persistent across deployments).
// Fallback to local __dirname for development.
const DATA_DIR = process.env.DATA_DIR || '/data';

const JSON_STORAGE_DIR = (() => {
  try {
    if (fs.existsSync(DATA_DIR) && fs.statSync(DATA_DIR).isDirectory()) {
      return DATA_DIR;
    }
  } catch (e) {
    // ignore
  }
  return __dirname;
})();

const USERS_FILE = path.join(JSON_STORAGE_DIR, 'users.json');
const PRODUCTS_FILE = path.join(JSON_STORAGE_DIR, 'products.json');
const ORDERS_FILE = path.join(JSON_STORAGE_DIR, 'orders.json');
const ARTICLES_FILE = path.join(JSON_STORAGE_DIR, 'articles.json');
const SUBSCRIPTIONS_FILE = path.join(JSON_STORAGE_DIR, 'subscriptions.json');
const CERTIFICATION_INFO_FILE = path.join(JSON_STORAGE_DIR, 'certification_info.json');
const WEBHOOK_EVENTS_FILE = path.join(JSON_STORAGE_DIR, 'webhook_events.json');
const ADMIN_AUDIT_LOG_FILE = path.join(JSON_STORAGE_DIR, 'admin_audit_log.json');
const PROMOTIONS_FILE = path.join(JSON_STORAGE_DIR, 'promotions.json');
const TEAM_PURCHASES_FILE = path.join(JSON_STORAGE_DIR, 'team_purchases.json');
const TEAM_PAYMENTS_FILE = path.join(JSON_STORAGE_DIR, 'team_payments.json');
const TEAM_MESSAGES_FILE = path.join(JSON_STORAGE_DIR, 'team_messages.json');
const PROMOTION_SAVINGS_FILE = path.join(JSON_STORAGE_DIR, 'promotion_savings.json');
const PROMOTION_SAVINGS_PAYMENTS_FILE = path.join(JSON_STORAGE_DIR, 'promotion_savings_payments.json');
const PASSWORD_RESULTS_FILE = path.join(JSON_STORAGE_DIR, 'password_resets.json');

const ensureJSONFilesDir = () => {
  try {
    if (JSON_STORAGE_DIR !== __dirname) {
      fs.mkdirSync(JSON_STORAGE_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('Error ensuring JSON storage dir:', e);
  }
};


const readJSONFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

let writeQueue = Promise.resolve();
const writeJSONFile = (filePath, data) => {
  writeQueue = writeQueue.then(() => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error(`Error writing ${filePath}:`, error);
      return false;
    }
  });
  return writeQueue;
};

const initializeData = () => {
  ensureJSONFilesDir();
  if (!fs.existsSync(PRODUCTS_FILE)) {
    const defaultProducts = [
      {
        id: 1,
        name: 'Téléphone portable',
        price: 50000,
        image:
          'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description:
          'Smartphone dernière génération avec caméra haute résolution',
        categorie: 'Téléphones',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 2,
        name: 'Ordinateur portable',
        price: 300000,
        image:
          'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description:
          'Ordinateur portable performant pour le travail et les jeux',
        categorie: 'Ordinateurs',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 3,
        name: 'Casque audio',
        price: 15000,
        image:
          'https://images.unsplash.com/photo-1484704849700-f032a568e944?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Casque sans fil avec réduction de bruit active',
        categorie: 'Audio',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 4,
        name: 'Chargeur USB',
        price: 5000,
        image:
          'https://images.unsplash.com/photo-1586953208448-b95a79798f07?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Chargeur rapide compatible avec tous les appareils',
        categorie: 'Accessoires',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 5,
        name: 'Tablette',
        price: 80000,
        image:
          'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Tablette tactile légère et puissante',
        categorie: 'Tablettes',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 6,
        name: 'Smartwatch',
        price: 25000,
        image:
          'https://images.unsplash.com/photo-1523275335684-37898b6baf30?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Montre connectée avec suivi de santé',
        categorie: 'Montres',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 7,
        name: 'Télévision LED',
        price: 150000,
        image:
          'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Télévision LED 4K avec Smart TV',
        categorie: 'TV',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
      {
        id: 8,
        name: 'Mixeur électrique',
        price: 20000,
        image:
          'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80',
        description: 'Mixeur puissant avec plusieurs vitesses',
        categorie: 'Électroménager',
        vendeur: 'Admin',
        vendeurCompte: '',
        vendeurLocalisation: 'Abidjan',
        datePublication: new Date().toISOString(),
        isActive: true,
      },
    ];
    writeJSONFile(PRODUCTS_FILE, defaultProducts);
  }

  if (!fs.existsSync(USERS_FILE)) {
    writeJSONFile(USERS_FILE, []);
  }
  if (!fs.existsSync(ORDERS_FILE)) {
    writeJSONFile(ORDERS_FILE, []);
  }
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
    writeJSONFile(SUBSCRIPTIONS_FILE, []);
  }
  if (!fs.existsSync(CERTIFICATION_INFO_FILE)) {
    writeJSONFile(CERTIFICATION_INFO_FILE, []);
  }
  if (!fs.existsSync(PROMOTIONS_FILE)) {
    writeJSONFile(PROMOTIONS_FILE, []);
  }
  if (!fs.existsSync(PASSWORD_RESULTS_FILE)) {
    writeJSONFile(PASSWORD_RESULTS_FILE, []);
  }
  if (!fs.existsSync(TEAM_PURCHASES_FILE)) {
    writeJSONFile(TEAM_PURCHASES_FILE, []);
  }
  if (!fs.existsSync(TEAM_PAYMENTS_FILE)) {
    writeJSONFile(TEAM_PAYMENTS_FILE, []);
  }
  if (!fs.existsSync(TEAM_MESSAGES_FILE)) {
    writeJSONFile(TEAM_MESSAGES_FILE, []);
  }
  if (!fs.existsSync(PROMOTION_SAVINGS_FILE)) {
    writeJSONFile(PROMOTION_SAVINGS_FILE, []);
  }
  if (!fs.existsSync(PROMOTION_SAVINGS_PAYMENTS_FILE)) {
    writeJSONFile(PROMOTION_SAVINGS_PAYMENTS_FILE, []);
  }
  // Dédup webhooks GeniusPay (persistant) : init idempotente, ne jamais écraser un fichier existant.
  if (!fs.existsSync(WEBHOOK_EVENTS_FILE)) {
    try { fs.writeFileSync(WEBHOOK_EVENTS_FILE, JSON.stringify([], null, 2), 'utf8'); } catch (e) { console.error('Init WEBHOOK_EVENTS_FILE error:', e && e.message ? e.message : e); }
  }
};

initializeData();

// AUTH middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    // Vérifier l'état actuel du compte (suspension)
    const users = readJSONFile(USERS_FILE);
    const dbUser = users.find((u) => u.id === user.id);
    if (dbUser && dbUser.suspended === true) {
      return res.status(403).json({ error: 'Compte suspendu' });
    }
    req.user = user;
    next();
  });
};

// Middleware centralisé de contrôle d'accès administrateur.
// Réutilise req.user défini par authenticateToken. Ne modifie pas le JWT.
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    logAdminEvent(req.user && req.user.id, 'admin.access_denied', 'route', req.path, 'denied', req.requestId);
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Journal administratif
function readAuditLog() {
  try {
    const data = fs.readFileSync(ADMIN_AUDIT_LOG_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed && Array.isArray(parsed.events)) {
      auditLogCorrupted = false;
      return parsed;
    }
    auditLogCorrupted = true;
    console.error('Audit log corrupted: invalid structure');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      auditLogCorrupted = false;
      return { version: 1, events: [] };
    }
    auditLogCorrupted = true;
    console.error('Audit log read error:', e && e.message ? e.message : e);
  }
  return { version: 1, events: [] };
}

function pruneAuditLog(events) {
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  return events.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return !Number.isNaN(ts) && ts >= cutoff;
  });
}

function writeAuditLog(events) {
  if (auditLogCorrupted) {
    console.error('Audit log write blocked: file corrupted');
    return;
  }
  const pruned = pruneAuditLog(events);
  const tmp = ADMIN_AUDIT_LOG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, events: pruned }, null, 2), 'utf8');
  fs.renameSync(tmp, ADMIN_AUDIT_LOG_FILE);
}

function logAdminEvent(actorId, action, targetType, targetId, result, requestId) {
  if (auditLogCorrupted) {
    console.error('Audit log event skipped: file corrupted');
    return;
  }
  try {
    // sérialisation simple en mémoire
    const run = () => {
      const log = readAuditLog();
      const event = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        timestamp: new Date().toISOString(),
        actorId: actorId || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        result,
        requestId: requestId || null,
      };
      log.events.push(event);
      writeAuditLog(log.events);
    };
    if (auditLogLock.busy) {
      // attendre brièvement
      setTimeout(run, 10);
    } else {
      auditLogLock.busy = true;
      try { run(); } finally { auditLogLock.busy = false; }
    }
  } catch (e) {
    console.error('Audit log write error:', e && e.message ? e.message : e);
  }
}

// requestId middleware (léger)
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || null;
  next();
});
const mawaRateLimits = new Map();
const loginAttempts = new Map();
const processingKeys = new Set();
const auditLogLock = { busy: false };
let auditLogCorrupted = false;
// Demandes de notification MAWA en attente (en mémoire; perdues au redémarrage).
const mawaNotificationRequests = new Map();
const MAWA_NOTIF_TTL_MS = 10 * 60 * 1000;
const MAWA_NOTIF_MAX_ATTEMPTS = 3;

function cleanupMawaNotificationRequests() {
  const now = Date.now();
  for (const [id, req] of mawaNotificationRequests.entries()) {
    if (!req || now - req.createdAt > MAWA_NOTIF_TTL_MS || (req.attempts || 0) >= MAWA_NOTIF_MAX_ATTEMPTS) {
      mawaNotificationRequests.delete(id);
    }
  }
}

// Envoie la notification FCM « MAWA a une réponse » si une demande en attente correspond.
async function notifyPendingMawaReply(userId, requestId) {
  cleanupMawaNotificationRequests();
  if (!requestId) return;
  const pending = mawaNotificationRequests.get(requestId);
  if (!pending || String(pending.userId) !== userId || pending.processed) return;
  if (Date.now() - pending.createdAt > MAWA_NOTIF_TTL_MS) return;

  const users = readJSONFile(USERS_FILE);
  const user = users.find((u) => String(u.id) === userId);
  const token = user && user.fcmToken;
  if (!token || typeof token !== 'string' || token.trim() === '') {
    mawaNotificationRequests.delete(requestId);
    return;
  }

  pending.attempts = (pending.attempts || 0) + 1;
  try {
    const ok = await sendFcmToToken(token.trim(), {
      title: 'MAWA a une réponse pour vous',
      body: '🤖 MAWA a une réponse pour vous.',
      type: 'mawa_reply',
      data: { requestId },
    });
    if (ok) {
      pending.processed = true;
      mawaNotificationRequests.delete(requestId);
    } else if (pending.attempts >= MAWA_NOTIF_MAX_ATTEMPTS) {
      mawaNotificationRequests.delete(requestId);
    }
  } catch (e) {
    if (pending.attempts >= MAWA_NOTIF_MAX_ATTEMPTS) mawaNotificationRequests.delete(requestId);
  }
}
// Masque la clé API Gemini dans les journaux (node-fetch inclut l'URL complète
// dans ses messages d'erreur, et certains corps d'erreur Gemini recopient la clé).
function sanitizeMawaLog(text) {
  if (!text) return '';
  return String(text).replace(/([?&]key=)[^&\s"']+/gi, '$1***');
}

// ===== MAWA assistant endpoint =====
app.post('/api/mawa/chat', authenticateToken, async (req, res) => {
  // Déclarés au niveau du handler : le bloc catch doit pouvoir les utiliser.
  const message = (req.body && typeof req.body.message === 'string') ? req.body.message.trim() : '';
  const requestId = (req.body && typeof req.body.requestId === 'string') ? req.body.requestId.trim() : '';

  // Repli quand Gemini est indisponible (clé absente, erreur HTTP, panne réseau,
  // délai dépassé) : correspondance FAQ élargie si elle est pertinente, sinon
  // message d'indisponibilité clair. Format conservé : { reply: "..." }.
  const sendUnavailableOrFaq = () => {
    if (res.headersSent) return;
    const softHit = findFaqAnswer(message, { loose: true });
    return res.json({ reply: softHit ? softHit.reply : MAWA_FAQ_UNAVAILABLE_MESSAGE });
  };

  try {
    if (!message) return res.status(400).json({ error: 'Message requis' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message trop long (max 2000 caracteres)' });

    const userId = String(req.user.id);
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReq = 10;
    const entry = mawaRateLimits.get(userId) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count += 1;
    mawaRateLimits.set(userId, entry);
    if (entry.count > maxReq) return res.status(429).json({ error: 'Trop de requetes, reessayez plus tard' });

    // FAQ MAWA : les questions fréquentes reçoivent une réponse prédéfinie
    // sans appeler Gemini. Le format de réponse reste { reply: "..." }.
    const faqHit = findFaqAnswer(message);
    if (faqHit) {
      await notifyPendingMawaReply(userId, requestId);
      if (res.headersSent) return;
      return res.json({ reply: faqHit.reply });
    }

    // NOTE : sendUnavailableOrFaq est désormais défini au niveau du handler
    // (ligne ci-dessus) afin d'être accessible aussi bien depuis le bloc try
    // que depuis le bloc catch. Son comportement est inchangé.

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return sendUnavailableOrFaq();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const systemPrompt = "Tu es MAWA, l'assistant officiel de DJASSACI. Reponds en francais simple. Tu ne reponds qu'aux questions concernant DJASSACI : produits, categories, vendeurs, boutiques, certification, commandes, paiements GeniusPay, comptes, connexion et utilisation de l'application. Pour toute question hors sujet, reponds poliment que MAWA est specialisee dans DJASSACI. Ne jamais inventer de donnees, de prix, de statuts de commande ou d'informations privees. Oriente vers le support humain si necessaire.";

    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: message }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
        }),
        signal: controller.signal,
      });
    } finally {
      // Le délai est annulé même si fetch échoue (panne réseau ou abandon).
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini error:', response.status, sanitizeMawaLog(errText));
      return sendUnavailableOrFaq();
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Desole, je n'ai pas pu repondre.";

    // Notification MAWA si une demande en attente correspond
    await notifyPendingMawaReply(userId, requestId);
    if (res.headersSent) return;
    return res.json({ reply });
  } catch (error) {
    // Panne réseau, délai dépassé (AbortError) ou erreur inattendue :
    // on renvoie le repli FAQ / indisponibilité, sans renvoyer une 2e réponse.
    const isTimeout = Boolean(error && (error.name === 'AbortError' || error.type === 'aborted'));
    console.error(
      'MAWA error:',
      isTimeout
        ? 'delai depasse (30s)'
        : sanitizeMawaLog(error && error.message ? error.message : error)
    );
    return sendUnavailableOrFaq();
  }
});

// ===== MAWA notification request =====
app.post('/api/mawa/notification-request', authenticateToken, (req, res) => {
  try {
    cleanupMawaNotificationRequests();
    const userId = String(req.user.id);
    const requestId = (req.body && typeof req.body.requestId === 'string' && req.body.requestId.trim() !== '')
      ? req.body.requestId.trim()
      : crypto.randomUUID();

    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => String(u.id) === userId);
    const token = user && user.fcmToken;
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'FCM token manquant' });
    }

    if (!mawaNotificationRequests.has(requestId)) {
      mawaNotificationRequests.set(requestId, { userId, createdAt: Date.now(), attempts: 0, processed: false });
    }
    return res.json({ requestId });
  } catch (error) {
    console.error('MAWA notification request error:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// AUTH ROUTES
app.post('/api/auth/register', async (req, res) => {
  try {
    const { nom, prenom, numero, address, password } = req.body;

    if (!nom || !prenom || !numero || !address || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 6 characters' });
    }

    const users = readJSONFile(USERS_FILE);
    const existingUser = users.find((u) => u.numero === numero);
    if (existingUser) {
      return res.status(400).json({
        error: 'Ce numéro de téléphone est déjà associé à un compte DJASSACI. Connectez-vous à votre compte ou utilisez un autre numéro.',
      });
    }

    const hashedPassword = await hashPassword(password);

    const newUser = {
      id: Date.now(),
      nom,
      prenom,
      numero,
      address,
      password: hashedPassword,
      role: 'user',
      dateInscription: new Date().toISOString(),
    };

    users.push(newUser);
    writeJSONFile(USERS_FILE, users);

    const token = jwt.sign(
      { id: newUser.id, numero: newUser.numero, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { numero, password } = req.body;

    // Limitation des tentatives de connexion (en mémoire, par IP)
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxAttempts = 5;
    const entry = loginAttempts.get(clientIp) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    if (entry.count >= maxAttempts) {
      const retryAfter = Math.ceil((entry.reset - now) / 1000);
      return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard', retryAfter });
    }

    if (!numero || !password) {
      return res.status(400).json({
        error: 'Phone number and password are required',
      });
    }

    const users = readJSONFile(USERS_FILE);
    const user = users.find(
      (u) => u.numero === numero || u.numero.toLowerCase() === numero.toLowerCase()
    );

    if (!user) {
      const e = loginAttempts.get(clientIp) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
      e.count += 1;
      loginAttempts.set(clientIp, e);
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    const passwordValid = await verifyPassword(password, user.password);

    if (!passwordValid) {
      const e = loginAttempts.get(clientIp) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
      e.count += 1;
      loginAttempts.set(clientIp, e);
      return res.status(401).json({ message: 'Mot de passe incorrect' });
    }

    // Réinitialise le compteur après authentification réussie
    loginAttempts.delete(clientIp);

    // Migration vers bcrypt si le hash stocké n'est pas déjà bcrypt
    if (
      user.password &&
      !user.password.startsWith('$2a$') &&
      !user.password.startsWith('$2b$') &&
      !user.password.startsWith('$2y$')
    ) {
      const userIndex = users.findIndex((u) => u.id === user.id);
      user.password = await hashAndMigrate(password, users, userIndex);
    }

    const token = jwt.sign(
      { id: user.id, numero: user.numero, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      token,
      user: {
        ...userWithoutPassword,
        mustChangePassword: user.mustChangePassword === true,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/refresh', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = jwt.sign(
      { id: user.id, numero: user.numero, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Token refreshed successfully', token });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
});

// ===== CHANGEMENT DE MOT DE PASSE (profil) =====
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = users[userIndex];
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Les deux nouveaux mots de passe ne correspondent pas. Vérifiez votre saisie et réessayez.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    const oldPasswordValid = await verifyPassword(oldPassword, user.password);

    if (!oldPasswordValid) {
      return res.status(401).json({ error: 'Votre ancien mot de passe est incorrect. Vérifiez votre saisie et réessayez.' });
    }

    const hashedNewPassword = await hashPassword(newPassword);

    users[userIndex] = {
      ...users[userIndex],
      password: hashedNewPassword,
      mustChangePassword: false,
    };

    writeJSONFile(USERS_FILE, users);

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({
      message: 'Votre mot de passe a été modifié avec succès.',
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error during password change' });
  }
});

// ===== MOT DE PASSE OUBLIÉ =====
// Demande de réinitialisation (statut pending, aucun mot de passe stocké).
app.post('/api/auth/forgot-password/request', (req, res) => {
  try {
    const { numero } = req.body;

    if (!numero || String(numero).trim() === '') {
      return res.status(400).json({ error: 'Le numéro de téléphone est requis' });
    }

    const users = readJSONFile(USERS_FILE);
    const user = users.find(
      (u) => u.numero === numero || u.numero.toLowerCase() === numero.toLowerCase()
    );

    if (!user) {
      return res.status(400).json({
        error: 'Aucun compte DJASSACI n\'est associé à ce numéro de téléphone. Vérifiez votre numéro et réessayez.',
      });
    }

    const resets = readJSONFile(PASSWORD_RESULTS_FILE);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 heure

    resets.push({
      id: Date.now(),
      numero: user.numero,
      userId: user.id,
      token,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    writeJSONFile(PASSWORD_RESULTS_FILE, resets);

    res.json({
      message: 'Demande de réinitialisation créée. Une vérification est requise via WhatsApp.',
    });
  } catch (error) {
    console.error('Forgot password request error:', error);
    res.status(500).json({ error: 'Server error during password reset request' });
  }
});

// Validation manuelle par l'administrateur après vérification WhatsApp.
app.post('/api/auth/forgot-password/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { numero, tempPassword } = req.body;

    if (!numero || !tempPassword || tempPassword.length < 6) {
      return res.status(400).json({
        error: 'Numéro et mot de passe temporaire (6 caractères minimum) requis',
      });
    }

    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex(
      (u) => u.numero === numero || u.numero.toLowerCase() === numero.toLowerCase()
    );
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const resets = readJSONFile(PASSWORD_RESULTS_FILE);
    const resetIndex = resets.findIndex(
      (r) =>
        String(r.userId) === String(users[userIndex].id) &&
        r.status === 'pending' &&
        new Date(r.expiresAt).getTime() > Date.now()
    );
    if (resetIndex === -1) {
      return res.status(400).json({ error: 'Aucune demande de réinitialisation en attente' });
    }

    const hashedTempPassword = await hashPassword(tempPassword);

    users[userIndex] = {
      ...users[userIndex],
      password: hashedTempPassword,
      mustChangePassword: true,
    };

    resets[resetIndex] = {
      ...resets[resetIndex],
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id,
    };

    writeJSONFile(USERS_FILE, users);
    writeJSONFile(PASSWORD_RESULTS_FILE, resets);

    res.json({
      message: 'Demande validée. Mot de passe temporaire défini.',
    });
  } catch (error) {
    console.error('Forgot password approve error:', error);
    res.status(500).json({ error: 'Server error during password reset approval' });
  }
});

// Réinitialisation du mot de passe après connexion avec le mot de passe temporaire.
app.post('/api/auth/forgot-password/reset', authenticateToken, async (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = users[userIndex];

    if (user.mustChangePassword !== true) {
      return res.status(400).json({ error: 'Aucune réinitialisation de mot de passe requise' });
    }

    const { tempPassword, newPassword, confirmPassword } = req.body;

    if (!tempPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Les mots de passe ne correspondent pas' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    const tempPasswordValid = await verifyPassword(tempPassword, user.password);

    if (!tempPasswordValid) {
      return res.status(401).json({ error: 'Mot de passe temporaire incorrect' });
    }

    const hashedNewPassword = await hashPassword(newPassword);

    users[userIndex] = {
      ...users[userIndex],
      password: hashedNewPassword,
      mustChangePassword: false,
    };

    writeJSONFile(USERS_FILE, users);

    res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (error) {
    console.error('Forgot password reset error:', error);
    res.status(500).json({ error: 'Server error during password reset' });
  }
});

// ===== FIN MOT DE PASSE OUBLIÉ =====

// PRODUCTS
app.get('/api/products', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const activeProducts = products.filter((p) => p.isActive !== false);

    const users = readJSONFile(USERS_FILE);
    const enhanced = activeProducts.map((p) => {
      const vendeurId = p.vendeur;
      const vendeurUser = users.find((u) => u.id == vendeurId);

      // Forcer la valeur persistée `sellerVerified` à être cohérente avec `sellerVerifiedUntil`
      // (sinon le frontend peut voir temporairement false après verify-seller).
      if (vendeurUser) {
        refreshSellerVerifiedStatus(vendeurUser);
      }

      return {
        ...p,
        // côté Flutter on attend `product.vendeur` comme un objet
        vendeur: {
          ...(typeof p.vendeur === 'object' && p.vendeur != null ? p.vendeur : {}),
          id: vendeurUser?.id,
          nom: vendeurUser?.nom,
          prenom: vendeurUser?.prenom,
          numero: vendeurUser?.numero,
          address: vendeurUser?.address,
          sellerVerified: vendeurUser?.sellerVerified === true,
          sellerVerifiedAt: vendeurUser?.sellerVerifiedAt ?? null,
          // Alias pour compatibilité (certains écrans lisent seller_verified)
          seller_verified: vendeurUser?.sellerVerified === true,
        },
      };
    });

    res.json(enhanced);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products/:id', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const product = products.find((p) => p.id === parseInt(req.params.id));
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products/category/:category', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const categoryProducts = products.filter(
      (p) =>
        p.categorie.toLowerCase() === req.params.category.toLowerCase() &&
        p.isActive !== false
    );
    res.json(categoryProducts);
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products/search/:query', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const query = req.params.query.toLowerCase();
    const searchResults = products.filter(
      (p) =>
        p.isActive !== false &&
        (p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.categorie.toLowerCase().includes(query))
    );
    res.json(searchResults);
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PROMOTIONS ENDPOINTS
app.get('/api/promotions', (req, res) => {
  try {
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const activePromotions = promotions.filter((p) => p.isActive !== false);
    res.json(activePromotions);
  } catch (error) {
    console.error('Get promotions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/promotions/:id', (req, res) => {
  try {
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotion = promotions.find((p) => p.id === parseInt(req.params.id));
    if (!promotion) {
      return res.status(404).json({ error: 'Promotion not found' });
    }
    res.json(promotion);
  } catch (error) {
    console.error('Get promotion error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/promotions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      categorie,
      discountPercent,
      image,
      images,
    } = req.body;

    const imageUrl = image || 'https://via.placeholder.com/400x400?text=Promotion';
    const imagesList = Array.isArray(images) ? images : [];

    if (!name || !price || !description || !categorie || discountPercent === undefined) {
      return res.status(400).json({
        error: 'Name, price, description, category, and discountPercent are required',
      });
    }

    const discount = parseInt(discountPercent);
    if (isNaN(discount) || discount < 1 || discount > 100) {
      return res.status(400).json({ error: 'discountPercent must be between 1 and 100' });
    }

    const promotions = readJSONFile(PROMOTIONS_FILE);

    const newPromotion = {
      id: Date.now(),
      name,
      price: parseFloat(price),
      description,
      categorie,
      discountPercent: discount,
      discountedPrice: parseFloat(price) * (1 - discount / 100),
      image: imageUrl,
      images: imagesList,
      datePublication: new Date().toISOString(),
      isActive: true,
    };

    promotions.push(newPromotion);
    writeJSONFile(PROMOTIONS_FILE, promotions);

    // Notification promotionnelle au topic global (après enregistrement effectif).
    sendFcmToTopic('djassaci_all', {
      title: 'Nouvelle promotion',
      body: name,
      type: 'promotion',
      data: {
        promotionId: String(newPromotion.id),
        promotionName: name,
      },
    }).catch(() => {}); // non bloquant

    res.status(201).json({ message: 'Promotion created successfully', promotion: newPromotion });
  } catch (error) {
    console.error('Create promotion error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/promotions/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotionIndex = promotions.findIndex((p) => p.id === parseInt(req.params.id));
    if (promotionIndex === -1) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    const promotion = promotions[promotionIndex];

    const {
      name,
      price,
      image,
      images,
      description,
      categorie,
      discountPercent,
      isActive,
    } = req.body;

    const imagesList = Array.isArray(images)
      ? images
      : (promotion.images || []);

    const updateData = {
      ...promotion,
      name: name || promotion.name,
      price: price ? parseFloat(price) : promotion.price,
      image: image || promotion.image,
      images: imagesList,
      description: description || promotion.description,
      categorie: categorie || promotion.categorie,
      isActive: isActive !== undefined ? isActive : promotion.isActive,
    };

    if (discountPercent !== undefined) {
      const discount = parseInt(discountPercent);
      if (isNaN(discount) || discount < 1 || discount > 100) {
        return res.status(400).json({ error: 'discountPercent must be between 1 and 100' });
      }
      updateData.discountPercent = discount;
      updateData.discountedPrice = updateData.price * (1 - discount / 100);
    }

    promotions[promotionIndex] = updateData;
    writeJSONFile(PROMOTIONS_FILE, promotions);

    res.json({ message: 'Promotion updated successfully', promotion: updateData });
  } catch (error) {
    console.error('Update promotion error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/promotions/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotionIndex = promotions.findIndex((p) => p.id === parseInt(req.params.id));
    if (promotionIndex === -1) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    promotions.splice(promotionIndex, 1);
    writeJSONFile(PROMOTIONS_FILE, promotions);

    res.json({ message: 'Promotion deleted successfully' });
  } catch (error) {
    console.error('Delete promotion error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/products', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      price,
      description,
      categorie,
      vendeurCompte,
      vendeurLocalisation,
      paymentMethod,
      paymentAccount,
      image,
      images,
      videoUrl,
    } = req.body;

    const imageUrl = image || 'https://via.placeholder.com/400x400?text=Product';
    const imagesList = Array.isArray(images) ? images : [];

    if (!name || !price || !description || !categorie) {
      return res.status(400).json({
        error: 'Name, price, description, and category are required',
      });
    }

    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const products = readJSONFile(PRODUCTS_FILE);

    const newProduct = {
      id: Date.now(),
      name,
      price: parseFloat(price),
      image: imageUrl,
      images: imagesList,
      description,
      categorie,
      vendeur: req.user.id,
      vendeurNom: `${user.prenom} ${user.nom}`,
      vendeurCompte: vendeurCompte || '',
      vendeurLocalisation: vendeurLocalisation || user.address,
      datePublication: new Date().toISOString(),
      isActive: true,
      videoUrl: videoUrl || null,
    };

    products.push(newProduct);
    writeJSONFile(PRODUCTS_FILE, products);

    // Notifier les abonnés du vendeur (nouveau produit), excluant le vendeur lui-même.
    const sellerId = String(req.user.id);
    const sellerShopName = user.boutiqueNom || `${user.prenom} ${user.nom}` || 'Boutique';
    try {
      const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
      const followerEntries = subscriptions.filter(
        (s) => s && String(s.followingId) === sellerId
      );
      // Dédupliquer les followerId (un même utilisateur ne suit qu'une fois, mais on sécurise).
      const uniqueFollowerIds = [...new Set(followerEntries.map((s) => String(s.followerId)))];
      const followerUsers = users.filter(
        (u) => u && uniqueFollowerIds.includes(String(u.id)) && String(u.id) !== sellerId
      );

      if (followerUsers.length > 0) {
        sendFcmToUsers(followerUsers, {
          title: `Nouvelle publication de ${sellerShopName}`,
          body: `${name} vient d'être publié.`,
          type: 'followed_seller_product',
          data: {
            productId: String(newProduct.id),
            sellerId: sellerId,
          },
        }).catch(() => {}); // non bloquant
      }
    } catch (e) {
      console.error('Erreur notification abonnés nouveau produit:', e.message || e);
    }

    res.status(201).json({ message: 'Product created successfully', product: newProduct });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/products/:id', authenticateToken, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const productIndex = products.findIndex((p) => p.id === parseInt(req.params.id));
    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[productIndex];

    if (product.vendeur !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only update your own products' });
    }

    const {
      name,
      price,
      image,
      images,
      description,
      categorie,
      vendeurCompte,
      vendeurLocalisation,
      isActive,
    } = req.body;

    const imagesList = Array.isArray(images) ? images : (product.images || []);

    products[productIndex] = {
      ...product,
      name: name || product.name,
      price: price ? parseFloat(price) : product.price,
      image: image || product.image,
      images: imagesList,
      description: description || product.description,
      categorie: categorie || product.categorie,
      vendeurCompte: vendeurCompte !== undefined ? vendeurCompte : product.vendeurCompte,
      vendeurLocalisation:
        vendeurLocalisation !== undefined ? vendeurLocalisation : product.vendeurLocalisation,
      isActive: isActive !== undefined ? isActive : product.isActive,
    };

    writeJSONFile(PRODUCTS_FILE, products);

    res.json({ message: 'Product updated successfully', product: products[productIndex] });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const productIndex = products.findIndex((p) => p.id === parseInt(req.params.id));
    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[productIndex];

    if (product.vendeur !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not allowed' });
    }

    products[productIndex].isActive = false;
    writeJSONFile(PRODUCTS_FILE, products);
    if (req.user.role === 'admin') {
      logAdminEvent(req.user.id, 'admin.product_hidden', 'product', req.params.id, 'success', req.requestId);
    }
    res.json({ message: 'Produit supprimé (caché)' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/products/:id/restore', authenticateToken, requireAdmin, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const productIndex = products.findIndex((p) => p.id === parseInt(req.params.id));
    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }
    products[productIndex] = { ...products[productIndex], isActive: true };
    writeJSONFile(PRODUCTS_FILE, products);
    logAdminEvent(req.user.id, 'admin.product_restored', 'product', req.params.id, 'success', req.requestId);
    res.json({ message: 'Product restored', product: products[productIndex] });
  } catch (error) {
    console.error('Restore product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


app.get('/api/products/seller/my', authenticateToken, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellerProducts = products.filter((p) => p.vendeur === req.user.id);
    res.json(sellerProducts);
  } catch (error) {
    console.error('Get seller products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sellers', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellers = [...new Set(products.map((p) => p.vendeurNom))];
    res.json(sellers);
  } catch (error) {
    console.error('Get sellers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sellers/:name/products', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellerProducts = products.filter(
      (p) => p.vendeurNom === req.params.name && p.isActive !== false
    );
    res.json(sellerProducts);
  } catch (error) {
    console.error('Get seller products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ORDERS
app.put('/api/orders/:id/confirm-delivery', authenticateToken, async (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex((o) => o.id === parseInt(req.params.id));
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[orderIndex];

    const ownsOrder = order.articles.some((article) => {
      const products = readJSONFile(PRODUCTS_FILE);
      const product = products.find((p) => p.id === article.product?.id);
      return product && product.vendeur === req.user.id;
    });

    if (!ownsOrder) {
      return res.status(403).json({ error: 'You can only confirm delivery for your orders' });
    }

    if (order.statut !== 'livree') {
      return res.status(400).json({ error: 'Order must be marked as delivered first' });
    }

    order.statut = 'livraison_confirmee';
    writeJSONFile(ORDERS_FILE, orders);

    const buyerId = order.utilisateurId;
    const users = readJSONFile(USERS_FILE);
    const buyer = users.find((u) => u.id == buyerId);

    if (buyer && buyer.fcmToken) {
      await admin.messaging().send({
        token: buyer.fcmToken,
        notification: {
          title: 'Livraison Confirmée',
          body: `Votre commande #${order.id} est livrée`,
        },
        data: {
          type: 'order_confirmed',
          orderId: String(order.id),
        },
      });

      console.log('Notification envoyée ✔');
    } else {
      console.log('No FCM token for buyer, skipping notification');
    }

    res.json({
      message: 'Livraison confirmée! Notification envoyée à l\'acheteur.',
      order,
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/orders', authenticateToken, (req, res) => {
  try {
    const { items, paymentMethod, phoneNumber, accountName, nomLivraison, telLivraison, villeCommune, quartier } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    if (!paymentMethod || !phoneNumber || !accountName) {
      return res.status(400).json({ error: 'Payment information is required' });
    }

    const products = readJSONFile(PRODUCTS_FILE);
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const users = readJSONFile(USERS_FILE);

    // Find an admin user to use as seller for promotions (admin-created)
    const adminUser = users.find((u) => u.role === 'admin');

    const validatedItems = items.map((item) => {
      // First try to find in products
      let product = products.find((p) => p.id === item.id);
      let isPromotion = false;

      // If not found in products, try promotions
      if (!product) {
        product = promotions.find((p) => p.id === item.id);
        isPromotion = true;
      }

      if (!product || !product.isActive) {
        throw new Error(`Product ID ${item.id} not found or inactive`);
      }

      // For promotions, use discountedPrice; for products, use price
      const itemPrice = isPromotion ? product.discountedPrice : product.price;

      // For promotions, use admin as seller; for products, use product's vendeur
      const seller = isPromotion ? (adminUser?.id || product.vendeur) : product.vendeur;

      return {
        ...item,
        price: itemPrice,
        seller,
        name: product.name,
        image: product.image,
        categorie: product.categorie,
        vendeurNom: isPromotion ? 'Djassa CI' : product.vendeurNom,
        vendeurCompte: isPromotion ? '' : product.vendeurCompte,
      };
    });

    const primarySeller = validatedItems[0].seller;
    const subtotal = validatedItems.reduce((sum, item) => sum + item.price * item.quantite, 0);

    const commissionRate = 0.05;
    const commission = subtotal * commissionRate;
    const total = subtotal + commission;

    const orders = readJSONFile(ORDERS_FILE);

    const newOrder = {
      id: Date.now(),
      transaction_id: req.body.transaction_id || null,
      utilisateurId: req.user.id,
      seller: primarySeller,
      articles: validatedItems,
      total,
      date: new Date().toISOString(),
      statut: 'en_attente',
      statutVendeur: 'a_payer_vendeur',
      methodePaiement: paymentMethod,
      numeroPaiement: phoneNumber,
      nomCompte: accountName,
      nomLivraison: nomLivraison || null,
      telLivraison: telLivraison || null,
      villeCommune: villeCommune || null,
      quartier: quartier || null,
      buyerLat: parseFloat(req.body.buyerLat) || null,
      buyerLng: parseFloat(req.body.buyerLng) || null,
    };

    orders.push(newOrder);
    writeJSONFile(ORDERS_FILE, orders);

    res.status(201).json({
      message: 'Order placed successfully',
      order: newOrder,
      commission,
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.get('/api/orders/my', authenticateToken, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const currentUserId = parseInt(req.user.id);
    const userOrders = orders.filter((o) => parseInt(o.utilisateurId) === currentUserId);
    res.json(userOrders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/orders/:id', authenticateToken, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const order = orders.find((o) => o.id === parseInt(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.utilisateurId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/orders', authenticateToken, requireAdmin, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    res.json(orders);
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/orders/seller/:sellerId', authenticateToken, (req, res) => {
  const sellerId = parseInt(req.params.sellerId);
  const currentUserId = parseInt(req.user.id);

  if (currentUserId !== sellerId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Vous ne pouvez voir que vos propres commandes' });
  }

  try {
    const orders = readJSONFile(ORDERS_FILE);
    const products = readJSONFile(PRODUCTS_FILE);

    const sellerOrders = orders
      .map((order) => {
        const sellerArticles = order.articles.filter((article) => {
          const articleSeller = parseInt(article.seller || article.vendeur || -1);
          if (articleSeller === sellerId) {
            return true;
          }

          const product = products.find((p) => p.id === (article.product?.id || article.id));
          if (product && parseInt(product.vendeur) === sellerId) {
            return true;
          }
          return false;
        });

        if (sellerArticles.length === 0) return null;

        const sellerSubtotal = sellerArticles.reduce(
          (sum, item) => sum + item.price * (item.quantite || 1),
          0
        );

        const commissionRate = 0.05;
        const sellerCommission = sellerSubtotal * commissionRate;
        const sellerTotal = sellerSubtotal + sellerCommission;

        return { ...order, articles: sellerArticles, sellerTotal };
      })
      .filter(Boolean);

    res.json(sellerOrders);
  } catch (error) {
    console.error('Get seller orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/orders/:id/status', authenticateToken, requireAdmin, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex((o) => o.id === parseInt(req.params.id));

    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { statut } = req.body;
    orders[orderIndex].statut = statut;

    writeJSONFile(ORDERS_FILE, orders);
    res.json({ message: 'Order status updated', order: orders[orderIndex] });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/orders/:id/delivery-info', authenticateToken, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex((o) => o.id === parseInt(req.params.id));
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[orderIndex];

    if (order.utilisateurId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { nomLivraison, telLivraison, villeCommune, quartier, buyerLat, buyerLng } = req.body;

    if (nomLivraison !== undefined && nomLivraison !== '') order.nomLivraison = nomLivraison;
    if (telLivraison !== undefined && telLivraison !== '') order.telLivraison = telLivraison;
    if (villeCommune !== undefined && villeCommune !== '') order.villeCommune = villeCommune;
    if (quartier !== undefined && quartier !== '') order.quartier = quartier;
    if (buyerLat !== undefined && buyerLat !== null && buyerLat !== '') order.buyerLat = parseFloat(buyerLat);
    if (buyerLng !== undefined && buyerLng !== null && buyerLng !== '') order.buyerLng = parseFloat(buyerLng);

    writeJSONFile(ORDERS_FILE, orders);
    res.json({ message: 'Infos livraison mises à jour', order });
  } catch (error) {
    console.error('Update delivery info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// CHAT ROUTES
app.use('/api/messages', authenticateToken, chatRoutes);

// USERS

// Certification seller (monthly subscription 1000 FCFA, one-shot)
// NOTE: Paiement GeniusPay n'est pas automatiquement intégré côté certificat.
// On simule l'activation mensuelle: sellerVerifiedUntil = now + 30 jours.
// Si la date est expirée, sellerVerified sera automatiquement remise à false lors du prochain check.

const MONTHLY_SUBSCRIPTION_FCFA = 1000;

function isSellerSubscriptionActive(user) {
  const until = user?.sellerVerifiedUntil;
  if (!until) return false;
  const untilDate = new Date(until);
  if (Number.isNaN(untilDate.getTime())) return false;
  return untilDate.getTime() > Date.now();
}

function refreshSellerVerifiedStatus(user) {
  const active = isSellerSubscriptionActive(user);
  user.sellerVerified = active;
  if (active && !user.sellerVerifiedAt) {
    user.sellerVerifiedAt = new Date().toISOString();
  }
  if (!active) {
    user.sellerVerifiedAt = user.sellerVerifiedAt ?? null;
  }
}

// Met à jour un champ `sellerVerified` + `sellerVerifiedUntil` dans users.json.
// Alias admin (pour que le dashboard admin puisse certifier sans changer le Flutter)
app.put('/api/admin/users/:id/verify-seller', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { sellerCompte, sellerLocalisation } = req.body || {};

    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => String(u.id) === String(req.params.id));
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();

    const currentUntil = users[userIndex]?.sellerVerifiedUntil;
    const currentUntilDate = currentUntil ? new Date(currentUntil) : null;

    let baseDate = now;
    if (currentUntilDate && !Number.isNaN(currentUntilDate.getTime())) {
      // Si l'abonnement n'est pas expiré, on étend depuis sellerVerifiedUntil
      if (currentUntilDate.getTime() > now.getTime()) {
        baseDate = currentUntilDate;
      }
    }

    const until = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    users[userIndex] = {
      ...users[userIndex],
      sellerVerified: true,
      sellerVerifiedAt: users[userIndex].sellerVerifiedAt ?? now.toISOString(),
      sellerVerifiedUntil: until.toISOString(),
      sellerCompte: sellerCompte ?? users[userIndex].sellerCompte ?? '',
      sellerLocalisation:
        sellerLocalisation ??
        users[userIndex].sellerLocalisation ??
        users[userIndex].address ??
        '',
      sellerSubscriptionAmountFcfa: MONTHLY_SUBSCRIPTION_FCFA,
    };

    writeJSONFile(USERS_FILE, users);

    // Notification de certification au vendeur (pas à l'admin), anti-doublon si déjà certifié.
    const nowForNotifAdmin = new Date();
    const wasAlreadyCertifiedAdmin =
      users[userIndex].sellerVerified === true &&
      users[userIndex].sellerVerifiedUntil &&
      new Date(users[userIndex].sellerVerifiedUntil).getTime() > nowForNotifAdmin.getTime();

    if (!wasAlreadyCertifiedAdmin) {
      const sellerAdmin = users[userIndex];
      if (sellerAdmin && sellerAdmin.fcmToken) {
        sendFcmToToken(sellerAdmin.fcmToken, {
          title: 'Boutique certifiée',
          body: 'Votre certification vendeur est activée pour 30 jours.',
          type: 'seller_certified',
          data: {
            userId: String(sellerAdmin.id),
            sellerVerifiedUntil: until.toISOString(),
          },
        }).catch(() => {}); // non bloquant
      }
    }

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'Seller verified successfully (30 days)', user: userWithoutPassword });
  } catch (error) {
    console.error('Verify seller (admin alias) error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Suspension / réactivation de compte (admin uniquement)
app.put('/api/admin/users/:id/suspend', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });
    if (req.user.id === userId) {
      return res.status(403).json({ error: 'Cannot suspend your own account' });
    }
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (users[userIndex].role === 'admin') {
      return res.status(403).json({ error: 'Cannot suspend an admin account' });
    }
    const { reason } = req.body || {};
    users[userIndex] = { ...users[userIndex], suspended: true, suspendedAt: new Date().toISOString(), suspendedReason: reason || null };
    writeJSONFile(USERS_FILE, users);
    logAdminEvent(req.user.id, 'admin.user_suspended', 'user', String(userId), 'success', req.requestId);
    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'User suspended', user: userWithoutPassword });
  } catch (error) {
    console.error('Suspend user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/users/:id/reactivate', authenticateToken, requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    users[userIndex] = { ...users[userIndex], suspended: false, suspendedAt: null, suspendedReason: null };
    writeJSONFile(USERS_FILE, users);
    logAdminEvent(req.user.id, 'admin.user_reactivated', 'user', String(userId), 'success', req.requestId);
    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'User reactivated', user: userWithoutPassword });
  } catch (error) {
    console.error('Reactivate user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
app.put('/api/users/verify-seller', authenticateToken, (req, res) => {
  try {
    const { sellerCompte, sellerLocalisation } = req.body || {};

    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();

    // Renouvellement 30 jours (recharge à chaque certification)
    // => si l'utilisateur est déjà certifié, on prolonge à partir de la date actuelle d'expiration
    const currentUntil = users[userIndex]?.sellerVerifiedUntil;
    const currentUntilDate = currentUntil ? new Date(currentUntil) : null;

    let baseDate = now;
    if (currentUntilDate && !Number.isNaN(currentUntilDate.getTime())) {
      // Si l'abonnement n'est pas expiré, on étend depuis sellerVerifiedUntil
      if (currentUntilDate.getTime() > now.getTime()) {
        baseDate = currentUntilDate;
      }
    }

    const until = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    users[userIndex] = {
      ...users[userIndex],
      sellerVerified: true,
      // sellerVerifiedAt: on ne remplace pas la date initiale de certification
      sellerVerifiedAt: users[userIndex].sellerVerifiedAt ?? now.toISOString(),
      // sellerVerifiedUntil: mise à jour à chaque renouvellement
      sellerVerifiedUntil: until.toISOString(),
      // champs optionnels (pour garder trace du compte saisi)
      sellerCompte: sellerCompte ?? users[userIndex].sellerCompte ?? '',
      sellerLocalisation:
        sellerLocalisation ??
        users[userIndex].sellerLocalisation ??
        users[userIndex].address ??
        '',
      // trace info abonnement
      sellerSubscriptionAmountFcfa: MONTHLY_SUBSCRIPTION_FCFA,
    };

    writeJSONFile(USERS_FILE, users);

    // Notification de certification au vendeur (lui-même), anti-doublon si déjà certifié.
    const nowForNotifUser = new Date();
    const wasAlreadyCertifiedUser =
      users[userIndex].sellerVerified === true &&
      users[userIndex].sellerVerifiedUntil &&
      new Date(users[userIndex].sellerVerifiedUntil).getTime() > nowForNotifUser.getTime();

    if (!wasAlreadyCertifiedUser) {
      const sellerUser = users[userIndex];
      if (sellerUser && sellerUser.fcmToken) {
        sendFcmToToken(sellerUser.fcmToken, {
          title: 'Boutique certifiée',
          body: 'Votre certification vendeur est activée pour 30 jours.',
          type: 'seller_certified',
          data: {
            userId: String(sellerUser.id),
            sellerVerifiedUntil: until.toISOString(),
          },
        }).catch(() => {}); // non bloquant
      }
    }

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'Seller verified successfully (30 days)', user: userWithoutPassword });
  } catch (error) {
    console.error('Verify seller error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint: vérifier et mettre à jour sellerVerified selon sellerVerifiedUntil.
app.post('/api/users/refresh-seller-verified', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[userIndex];
    refreshSellerVerifiedStatus(user);

    users[userIndex] = user;
    writeJSONFile(USERS_FILE, users);

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'Seller verification refreshed', user: userWithoutPassword });
  } catch (error) {
    console.error('Refresh seller verified error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:userId/follow', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const targetId = String(req.params.userId);
    const targetUser = users.find((user) => String(user.id) === targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
    const isFollowing = subscriptions.some(
      (subscription) =>
        String(subscription.followerId) === String(req.user.id) &&
        String(subscription.followingId) === targetId
    );
    const followersCount = subscriptions.filter(
      (subscription) => String(subscription.followingId) === targetId
    ).length;

    res.json({ isFollowing, followersCount });
  } catch (error) {
    console.error('Get follow status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/:userId/follow', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const targetId = String(req.params.userId);
    const followerId = String(req.user.id);
    if (followerId === targetId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous abonner à vous-même' });
    }

    const targetUser = users.find((user) => String(user.id) === targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
    const existingSubscription = subscriptions.find(
      (subscription) =>
        String(subscription.followerId) === followerId &&
        String(subscription.followingId) === targetId
    );
    if (!existingSubscription) {
      subscriptions.push({
        id: Date.now(),
        followerId: req.user.id,
        followingId: targetUser.id,
        createdAt: new Date().toISOString(),
      });
      writeJSONFile(SUBSCRIPTIONS_FILE, subscriptions);
    }

    const followersCount = subscriptions.filter(
      (subscription) => String(subscription.followingId) === targetId
    ).length;
    res.status(existingSubscription ? 200 : 201).json({
      subscribed: true,
      isFollowing: true,
      followersCount,
    });
  } catch (error) {
    console.error('Follow user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:userId/follow', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const targetId = String(req.params.userId);
    const followerId = String(req.user.id);
    if (followerId === targetId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous désabonner de vous-même' });
    }

    const targetUser = users.find((user) => String(user.id) === targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
    const filteredSubscriptions = subscriptions.filter(
      (subscription) =>
        !(
          String(subscription.followerId) === followerId &&
          String(subscription.followingId) === targetId
        )
    );
    writeJSONFile(SUBSCRIPTIONS_FILE, filteredSubscriptions);

    const followersCount = filteredSubscriptions.filter(
      (subscription) => String(subscription.followingId) === targetId
    ).length;
    res.json({ subscribed: false, isFollowing: false, followersCount });
  } catch (error) {
    console.error('Unfollow user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:userId/followers', authenticateToken, (req, res) => {
  try {
    const targetId = String(req.params.userId);
    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
    const followerIds = subscriptions
      .filter((s) => String(s.followingId) === targetId)
      .map((s) => String(s.followerId));
    const users = readJSONFile(USERS_FILE).filter((u) => followerIds.includes(String(u.id)));
    res.json(
      users.map((u) => ({
        id: u.id,
        nom: u.nom,
        prenom: u.prenom,
        numero: u.numero,
        address: u.address,
        sellerVerified: u.sellerVerified,
      }))
    );
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:userId/following', authenticateToken, (req, res) => {
  try {
    const targetId = String(req.params.userId);
    const subscriptions = readJSONFile(SUBSCRIPTIONS_FILE);
    const followingIds = subscriptions
      .filter((s) => String(s.followerId) === targetId)
      .map((s) => String(s.followingId));
    const users = readJSONFile(USERS_FILE).filter((u) => followingIds.includes(String(u.id)));
    res.json(
      users.map((u) => ({
        id: u.id,
        nom: u.nom,
        prenom: u.prenom,
        numero: u.numero,
        address: u.address,
        sellerVerified: u.sellerVerified,
      }))
    );
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/:userId', (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const targetId = String(req.params.userId);
    const user = users.find((u) => String(u.id) === targetId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const publicUser = {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      avatarUrl: user.avatarUrl || null,
      sellerVerified: user.sellerVerified || false,
      sellerVerifiedAt: user.sellerVerifiedAt || null,
      sellerVerifiedUntil: user.sellerVerifiedUntil || null,
    };

    res.json(publicUser);
  } catch (error) {
    console.error('Get public user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/profile', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/profile', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { nom, prenom, address } = req.body;

    users[userIndex] = {
      ...users[userIndex],
      nom: nom || users[userIndex].nom,
      prenom: prenom || users[userIndex].prenom,
      address: address || users[userIndex].address,
    };

    writeJSONFile(USERS_FILE, users);

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'Profile updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/profile/avatar', authenticateToken, (req, res) => {
  try {
    const { avatarUrl } = req.body;
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    users[userIndex].avatarUrl = avatarUrl;
    writeJSONFile(USERS_FILE, users);

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ message: 'Avatar updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/fcm-token', authenticateToken, (req, res) => {
  try {
    const { fcmToken } = req.body;
    const users = readJSONFile(USERS_FILE);
    const index = users.findIndex((u) => u.id === req.user.id);
    if (index === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    users[index].fcmToken = fcmToken;
    console.log('🔥 FCM TOKEN ENREGISTRÉ =', users[index].fcmToken);
    writeJSONFile(USERS_FILE, users);

    res.json({ message: 'FCM token saved' });
  } catch (error) {
    console.error('FCM token save error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const usersWithoutPassword = users.map(({ password, ...user }) => user);
    res.json(usersWithoutPassword);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/certification-info', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { boutiqueNom, rectoCiUrl, versoCiUrl, lieu, photoVendeurUrl, telephone } = req.body;

    if (!boutiqueNom || !rectoCiUrl || !versoCiUrl || !lieu || !photoVendeurUrl || !telephone) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    }

    const newInfo = {
      id: Date.now(),
      boutiqueNom,
      rectoCiUrl,
      versoCiUrl,
      lieu,
      photoVendeurUrl,
      telephone,
      createdAt: new Date().toISOString(),
    };

    const data = readJSONFile(CERTIFICATION_INFO_FILE);
    data.push(newInfo);
    writeJSONFile(CERTIFICATION_INFO_FILE, data);

    res.status(201).json({ success: true, data: newInfo });
  } catch (error) {
    console.error('Save certification info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/certification-info', authenticateToken, requireAdmin, (req, res) => {
  try {
    const data = readJSONFile(CERTIFICATION_INFO_FILE);
    res.json(data);
  } catch (error) {
    console.error('Get certification info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== User certification info routes (non-admin) =====
// POST /api/users/certification-info - Save or update user's certification request
app.post('/api/users/certification-info', authenticateToken, (req, res) => {
  try {
    const { boutiqueNom, rectoCiUrl, versoCiUrl, lieu, photoVendeurUrl, telephone } = req.body;
    const userId = req.user.id;

    if (!boutiqueNom || !rectoCiUrl || !versoCiUrl || !lieu || !photoVendeurUrl || !telephone) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    }

    const data = readJSONFile(CERTIFICATION_INFO_FILE);

    // Check if user already has a certification request
    const existingIndex = data.findIndex((item) => item.userId === userId);

    const certificationInfo = {
      boutiqueNom,
      rectoCiUrl,
      versoCiUrl,
      lieu,
      photoVendeurUrl,
      telephone,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex !== -1) {
      // Update existing request (preserve id and createdAt)
      const existing = data[existingIndex];
      // Don't allow modification if already processed/approved by admin (status field)
      if (existing.status === 'approved') {
        return res.status(400).json({ error: 'Cette demande a déjà été approuvée et ne peut plus être modifiée' });
      }
      data[existingIndex] = {
        ...existing,
        ...certificationInfo,
      };
      writeJSONFile(CERTIFICATION_INFO_FILE, data);
      return res.json({ success: true, data: data[existingIndex], updated: true });
    }

    // Create new request
    const newInfo = {
      id: Date.now(),
      userId,
      ...certificationInfo,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    data.push(newInfo);
    writeJSONFile(CERTIFICATION_INFO_FILE, data);

    res.status(201).json({ success: true, data: newInfo });
  } catch (error) {
    console.error('Save user certification info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/certification-info - Get current user's certification request
app.get('/api/users/certification-info', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const data = readJSONFile(CERTIFICATION_INFO_FILE);
    const userRequest = data.find((item) => item.userId === userId);

    if (!userRequest) {
      return res.status(404).json({ error: 'Aucune demande de certification trouvée' });
    }

    res.json(userRequest);
  } catch (error) {
    console.error('Get user certification info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users/certify-seller/init', authenticateToken, async (req, res) => {
  try {
    const payload = {
      amount: 1000,
      description: 'Certification vendeur Djassa CI',
      customer: {
        name: req.body.name,
        phone: req.body.phone || req.user.numero,

      },
      metadata: {
        payment_type: 'seller_certification',
        user_id: String(req.user.id),
      },
    };

    const response = await fetch('https://geniuspay.ci/api/v1/merchant/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': GENIUSPAY_API_KEY,
        'X-API-Secret': GENIUSPAY_SECRET_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    return res.json({
      success: true,
      checkout_url: data.data.checkout_url,
      reference: data.data.reference,
    });
  } catch (error) {
    res.status(500).json({ error: 'Certification init failed' });
  }
});

// ARTICLES
app.get('/api/articles', (req, res) => {

  try {
    const articles = readJSONFile(ARTICLES_FILE);
    res.json(articles);
  } catch (error) {
    console.error('Get articles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/articles/:id', (req, res) => {
  try {
    const articles = readJSONFile(ARTICLES_FILE);
    const article = articles.find((a) => a.id === parseInt(req.params.id));
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json(article);
  } catch (error) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/articles', (req, res) => {
  try {
    const { name, price, image, description, categorie, vendeur, vendeurCompte, vendeurLocalisation } = req.body;
    if (!name || !price || !description || !categorie) {
      return res.status(400).json({ error: 'Name, price, description, and category are required' });
    }

    const articles = readJSONFile(ARTICLES_FILE);
    const newArticle = {
      id: Date.now(),
      name,
      price: parseFloat(price),
      image: image || 'https://via.placeholder.com/400x400?text=Article',
      description,
      categorie,
      vendeur: vendeur || 'Anonymous',
      vendeurCompte: vendeurCompte || '',
      vendeurLocalisation: vendeurLocalisation || '',
      datePublication: new Date().toISOString(),
    };

    articles.push(newArticle);
    writeJSONFile(ARTICLES_FILE, articles);

    res.status(201).json({ message: 'Article created successfully', article: newArticle });
  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/articles/:id', (req, res) => {
  try {
    const articles = readJSONFile(ARTICLES_FILE);
    const articleIndex = articles.findIndex((a) => a.id === parseInt(req.params.id));
    if (articleIndex === -1) {
      return res.status(404).json({ error: 'Article not found' });
    }

    articles.splice(articleIndex, 1);
    writeJSONFile(ARTICLES_FILE, articles);

    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    console.error('Delete article error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// CONTACT
app.post('/api/contact', (req, res) => {
  try {
    const { nom, email, sujet, message } = req.body;
    if (!nom || !email || !sujet || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    console.log('Contact form submission:', { nom, email, sujet, message });
    res.json({ message: 'Message sent successfully! We will contact you soon.' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/contact/seller', (req, res) => {
  try {
    const { nomVendeur, numeroVendeur, sujet, message } = req.body;
    if (!nomVendeur || !numeroVendeur || !sujet || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    console.log('Seller contact submission:', { nomVendeur, numeroVendeur, sujet, message });
    res.json({ message: 'Message sent to seller successfully!' });
  } catch (error) {
    console.error('Seller contact error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// STATS
app.get('/api/stats', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const products = readJSONFile(PRODUCTS_FILE);
    const orders = readJSONFile(ORDERS_FILE);

    const stats = {
      totalUsers: users.length,
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.isActive).length,
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + o.total, 0),
    };

    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ADMIN (lecture seule): tous les achats en équipe — données réelles, contributions confirmées uniquement pour la progression.
app.get('/api/admin/teams', authenticateToken, requireAdmin, (req, res) => {
  try {
    const teams = Array.isArray(readJSONFile(TEAM_PURCHASES_FILE)) ? readJSONFile(TEAM_PURCHASES_FILE) : [];
    const payments = Array.isArray(readJSONFile(TEAM_PAYMENTS_FILE)) ? readJSONFile(TEAM_PAYMENTS_FILE) : [];
    const promotions = Array.isArray(readJSONFile(PROMOTIONS_FILE)) ? readJSONFile(PROMOTIONS_FILE) : [];
    const products = Array.isArray(readJSONFile(PRODUCTS_FILE)) ? readJSONFile(PRODUCTS_FILE) : [];
    const users = Array.isArray(readJSONFile(USERS_FILE)) ? readJSONFile(USERS_FILE) : [];

    const confirmedByTeam = Object.create(null);
    const confirmedByTeamUser = Object.create(null);
    payments.forEach((p) => {
      if (!p || p.paymentStatus !== 'confirmed') return;
      const tid = parseInt(p.teamId, 10);
      if (!Number.isFinite(tid) || tid <= 0) return;
      const amt = Number(p.amount);
      if (!Number.isFinite(amt)) return;
      confirmedByTeam[tid] = (Number(confirmedByTeam[tid]) || 0) + amt;
      const uid = parseInt(p.participantId != null ? p.participantId : p.userId, 10);
      if (Number.isFinite(uid) && uid > 0) {
        const k = tid + ':' + uid;
        confirmedByTeamUser[k] = (Number(confirmedByTeamUser[k]) || 0) + amt;
      }
    });

    const promoById = new Map(promotions.map((p) => [parseInt(p && p.id, 10), p]));
    const productById = new Map(products.map((p) => [parseInt(p && p.id, 10), p]));
    const userById = new Map(users.map((u) => [parseInt(u && u.id, 10), u]));
    const safeUserName = (id) => {
      const uid = parseInt(id, 10);
      if (!Number.isFinite(uid) || uid <= 0) return null;
      const u = userById.get(uid);
      if (!u) return null;
      const full = [u.prenom, u.nom].filter((v) => v != null && String(v).trim() !== '').join(' ').trim();
      return full || (u.username != null ? String(u.username) : null) || (u.numero != null ? String(u.numero) : null) || (u.phone != null ? String(u.phone) : null) || null;
    };

    const items = teams.map((team) => {
      const tid = parseInt(team && team.teamId, 10);
      const target = Number(team && team.teamAmount != null ? team.teamAmount : (team && team.targetAmount));
      const targetAmount = Number.isFinite(target) && target >= 0 ? target : (Number.isFinite(Number(team && team.targetAmount)) ? Number(team.targetAmount) : null);
      // Progression: contributions CONFIRMÉES uniquement (réelles, team_payments). pending/initializing/failed exclus.
      const collectedAmount = roundMoney2(Number(confirmedByTeam[tid]) || 0);
      const remainingAmount = (targetAmount != null) ? roundMoney2(Math.max(0, targetAmount - collectedAmount)) : null;
      let progressPercent = null;
      if (targetAmount != null) {
        progressPercent = targetAmount > 0 ? Math.min(100, Math.max(0, (collectedAmount / targetAmount) * 100)) : 0;
      }
      const status = typeof effectiveTeamStatus === 'function' ? effectiveTeamStatus(team) : (team && team.status ? team.status : null);
      const promo = promoById.get(parseInt(team && team.promotionId, 10));
      const prod = promo ? (productById.get(parseInt(promo.productId, 10)) || productById.get(parseInt(promo.id, 10))) : null;
      const productName = (promo && (promo.name || promo.title)) ? String(promo.name || promo.title) : (prod && (prod.name || prod.title) ? String(prod.name || prod.title) : null);
      const productImage = (promo && (promo.image || promo.imageUrl)) ? String(promo.image || promo.imageUrl) : (prod && (prod.image || prod.imageUrl) ? String(prod.image || prod.imageUrl) : null);
      const participantsRaw = Array.isArray(team && team.participants) ? team.participants : [];
      const participants = participantsRaw.map((p) => {
        const uid = parseInt(p && p.userId, 10);
        const paid = confirmedByTeamUser[tid + ':' + uid];
        return {
          userId: Number.isFinite(uid) ? uid : null,
          name: safeUserName(uid),
          joinedAt: p && p.joinedAt ? p.joinedAt : null,
          confirmedAmountPaid: paid != null ? roundMoney2(paid) : 0,
        };
      });
      return {
        teamId: Number.isFinite(tid) ? tid : null,
        productName,
        productImage,
        creatorId: team && team.creatorId != null ? parseInt(team.creatorId, 10) : null,
        creatorName: safeUserName(team && team.creatorId),
        targetAmount,
        collectedAmount,
        remainingAmount,
        progressPercent,
        participantsCount: participants.length,
        participants,
        createdAt: team && team.createdAt ? team.createdAt : null,
        expiresAt: team && team.expiresAt ? team.expiresAt : null,
        status,
        finalOrderId: team && team.finalOrderId != null ? team.finalOrderId : null,
      };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return res.json({ items, count: items.length });
  } catch (error) {
    console.error('Admin teams error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ADMIN (lecture seule): tous les achats petit à petit — contributions confirmées uniquement pour la progression.
app.get('/api/admin/savings', authenticateToken, requireAdmin, (req, res) => {
  try {
    const plans = Array.isArray(readJSONFile(PROMOTION_SAVINGS_FILE)) ? readJSONFile(PROMOTION_SAVINGS_FILE) : [];
    const payments = Array.isArray(readJSONFile(PROMOTION_SAVINGS_PAYMENTS_FILE)) ? readJSONFile(PROMOTION_SAVINGS_PAYMENTS_FILE) : [];
    const promotions = Array.isArray(readJSONFile(PROMOTIONS_FILE)) ? readJSONFile(PROMOTIONS_FILE) : [];
    const products = Array.isArray(readJSONFile(PRODUCTS_FILE)) ? readJSONFile(PRODUCTS_FILE) : [];
    const users = Array.isArray(readJSONFile(USERS_FILE)) ? readJSONFile(USERS_FILE) : [];

    const promoById = new Map(promotions.map((p) => [parseInt(p && p.id, 10), p]));
    const productById = new Map(products.map((p) => [parseInt(p && p.id, 10), p]));
    const userById = new Map(users.map((u) => [parseInt(u && u.id, 10), u]));
    const safeUserName = (id) => {
      const uid = parseInt(id, 10);
      if (!Number.isFinite(uid) || uid <= 0) return null;
      const u = userById.get(uid);
      if (!u) return null;
      const full = [u.prenom, u.nom].filter((v) => v != null && String(v).trim() !== '').join(' ').trim();
      return full || (u.username != null ? String(u.username) : null) || (u.numero != null ? String(u.numero) : null) || (u.phone != null ? String(u.phone) : null) || null;
    };

    const items = plans.map((plan) => {
      // Réutilise la vue existante: collectedAmount/progress calculés depuis contributions CONFIRMÉES uniquement.
      const view = buildPromotionSavingsPlanView(plan, payments);
      const contributions = Array.isArray(view.contributions) ? view.contributions : [];
      const promo = promoById.get(parseInt((plan && plan.promotionId) != null ? plan.promotionId : view.promotionId, 10));
      const prod = promo ? (productById.get(parseInt(promo.productId, 10)) || productById.get(parseInt(promo.id, 10))) : null;
      const productName = (promo && (promo.name || promo.title)) ? String(promo.name || promo.title)
        : (plan && plan.promotionName ? String(plan.promotionName) : (view.promotionName ? String(view.promotionName) : (prod && (prod.name || prod.title) ? String(prod.name || prod.title) : null)));
      const productImage = (promo && (promo.image || promo.imageUrl)) ? String(promo.image || promo.imageUrl)
        : (prod && (prod.image || prod.imageUrl) ? String(prod.image || prod.imageUrl) : null);
      const targetAmount = Number.isFinite(Number(view.targetAmount)) ? Number(view.targetAmount) : null;
      const collectedAmount = Number.isFinite(Number(view.collectedAmount)) ? Number(view.collectedAmount) : null;
      const progressPercent = (targetAmount != null && collectedAmount != null)
        ? Math.min(100, Math.max(0, targetAmount > 0 ? (collectedAmount / targetAmount) * 100 : 0))
        : (Number.isFinite(Number(view.progress)) ? Math.min(100, Math.max(0, Number(view.progress) * 100)) : null);
      return {
        planId: view.planId != null ? view.planId : (plan && plan.planId != null ? plan.planId : null),
        productName,
        productImage,
        buyerId: view.userId != null ? view.userId : (plan && plan.userId != null ? plan.userId : null),
        buyerName: safeUserName(view.userId != null ? view.userId : (plan && plan.userId)),
        targetAmount,
        savedAmount: collectedAmount,
        collectedAmount,
        remainingAmount: Number.isFinite(Number(view.remainingAmount)) ? Number(view.remainingAmount) : null,
        progressPercent,
        contributionsCount: contributions.length,
        contributions,
        createdAt: view.createdAt || (plan && plan.createdAt) || null,
        updatedAt: view.updatedAt || (plan && plan.updatedAt) || null,
        completedAt: view.completedAt || (plan && plan.completedAt) || null,
        status: view.status || (plan && plan.status) || null,
        finalOrderId: view.finalOrderId != null ? view.finalOrderId : (plan && plan.finalOrderId != null ? plan.finalOrderId : null),
      };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return res.json({ items, count: items.length });
  } catch (error) {
    console.error('Admin savings error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// UTILISATEUR (lecture seule): mes achats en équipe (créateur ou participant). Données réelles, contributions confirmées uniquement.
app.get('/api/my/teams', authenticateToken, (req, res) => {
  try {
    const userId = parseInt(req.user && req.user.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Utilisateur non authentifié' });

    const teams = Array.isArray(readJSONFile(TEAM_PURCHASES_FILE)) ? readJSONFile(TEAM_PURCHASES_FILE) : [];
    const myTeams = teams.filter((team) => {
      if (!team) return false;
      if (parseInt(team.creatorId, 10) === userId) return true;
      const parts = Array.isArray(team.participants) ? team.participants : [];
      return parts.some((p) => parseInt(p && p.userId, 10) === userId);
    });

    const payments = Array.isArray(readJSONFile(TEAM_PAYMENTS_FILE)) ? readJSONFile(TEAM_PAYMENTS_FILE) : [];
    const promotions = Array.isArray(readJSONFile(PROMOTIONS_FILE)) ? readJSONFile(PROMOTIONS_FILE) : [];
    const products = Array.isArray(readJSONFile(PRODUCTS_FILE)) ? readJSONFile(PRODUCTS_FILE) : [];
    const users = Array.isArray(readJSONFile(USERS_FILE)) ? readJSONFile(USERS_FILE) : [];

    const confirmedByTeam = Object.create(null);
    const confirmedByTeamUser = Object.create(null);
    payments.forEach((p) => {
      if (!p || p.paymentStatus !== 'confirmed') return;
      const tid = parseInt(p.teamId, 10);
      if (!Number.isFinite(tid) || tid <= 0) return;
      const amt = Number(p.amount);
      if (!Number.isFinite(amt)) return;
      confirmedByTeam[tid] = (Number(confirmedByTeam[tid]) || 0) + amt;
      const uid = parseInt(p.participantId != null ? p.participantId : p.userId, 10);
      if (Number.isFinite(uid) && uid > 0) {
        const k = tid + ':' + uid;
        confirmedByTeamUser[k] = (Number(confirmedByTeamUser[k]) || 0) + amt;
      }
    });

    const promoById = new Map(promotions.map((p) => [parseInt(p && p.id, 10), p]));
    const productById = new Map(products.map((p) => [parseInt(p && p.id, 10), p]));
    const userById = new Map(users.map((u) => [parseInt(u && u.id, 10), u]));
    const safeUserName = (id) => {
      const uid = parseInt(id, 10);
      if (!Number.isFinite(uid) || uid <= 0) return null;
      const u = userById.get(uid);
      if (!u) return null;
      const full = [u.prenom, u.nom].filter((v) => v != null && String(v).trim() !== '').join(' ').trim();
      return full || (u.username != null ? String(u.username) : null) || (u.numero != null ? String(u.numero) : null) || (u.phone != null ? String(u.phone) : null) || null;
    };

    const items = myTeams.map((team) => {
      const tid = parseInt(team && team.teamId, 10);
      const target = Number(team && team.teamAmount != null ? team.teamAmount : (team && team.targetAmount));
      const targetAmount = Number.isFinite(target) && target >= 0 ? target : (Number.isFinite(Number(team && team.targetAmount)) ? Number(team.targetAmount) : null);
      const collectedAmount = roundMoney2(Number(confirmedByTeam[tid]) || 0);
      const remainingAmount = (targetAmount != null) ? roundMoney2(Math.max(0, targetAmount - collectedAmount)) : null;
      let progressPercent = null;
      let progress = null;
      if (targetAmount != null) {
        progress = targetAmount > 0 ? Math.min(1, Math.max(0, collectedAmount / targetAmount)) : 0;
        progressPercent = Math.min(100, Math.max(0, progress * 100));
      }
      const status = typeof effectiveTeamStatus === 'function' ? effectiveTeamStatus(team) : (team && team.status ? team.status : null);
      const promo = promoById.get(parseInt(team && team.promotionId, 10));
      const prod = promo ? (productById.get(parseInt(promo.productId, 10)) || productById.get(parseInt(promo.id, 10))) : null;
      const productName = (promo && (promo.name || promo.title)) ? String(promo.name || promo.title) : (prod && (prod.name || prod.title) ? String(prod.name || prod.title) : null);
      const productImage = (promo && (promo.image || promo.imageUrl)) ? String(promo.image || promo.imageUrl) : (prod && (prod.image || prod.imageUrl) ? String(prod.image || prod.imageUrl) : null);
      const participantsRaw = Array.isArray(team && team.participants) ? team.participants : [];
      const participants = participantsRaw.map((p) => {
        const uid = parseInt(p && p.userId, 10);
        const paid = confirmedByTeamUser[tid + ':' + uid];
        return {
          userId: Number.isFinite(uid) ? uid : null,
          name: safeUserName(uid),
          joinedAt: p && p.joinedAt ? p.joinedAt : null,
          confirmedAmountPaid: paid != null ? roundMoney2(paid) : 0,
        };
      });
      const isComplete = targetAmount != null ? (collectedAmount >= targetAmount && targetAmount > 0) : (status === 'completed' || team.finalOrderId != null);
      return {
        teamId: Number.isFinite(tid) ? tid : null,
        promotionId: team && team.promotionId != null ? parseInt(team.promotionId, 10) : null,
        productName,
        productImage,
        creatorId: team && team.creatorId != null ? parseInt(team.creatorId, 10) : null,
        creatorName: safeUserName(team && team.creatorId),
        targetAmount,
        collectedAmount,
        remainingAmount,
        progress,
        progressPercent,
        participantsCount: participants.length,
        participants,
        createdAt: team && team.createdAt ? team.createdAt : null,
        expiresAt: team && team.expiresAt ? team.expiresAt : null,
        status,
        finalOrderId: team && team.finalOrderId != null ? team.finalOrderId : null,
        isComplete: !!isComplete,
      };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return res.json({ items, count: items.length });
  } catch (error) {
    console.error('My teams error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// UTILISATEUR (lecture seule): mes achats petit à petit (propriétaire uniquement).
app.get('/api/my/savings', authenticateToken, (req, res) => {
  try {
    const userId = parseInt(req.user && req.user.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(401).json({ error: 'Utilisateur non authentifié' });

    const plans = Array.isArray(readJSONFile(PROMOTION_SAVINGS_FILE)) ? readJSONFile(PROMOTION_SAVINGS_FILE) : [];
    const myPlans = plans.filter((plan) => plan && parseInt(plan.userId, 10) === userId);
    const payments = Array.isArray(readJSONFile(PROMOTION_SAVINGS_PAYMENTS_FILE)) ? readJSONFile(PROMOTION_SAVINGS_PAYMENTS_FILE) : [];
    const promotions = Array.isArray(readJSONFile(PROMOTIONS_FILE)) ? readJSONFile(PROMOTIONS_FILE) : [];
    const products = Array.isArray(readJSONFile(PRODUCTS_FILE)) ? readJSONFile(PRODUCTS_FILE) : [];

    const promoById = new Map(promotions.map((p) => [parseInt(p && p.id, 10), p]));
    const productById = new Map(products.map((p) => [parseInt(p && p.id, 10), p]));

    const items = myPlans.map((plan) => {
      const view = buildPromotionSavingsPlanView(plan, payments);
      const contributions = Array.isArray(view.contributions) ? view.contributions : [];
      const promo = promoById.get(parseInt((plan && plan.promotionId) != null ? plan.promotionId : view.promotionId, 10));
      const prod = promo ? (productById.get(parseInt(promo.productId, 10)) || productById.get(parseInt(promo.id, 10))) : null;
      const productName = (promo && (promo.name || promo.title)) ? String(promo.name || promo.title)
        : (plan && plan.promotionName ? String(plan.promotionName) : (view.promotionName ? String(view.promotionName) : (prod && (prod.name || prod.title) ? String(prod.name || prod.title) : null)));
      const productImage = (promo && (promo.image || promo.imageUrl)) ? String(promo.image || promo.imageUrl)
        : (prod && (prod.image || prod.imageUrl) ? String(prod.image || prod.imageUrl) : null);
      const targetAmount = Number.isFinite(Number(view.targetAmount)) ? Number(view.targetAmount) : null;
      const collectedAmount = Number.isFinite(Number(view.collectedAmount)) ? Number(view.collectedAmount) : null;
      const progressPercent = (targetAmount != null && collectedAmount != null)
        ? Math.min(100, Math.max(0, targetAmount > 0 ? (collectedAmount / targetAmount) * 100 : 0))
        : (Number.isFinite(Number(view.progress)) ? Math.min(100, Math.max(0, Number(view.progress) * 100)) : null);
      let lastContributionAt = null;
      contributions.forEach((c) => {
        const d = c && (c.confirmedAt || c.createdAt || c.updatedAt);
        if (d && (!lastContributionAt || String(d) > String(lastContributionAt))) lastContributionAt = d;
      });
      return {
        planId: view.planId != null ? view.planId : (plan && plan.planId != null ? plan.planId : null),
        promotionId: (plan && plan.promotionId != null ? plan.promotionId : (view.promotionId != null ? view.promotionId : null)),
        productName,
        productImage,
        targetAmount,
        savedAmount: collectedAmount,
        collectedAmount,
        remainingAmount: Number.isFinite(Number(view.remainingAmount)) ? Number(view.remainingAmount) : null,
        progress: Number.isFinite(Number(view.progress)) ? Math.min(1, Math.max(0, Number(view.progress))) : (targetAmount != null && collectedAmount != null && targetAmount > 0 ? Math.min(1, Math.max(0, collectedAmount / targetAmount)) : null),
        progressPercent,
        contributionsCount: contributions.length,
        contributions,
        createdAt: view.createdAt || (plan && plan.createdAt) || null,
        lastContributionAt,
        status: view.status || (plan && plan.status) || null,
        finalOrderId: view.finalOrderId != null ? view.finalOrderId : (plan && plan.finalOrderId != null ? plan.finalOrderId : null),
        isComplete: view.isComplete === true || view.status === 'completed' || view.finalOrderId != null,
      };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return res.json({ items, count: items.length });
  } catch (error) {
    console.error('My savings error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Djassa CI API is running', timestamp: new Date().toISOString() });
});

app.post('/api/payment/geniuspay/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const payload = JSON.stringify(req.body);
  const secret = process.env.GENIUS_WEBHOOK_SECRET;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + payload)
    .digest('hex');

  if (signature !== expected) {
    return res.sendStatus(401);
  }

  const event = req.body.event;
  const metadata = req.body.data?.metadata || {};
  const orderId = metadata.order_id;
  const paymentType = metadata.payment_type; // 'order' | 'seller_certification' | 'team_contribution' | 'promotion_savings_contribution'
  const contributionId = metadata.contribution_id;
  const webhookReference =
    (req.body.data && (req.body.data.reference || req.body.data.payment_reference || req.body.data.transaction_reference)) ||
    req.body.reference ||
    metadata.reference ||
    null;

  // Clé de déduplication dérivée (pas d'event_id natif dans le code actuel)
  let dedupKey;
  if (paymentType === 'team_contribution') {
    dedupKey = `${event}:team_contribution:${String(contributionId || 'unknown')}:${String(webhookReference || 'noref')}`;
  } else if (paymentType === 'promotion_savings_contribution') {
    const scid = metadata.contribution_id;
    dedupKey = `${event}:promotion_savings_contribution:${String(scid || 'unknown')}:${String(webhookReference || 'noref')}`;
  } else {
    dedupKey = `${event}:${paymentType || 'order'}:${orderId || metadata.user_id || 'unknown'}`;
  }

  // Verrou en mémoire (instance unique)
  if (processingKeys.has(dedupKey)) {
    return res.sendStatus(200);
  }

  // Registre persistant
  const events = readJSONFile(WEBHOOK_EVENTS_FILE);
  const existing = Array.isArray(events) ? events.find((e) => e.key === dedupKey) : null;
  if (existing && existing.status === 'processed') {
    return res.sendStatus(200);
  }

  // processing frais (< 5 min): 200 sans retraiter pour éviter une double exécution cross-instance
  // (limite JSON/multi-instance Render: pas de verrou distribué). Un échec est marqué 'failed' (retriable).
  const STALE_MS = 5 * 60 * 1000;
  if (existing && existing.status === 'processing' && Date.now() - (existing.updatedAt || 0) < STALE_MS) {
    return res.sendStatus(200);
  }

  processingKeys.add(dedupKey);

  try {
    // Marquer processing
    const idx = events.findIndex((e) => e.key === dedupKey);
    const record = { key: dedupKey, status: 'processing', updatedAt: Date.now() };
    if (idx !== -1) events[idx] = record; else events.push(record);
    writeJSONFile(WEBHOOK_EVENTS_FILE, events);

    // 0) Paiements des contributions équipe (PHASE D2) — pas de commande finale ici
    if (paymentType === 'team_contribution') {
      const teamIdMeta = parseInt(metadata.team_id, 10);
      const participantIdMeta = parseInt(metadata.participant_id, 10);
      const contributionIdMeta = parseInt(contributionId, 10);
      const refStr = typeof webhookReference === 'string' ? webhookReference.trim() : '';

      // Événement doit indiquer succès ou échec de paiement
      const isSuccess = event === 'payment.success';
      const isFailure = event === 'payment.failed' || event === 'payment.failure' || event === 'payment.cancelled';
      if (!isSuccess && !isFailure) {
        // événement non pertinent: marquer processed sans effet
      } else if (!teamIdMeta || !participantIdMeta || !contributionIdMeta || !refStr) {
        console.warn('Team contribution webhook: identifiants/référence manquants');
      } else {
        const payments = readJSONFile(TEAM_PAYMENTS_FILE);
        const allPayments = Array.isArray(payments) ? payments : [];
        const pIdx = allPayments.findIndex((p) => parseInt(p && p.paymentId, 10) === contributionIdMeta);
        if (pIdx === -1) {
          console.warn('Team contribution webhook: contribution introuvable', contributionIdMeta);
        } else {
          const contribution = allPayments[pIdx];

          // Vérifications strictes: même contribution, bonne équipe/participant, référence exacte
          const sameTeam = parseInt(contribution.teamId, 10) === teamIdMeta;
          const sameParticipant = parseInt(contribution.participantId, 10) === participantIdMeta;
          const sameRef = typeof contribution.transactionReference === 'string' && contribution.transactionReference === refStr;

          // Montant confirmé doit correspondre exactement au montant enregistré (si fourni par GeniusPay)
          const webhookAmountRaw = req.body.data && (req.body.data.amount ?? req.body.data.paid_amount ?? (req.body.data.payment && req.body.data.payment.amount));
          const webhookAmount = webhookAmountRaw != null ? Number(webhookAmountRaw) : null;
          const recordedAmount = Number(contribution.amount);
          const amountOk = webhookAmount == null ? true : (Number.isFinite(webhookAmount) && Number.isFinite(recordedAmount) && webhookAmount === recordedAmount);

          // Cohérence équipe
          const teams = readJSONFile(TEAM_PURCHASES_FILE);
          const tIdx = Array.isArray(teams) ? teams.findIndex((t) => parseInt(t.teamId, 10) === teamIdMeta) : -1;
          const team = tIdx !== -1 ? teams[tIdx] : null;
          const teamMatches = team && parseInt(team.teamId, 10) === parseInt(contribution.teamId, 10) && Number(team.beneficiaryId) === Number(team.creatorId);

          if (!sameTeam || !sameParticipant || !sameRef || !amountOk || !teamMatches) {
            console.warn('Team contribution webhook: données incohérentes, confirmation refusée', {
              contributionId: contributionIdMeta,
              sameTeam,
              sameParticipant,
              sameRef,
              amountOk,
            });
          } else {
            const nowIso = new Date().toISOString();
            if (isSuccess) {
              // Idempotence: contribution déjà confirmée => ne jamais recompter
              if (contribution.paymentStatus !== 'confirmed') {
                // Ne confirmer que si état compatible (initializing/pending)
                if (contribution.paymentStatus === 'initializing' || contribution.paymentStatus === 'pending') {
                  allPayments[pIdx] = {
                    ...contribution,
                    paymentStatus: 'confirmed',
                    confirmedAt: nowIso,
                    updatedAt: nowIso,
                    transactionReference: contribution.transactionReference, // conserver
                  };
                  const _wTeamPay = await writeJSONFile(TEAM_PAYMENTS_FILE, allPayments);
                  if (_wTeamPay === false) throw new Error('team_contribution_payment_write_error');
                  // FCM (best-effort, transition réelle -> confirmed uniquement): participant + créateur.
                  try {
                    const _teamUsers = readJSONFile(USERS_FILE) || [];
                    const _partU = _teamUsers.find((u)=>parseInt(u&&u.id,10)===parseInt(contribution.participantId,10));
                    const _creU = team ? _teamUsers.find((u)=>parseInt(u&&u.id,10)===parseInt(team.creatorId,10)) : null;
                    if (_partU && _partU.fcmToken) sendFcmToToken(_partU.fcmToken,{title:"Contribution confirmée",body:"Votre contribution a été confirmée.",type:"team_contribution_confirmed",data:{teamId:String(teamIdMeta),contributionId:String(contribution.paymentId||contributionIdMeta)}}).catch(()=>{});
                    if (_creU && _creU.fcmToken && parseInt(_creU.id,10)!==parseInt(_partU&&_partU.id,10)) sendFcmToToken(_creU.fcmToken,{title:"Contribution confirmée",body:"Une contribution a été confirmée dans votre équipe.",type:"team_contribution_confirmed",data:{teamId:String(teamIdMeta),contributionId:String(contribution.paymentId||contributionIdMeta)}}).catch(()=>{});
                  } catch (_) {}

                  // Recalculer collectedAmount UNIQUEMENT depuis contributions confirmées (mémoire, évite race lecture/écriture async)
                  const confirmedSum = allPayments
                    .filter((p) => p && parseInt(p.teamId, 10) === teamIdMeta && p.paymentStatus === 'confirmed')
                    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
                  const teamsAfter = readJSONFile(TEAM_PURCHASES_FILE);
                  const taIdx = Array.isArray(teamsAfter) ? teamsAfter.findIndex((t) => parseInt(t.teamId, 10) === teamIdMeta) : -1;
                  if (taIdx !== -1) {
                    teamsAfter[taIdx] = { ...teamsAfter[taIdx], collectedAmount: confirmedSum };
                    const _wTeam = await writeJSONFile(TEAM_PURCHASES_FILE, teamsAfter);
                    if (_wTeam === false) throw new Error('team_contribution_team_write_error');
                    // Finalisation idempotente après confirmation (écritures critiques awaitées) :
                    // - l'erreur remonte au webhook => HTTP 500 (jamais processed) => retry/reprise possible ;
                    // - une contribution déjà confirmée n'est jamais réinitialisée.
                    await tryFinalizeTeamPurchase(teamIdMeta);
                  }
                } else {
                  console.warn('Team contribution webhook: état non confirmable', contribution.paymentStatus);
                }
              }
            } else if (isFailure) {
              // Ne pas invalider une contribution déjà confirmée
              if (contribution.paymentStatus !== 'confirmed') {
                if (contribution.paymentStatus === 'initializing' || contribution.paymentStatus === 'pending') {
                  allPayments[pIdx] = {
                    ...contribution,
                    paymentStatus: 'failed',
                    failedAt: nowIso,
                    updatedAt: nowIso,
                    failureReason: 'provider_failed',
                  };
                  const _wTeamPayFail = await writeJSONFile(TEAM_PAYMENTS_FILE, allPayments);
                  if (_wTeamPayFail === false) throw new Error('team_contribution_payment_write_error');
                  // FCM (best-effort, transition réelle -> failed uniquement, jamais si confirmed): participant.
                  try {
                    const _partU = (readJSONFile(USERS_FILE) || []).find((u)=>parseInt(u&&u.id,10)===parseInt(contribution.participantId,10));
                    if (_partU && _partU.fcmToken) sendFcmToToken(_partU.fcmToken,{title:"Contribution échouée",body:"Votre paiement n'a pas été confirmé.",type:"team_contribution_failed",data:{teamId:String(teamIdMeta),contributionId:String(contribution.paymentId||contributionIdMeta)}}).catch(()=>{});
                  } catch (_) {}
                  // Réservation libérée (n'est plus pending/initializing). collectedAmount reste basé sur confirmed uniquement.
                }
              }
            }
          }
        }
      }

      // Reprise idempotente (sans nouveau paiement) : contribution déjà 'confirmed' mais équipe
      // financée/non finalisée (échec finalisation précédent, webhook processed, etc.). Aucun
      // changement de statut de paiement, aucune demande de paiement.
      if (isSuccess && teamIdMeta && contributionIdMeta) {
        const _pf = readJSONFile(TEAM_PAYMENTS_FILE);
        const _cf = Array.isArray(_pf) ? _pf.find((p) => parseInt(p && p.paymentId, 10) === contributionIdMeta) : null;
        if (_cf && _cf.paymentStatus === 'confirmed') {
          await tryFinalizeTeamPurchase(teamIdMeta); // idempotent : no-op si non financée/déjà finalisée ; throw sur échec écriture critique => 500 retriable
        }
      }
    }

    // 0b) Paiements "Acheter petit a petit" (promotion_savings_contribution) — isole, sans impact sur team/order/certif
    // C1: lecture sure (loadPromotionSavingsFileSafe). C2: modifs critiques serialisees (runPromotionSavingsSerialized), pas d'appel imbrique (finalisation hors file). C4: ecriture critique -> throw => webhook 500 (retriable; dedup/idempotence protegent).
    if (paymentType === 'promotion_savings_contribution') {
      const planIdMeta = normalizePositiveInt(metadata.plan_id);
      const userIdMeta = normalizePositiveInt(metadata.user_id);
      const contribIdMeta = normalizePositiveInt(metadata.contribution_id);
      const refStrS = typeof webhookReference === 'string' ? webhookReference.trim() : '';
      const isSuccessS = event === 'payment.success';
      const isFailureS = event === 'payment.failed' || event === 'payment.failure' || event === 'payment.cancelled';
      if (isSuccessS || isFailureS) {
        if (!planIdMeta || !userIdMeta || !contribIdMeta || !refStrS) {
          console.warn('Promotion savings webhook: identifiants/reference manquants');
        } else {
          const webhookAmountRawS = req.body.data && (req.body.data.amount ?? req.body.data.paid_amount ?? (req.body.data.payment && req.body.data.payment.amount));
          const webhookAmountS = webhookAmountRawS != null ? Number(webhookAmountRawS) : null;
          let savingsFinalizeTarget = null;
          await runPromotionSavingsSerialized(() => {
            try {
              const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
              const plansL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_FILE);
              if (!paysL.ok || !plansL.ok) { console.error('Promotion savings webhook: stockage illisible/corrompu, confirmation refusee', paysL.error, plansL.error); throw new Error('savings_storage_unreadable'); }
              const allSP = paysL.data;
              const plansS = plansL.data;
              const spIdx = allSP.findIndex((p) => parseInt(p && p.paymentId, 10) === contribIdMeta);
              if (spIdx === -1) { console.warn('Promotion savings webhook: contribution introuvable', contribIdMeta); return; }
              const contrib = allSP[spIdx];
              const samePlan = parseInt(contrib.planId, 10) === planIdMeta;
              const sameUser = parseInt(contrib.userId, 10) === userIdMeta;
              const sameRef = typeof contrib.transactionReference === 'string' && contrib.transactionReference === refStrS;
              const recordedAmountS = Number(contrib.amount);
              const amountOkS = webhookAmountS == null ? true : (Number.isFinite(webhookAmountS) && Number.isFinite(recordedAmountS) && webhookAmountS === recordedAmountS);
              const planSIdx = plansS.findIndex((p) => parseInt(p && p.planId, 10) === planIdMeta);
              const planS = planSIdx !== -1 ? plansS[planSIdx] : null;
              const planMatches = planS && parseInt(planS.planId, 10) === parseInt(contrib.planId, 10) && parseInt(planS.userId, 10) === parseInt(contrib.userId, 10);
              if (!samePlan || !sameUser || !sameRef || !amountOkS || !planMatches) {
                console.warn('Promotion savings webhook: donnees incoherentes, confirmation refusee', { contribIdMeta, samePlan, sameUser, sameRef, amountOkS });
                return;
              }
              const nowIsoS = new Date().toISOString();
              if (isSuccessS) {
                if (contrib.paymentStatus === 'confirmed') return; // idempotent
                if (contrib.paymentStatus === 'initializing' || contrib.paymentStatus === 'pending') {
                  allSP[spIdx] = { ...contrib, paymentStatus: 'confirmed', confirmedAt: nowIsoS, updatedAt: nowIsoS, transactionReference: contrib.transactionReference };
                  fs.writeFileSync(PROMOTION_SAVINGS_PAYMENTS_FILE, JSON.stringify(allSP, null, 2), 'utf8');
                  // FCM (best-effort, transition réelle -> confirmed): propriétaire.
                  try {
                    const _ownerU = (readJSONFile(USERS_FILE) || []).find((u)=>parseInt(u&&u.id,10)===userIdMeta);
                    if (_ownerU && _ownerU.fcmToken) sendFcmToToken(_ownerU.fcmToken,{title:"Versement confirmé",body:"Votre versement a été confirmé.",type:"savings_contribution_confirmed",data:{planId:String(planIdMeta),contributionId:String(contribIdMeta)}}).catch(()=>{});
                  } catch (_) {}
                  const confirmedSumS = roundMoney2(allSP
                    .filter((p) => p && parseInt(p.planId, 10) === planIdMeta && p.paymentStatus === 'confirmed')
                    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
                  const paIdx = plansS.findIndex((p) => parseInt(p && p.planId, 10) === planIdMeta);
                  if (paIdx !== -1) {
                    const targetS = roundMoney2(Number(plansS[paIdx].targetAmount || 0));
                    const remainingS = roundMoney2(Math.max(0, targetS - confirmedSumS));
                    plansS[paIdx] = { ...plansS[paIdx], collectedAmount: confirmedSumS, remainingAmount: remainingS, updatedAt: nowIsoS };
                    fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plansS, null, 2), 'utf8');
                    if (targetS > 0 && confirmedSumS >= targetS) savingsFinalizeTarget = planIdMeta; // finalisation hors file (evite imbriquation)
                  }
                }
              } else if (isFailureS) {
                if (contrib.paymentStatus !== 'confirmed') {
                  if (contrib.paymentStatus === 'initializing' || contrib.paymentStatus === 'pending') {
                    allSP[spIdx] = { ...contrib, paymentStatus: 'failed', failedAt: nowIsoS, updatedAt: nowIsoS, failureReason: 'provider_failed' };
                    fs.writeFileSync(PROMOTION_SAVINGS_PAYMENTS_FILE, JSON.stringify(allSP, null, 2), 'utf8');
                    // FCM (best-effort, transition réelle -> failed, jamais si confirmed): propriétaire.
                    try {
                      const _ownerUF = (readJSONFile(USERS_FILE) || []).find((u)=>parseInt(u&&u.id,10)===userIdMeta);
                      if (_ownerUF && _ownerUF.fcmToken) sendFcmToToken(_ownerUF.fcmToken,{title:"Versement echoue",body:"Votre paiement n'a pas ete confirme.",type:"savings_contribution_failed",data:{planId:String(planIdMeta),contributionId:String(contribIdMeta)}}).catch(()=>{});
                    } catch (_) {}
                  }
                }
              }
            } catch (e) {
              if (e && e.message === 'savings_storage_unreadable') throw e;
              if (e && typeof e.message === 'string' && e.message.indexOf('savings_') === 0) throw e; // ecriture critique -> webhook 500 retriable
              console.error('Promotion savings webhook serialized error:', e && e.message ? e.message : e);
              throw e;
            }
          });
          if (savingsFinalizeTarget) {
            // Finalisation HORS runPromotionSavingsSerialized (evite deadlock/imbriquation). Erreur de finalisation -> throw => webhook 500 retriable; la contribution reste confirmed (idempotence/dedup protegent).
            const fin = await tryFinalizePromotionSavingsPlan(savingsFinalizeTarget);
            if (fin && fin.reason === 'savings_storage_unreadable') throw new Error('savings_storage_unreadable');
            if (fin && fin.ok === false && typeof fin.reason === 'string' && fin.reason.indexOf('savings_') === 0) {
              console.error('Promotion savings finalize after webhook returned critical failure:', fin.reason);
              throw new Error(fin.reason);
            }
          }
        }
      }
    }

    // 1) Paiements des commandes
    const orders = readJSONFile(ORDERS_FILE);
    const index = orders.findIndex((o) => o.id == orderId);

    if (index !== -1) {
      const oldStatut = orders[index].statut;

      // Idempotence métier : ne pas réappliquer si déjà dans l'état cible
      if (event === 'payment.success' && orders[index].statut !== 'payée') {
        orders[index].statut = 'payée';
        io.emit('payment_update', { orderId, status: 'payée' });
      }
      if (event === 'payment.failed' && orders[index].statut !== 'échouée') {
        orders[index].statut = 'échouée';
        io.emit('payment_update', { orderId, status: 'échouée' });
      }

      writeJSONFile(ORDERS_FILE, orders);

      if (orders[index].statut !== oldStatut) {
        const buyerId = orders[index].utilisateurId;
        const users = readJSONFile(USERS_FILE);
        const buyer = users.find((u) => u.id == buyerId);

        if (buyer && buyer.fcmToken) {
          const orderNumber = orders[index].id;
          if (event === 'payment.success') {
            sendFcmToToken(buyer.fcmToken, {
              title: 'Paiement confirmé',
              body: `Votre commande #${orderNumber} est payée !`,
              type: 'payment_confirmed',
              data: { orderId: String(orders[index].id) },
            }).catch(() => {});
          } else if (event === 'payment.failed') {
            sendFcmToToken(buyer.fcmToken, {
              title: 'Paiement échoué',
              body: `Votre commande #${orderNumber} n'a pas pu être réglée.`,
              type: 'payment_failed',
              data: { orderId: String(orders[index].id) },
            }).catch(() => {});
          }
        }
      }
    }

    // 2) Paiement certification vendeur
    if (paymentType === 'seller_certification' && event === 'payment.success') {
      const certificationUserId = metadata.user_id;
      if (certificationUserId) {
        const users = readJSONFile(USERS_FILE);
        const userIndex = users.findIndex((u) => u.id == certificationUserId);
        if (userIndex !== -1) {
          const now = new Date();
          const alreadyActive =
            users[userIndex].sellerVerified === true &&
            users[userIndex].sellerVerifiedUntil &&
            new Date(users[userIndex].sellerVerifiedUntil).getTime() > now.getTime();

          if (!alreadyActive) {
            const until = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            users[userIndex] = {
              ...users[userIndex],
              sellerVerified: true,
              sellerVerifiedAt: now.toISOString(),
              sellerVerifiedUntil: until.toISOString(),
              sellerSubscriptionAmountFcfa: MONTHLY_SUBSCRIPTION_FCFA,
            };
            writeJSONFile(USERS_FILE, users);

            const seller = users[userIndex];
            if (seller && seller.fcmToken) {
              sendFcmToToken(seller.fcmToken, {
                title: 'Boutique certifiée',
                body: 'Votre certification vendeur est activée pour 30 jours.',
                type: 'seller_certified',
                data: {
                  userId: String(seller.id),
                  sellerVerifiedUntil: until.toISOString(),
                },
              }).catch(() => {});
            }
          }
        }
      }
    }

    // Marquer processed uniquement après succès
    const finalEvents = readJSONFile(WEBHOOK_EVENTS_FILE);
    const fi = finalEvents.findIndex((e) => e.key === dedupKey);
    const finalRecord = { key: dedupKey, status: 'processed', updatedAt: Date.now() };
    if (fi !== -1) finalEvents[fi] = finalRecord; else finalEvents.push(finalRecord);
    writeJSONFile(WEBHOOK_EVENTS_FILE, finalEvents);

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err && err.message ? err.message : err);
    // Ne JAMAIS marquer processed sur erreur. Marquer 'failed' (retriable) pour ne pas laisser
    // un 'processing' qui serait acquitté en 200 pendant la fenêtre stale.
    try {
      const errEvents = readJSONFile(WEBHOOK_EVENTS_FILE);
      const arrErr = Array.isArray(errEvents) ? errEvents : [];
      const ei = arrErr.findIndex((e) => e && e.key === dedupKey);
      // Ne jamais rétrograder un événement déjà 'processed' en 'failed' (protection registre).
      // Ne constitue PAS un verrou distribué cross-instance (JSON/multi-instance Render).
      if (ei !== -1 && arrErr[ei] && arrErr[ei].status === 'processed') {
        // no-op: conserver 'processed'
      } else {
        const errRecord = { key: dedupKey, status: 'failed', updatedAt: Date.now() };
        if (ei !== -1) arrErr[ei] = { ...arrErr[ei], ...errRecord }; else arrErr.push(errRecord);
        writeJSONFile(WEBHOOK_EVENTS_FILE, arrErr);
      }
    } catch (_) {}
    res.sendStatus(500);
  } finally {
    processingKeys.delete(dedupKey);
  }
});

// START EXTRA ROUTES
app.get('/api/admin/audit-log', authenticateToken, requireAdmin, (req, res) => {
  try {
    const log = readAuditLog();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const events = log.events.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const page = events.slice(offset, offset + limit);
    res.json({ version: log.version, total: events.length, limit, offset, events: page });
  } catch (error) {
    console.error('Audit log read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
app.put('/api/orders/:id/pay-vendor', authenticateToken, (req, res) => {
  const orderId = parseInt(req.params.id);
  const orders = readJSONFile(ORDERS_FILE);
  const orderIndex = orders.findIndex((o) => o.id === orderId);

  if (orderIndex === -1) {
    return res.status(404).json({ message: 'Commande non trouvée' });
  }

  orders[orderIndex].statutVendeur = 'paye_vendeur';
  writeJSONFile(ORDERS_FILE, orders);

  res.json({ message: 'Vendeur payé', order: orders[orderIndex] });
});

app.put('/api/orders/:id/deliver', authenticateToken, (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex((o) => o.id === orderId);

    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    const order = orders[orderIndex];

    const products = readJSONFile(PRODUCTS_FILE);

    const ownsOrder = order.articles.some((article) => {
      const product = products.find((p) => p.id === article.product?.id || p.id === article.id);
      return product && product.vendeur === req.user.id;
    });

    if (!ownsOrder) {
      return res.status(403).json({ error: 'Vous ne pouvez livrer que vos propres commandes' });
    }

    if (order.statut !== 'payée') {
      return res.status(400).json({ error: 'La commande doit être payée avant livraison' });
    }

    order.statut = 'livree';
    writeJSONFile(ORDERS_FILE, orders);

    res.json({ message: 'Commande marquée comme livrée', order });
  } catch (error) {
    console.error('Deliver order error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/payment/geniuspay/init', authenticateToken, async (req, res) => {
  try {
    const { amount, phone, orderId, name } = req.body;

    const payload = {
      amount: Number(amount),
      description: `Commande ${orderId}`,
      customer: {
        name: name,
        phone: phone.startsWith('+') ? phone : `+225${phone}`,
      },
      metadata: { order_id: String(orderId) },
    };

    console.log('👉 GeniusPay payload:', payload);

    const response = await fetch('https://geniuspay.ci/api/v1/merchant/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': GENIUSPAY_API_KEY,
        'X-API-Secret': GENIUSPAY_SECRET_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    console.log('👉 GeniusPay response:', data);

    if (!response.ok || !data.success) {
      return res.status(400).json({ success: false, error: data });
    }

    return res.json({
      success: true,
      checkout_url: data.data.checkout_url,
      reference: data.data.reference,
    });
  } catch (error) {
    console.error('GeniusPay error:', error);
    res.status(500).json({ error: 'Payment init failed' });
  }
});

// ---- Seller certification auto-expiration job (runs periodically) ----
// Important: this is a lightweight JSON-file update to ensure sellerVerified
// is automatically set to false after sellerVerifiedUntil expires.
// Runs every 10 minutes. Envoie aussi un rappel J-1 avant expiration.
const SELLER_VERIFICATION_CRON_MS = 10 * 60 * 1000;
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // ~24h avant expiration

async function autoExpireSellerVerifications() {
  try {
    const users = readJSONFile(USERS_FILE);
    if (!Array.isArray(users) || users.length === 0) return;

    let changed = false;
    const nowMs = Date.now();

    for (const u of users) {
      if (!u || !u.sellerVerifiedUntil) continue;

      const untilDate = new Date(u.sellerVerifiedUntil);
      if (Number.isNaN(untilDate.getTime())) continue;

      const untilMs = untilDate.getTime();
      const active = untilMs > nowMs;

      // Expiration automatique existante: si certifié et expiré, on désactive.
      if (u.sellerVerified === true && !active) {
        u.sellerVerified = false;
        changed = true;
      }

      // Rappel J-1: certification active et expirant dans les 24h.
      if (u.sellerVerified === true && active) {
        const msUntilExpiry = untilMs - nowMs;
        const alreadyReminded =
          u.certReminderSentUntil &&
          new Date(u.certReminderSentUntil).getTime() >= untilMs;

        if (msUntilExpiry > 0 && msUntilExpiry <= REMINDER_WINDOW_MS && !alreadyReminded) {
          if (u.fcmToken && typeof u.fcmToken === 'string' && u.fcmToken.trim() !== '') {
            try {
              const ok = await sendFcmToToken(u.fcmToken, {
                title: 'Votre certification expire bientôt',
                body: 'Votre certification vendeur expire demain. Renouvelez-la pour conserver votre badge.',
                type: 'certification_expiring_soon',
                data: {
                  userId: String(u.id),
                  sellerVerifiedUntil: u.sellerVerifiedUntil,
                },
              });
              // Marquer comme envoyé uniquement si Firebase a accepté.
              if (ok) {
                u.certReminderSentUntil = u.sellerVerifiedUntil;
                changed = true;
              }
            } catch (e) {
              // Échec d'envoi: on ne marque pas, nouvelle tentative au prochain cycle.
              console.error(`Rappel certification échoué user ${u.id}:`, e.message || e);
            }
          }
        }
      }
    }

    if (changed) {
      writeJSONFile(USERS_FILE, users);
      console.log('⏳ Auto-expire/reminder seller verifications (users.json updated)');
    }
  } catch (e) {
    console.error('Auto-expire seller verifications failed:', e);
  }
}

// Start immediately and then periodically.
autoExpireSellerVerifications();
setInterval(autoExpireSellerVerifications, SELLER_VERIFICATION_CRON_MS);

// ===== TEAM PURCHASES (ACHAT EN ÉQUIPE) — PHASE B (création/consultation) =====
// Helpers additifs, sans impact sur les flux existants.
const TEAM_MAX_PARTICIPANTS = 10;
const TEAM_DURATION_DAYS = 15;

function computePromotionTargetAmountServer(promotion) {
  if (!promotion) return null;

  const discount = Number(promotion.discountPercent || 0);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return null;
  }

  if (promotion.discountedPrice != null) {
    const discounted = Number(promotion.discountedPrice);
    if (Number.isFinite(discounted) && discounted > 0) {
      return discounted;
    }
    return null;
  }

  const price = Number(promotion.price);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  if (discount > 0) {
    const computed = price * (1 - discount / 100);
    if (Number.isFinite(computed) && computed > 0) {
      return computed;
    }
    return null;
  }

  return price;
}

function generateTeamInvitationCode(existingCodes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = 'TEAM-';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existingCodes.has(code)) return code;
  }
  throw new Error('Impossible de générer un code d\'invitation unique');
}

function isTeamExpired(team) {
  if (!team || !team.expiresAt) return true;
  const t = new Date(team.expiresAt).getTime();
  return Number.isNaN(t) || t <= Date.now();
}

function effectiveTeamStatus(team) {
  if (!team) return 'unknown';
  if (team.status === 'completed') return 'completed';
  if (team.status === 'cancelled') return 'cancelled';
  if (isTeamExpired(team)) return 'expired';
  return team.status || 'open';
}

function buildTeamView(team) {
  const target = Number(team.targetAmount || 0);
  const collected = Number(team.collectedAmount || 0);
  const remaining = Math.max(0, target - collected);
  // Sommes confirmées par participant (additif, lecture seule) — jamais pending/initializing.
  let confirmedByParticipant = Object.create(null);
  try {
    const paymentsRaw = readJSONFile(TEAM_PAYMENTS_FILE);
    const paymentsArr = Array.isArray(paymentsRaw) ? paymentsRaw : [];
    paymentsArr.forEach((p) => {
      if (!p || parseInt(p.teamId, 10) !== parseInt(team.teamId, 10)) return;
      if (p.paymentStatus !== 'confirmed') return;
      const uid = parseInt(p.participantId, 10);
      if (!Number.isFinite(uid) || uid <= 0) return;
      confirmedByParticipant[uid] = (Number(confirmedByParticipant[uid]) || 0) + (Number(p.amount) || 0);
    });
  } catch (_) {}
  const participants = Array.isArray(team.participants)
    ? team.participants.map((p) => {
        const uid = p && p.userId != null ? Number(p.userId) : null;
        const paid = uid != null ? (Number(confirmedByParticipant[uid]) || 0) : 0;
        return {
          userId: uid,
          joinedAt: p && p.joinedAt ? p.joinedAt : null,
          confirmedAmountPaid: paid,
        };
      })
    : [];
  return {
    teamId: team.teamId,
    promotionId: team.promotionId,
    creatorId: team.creatorId,
    beneficiaryId: team.beneficiaryId,
    targetAmount: target,
    collectedAmount: collected,
    participants,
    invitationCode: team.invitationCode,
    createdAt: team.createdAt,
    expiresAt: team.expiresAt,
    status: effectiveTeamStatus(team),
    finalOrderId: team.finalOrderId != null ? team.finalOrderId : null,
    remainingAmount: remaining,
    participantsCount: participants.length,
    isComplete: target > 0 && collected >= target,
  };
}

// POST /api/teams — créer une équipe depuis une promotion (bénéficiaire = créateur)
app.post('/api/teams', authenticateToken, (req, res) => {
  try {
    const promotionId = parseInt(req.body.promotionId, 10);
    if (!promotionId || Number.isNaN(promotionId)) {
      return res.status(400).json({ error: 'promotionId requis' });
    }

    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotion = promotions.find((p) => parseInt(p.id, 10) === promotionId);
    if (!promotion) {
      return res.status(404).json({ error: 'Promotion introuvable' });
    }
    if (promotion.isActive === false) {
      return res.status(400).json({ error: 'Promotion indisponible' });
    }

    const targetAmount = computePromotionTargetAmountServer(promotion);
    if (!targetAmount || Number.isNaN(targetAmount) || targetAmount <= 0) {
      return res.status(400).json({ error: 'Prix promotionnel invalide' });
    }

    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const existingCodes = new Set(teams.map((t) => t.invitationCode).filter(Boolean));
    let invitationCode;
    try {
      invitationCode = generateTeamInvitationCode(existingCodes);
    } catch (e) {
      return res.status(500).json({ error: 'Impossible de générer un code d\'invitation unique' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TEAM_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const creatorId = parseInt(req.user.id, 10);

    const existingTeamIds = new Set(teams.map((t) => String(t.teamId)));
    let teamId = Date.now();
    let attempts = 0;
    while (existingTeamIds.has(String(teamId)) && attempts < 20) {
      teamId = Date.now() + attempts + 1;
      attempts++;
    }
    if (existingTeamIds.has(String(teamId))) {
      return res.status(500).json({ error: 'Impossible de générer un identifiant d\'équipe unique' });
    }

    const team = {
      teamId,
      promotionId,
      creatorId,
      beneficiaryId: creatorId,
      targetAmount,
      collectedAmount: 0,
      participants: [{ userId: creatorId, joinedAt: now.toISOString() }],
      invitationCode,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'open',
      finalOrderId: null,
    };

    teams.push(team);
    writeJSONFile(TEAM_PURCHASES_FILE, teams);

    // FCM (best-effort, après sauvegarde): équipe créée.
    try {
      const creatorUser = (readJSONFile(USERS_FILE) || []).find((u) => parseInt(u && u.id, 10) === creatorId);
      if (creatorUser && creatorUser.fcmToken) {
        sendFcmToToken(creatorUser.fcmToken, { title: 'Equipe creee', body: 'Votre equipe d\'achat a ete creee. Partagez le code d\'invitation.', type: 'team_created', data: { teamId: String(team.teamId) } }).catch(() => {});
      }
    } catch (_) {}

    return res.status(201).json({ message: 'Équipe créée', team: buildTeamView(team) });
  } catch (error) {
    console.error('Create team error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teams/:id — consulter une équipe (infos + progression)
app.get('/api/teams/:id', authenticateToken, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (!teamId || Number.isNaN(teamId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }

    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const idx = teams.findIndex((t) => parseInt(t.teamId, 10) === teamId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const team = teams[idx];
    const newStatus = effectiveTeamStatus(team);
    let currentTeam = team;
    if (team.status !== newStatus && team.status !== 'completed' && team.status !== 'cancelled') {
      teams[idx] = { ...team, status: newStatus };
      writeJSONFile(TEAM_PURCHASES_FILE, teams);
      currentTeam = teams[idx];
    }
    // Reprise idempotente lecture (best-effort, sans nouveau paiement) : si financée/non finalisée,
    // tente de créer/relier la commande finale. Ne modifie jamais les contributions confirmées.
    if (!currentTeam.finalOrderId && currentTeam.status !== 'completed') {
      try { await tryFinalizeTeamPurchase(teamId); } catch (_) {}
      const _t2 = readJSONFile(TEAM_PURCHASES_FILE);
      const _i2 = Array.isArray(_t2) ? _t2.findIndex((t) => parseInt(t.teamId, 10) === teamId) : -1;
      if (_i2 !== -1) currentTeam = _t2[_i2];
    }

    const view = buildTeamView(currentTeam);
    return res.json({ team: view });
  } catch (error) {
    console.error('Get team error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams/:id/join — rejoindre une équipe ouverte (PHASE C)
app.post('/api/teams/:id/join', authenticateToken, (req, res) => {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (!teamId || Number.isNaN(teamId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }

    const userId = parseInt(req.user.id, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    // Relire les données avant écriture (stockage JSON)
    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const idx = teams.findIndex((t) => parseInt(t.teamId, 10) === teamId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const team = teams[idx];

    // Vérifier la promotion associée (ne pas changer la promotion)
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotion = promotions.find((p) => parseInt(p.id, 10) === parseInt(team.promotionId, 10));
    if (!promotion) {
      return res.status(400).json({ error: 'Promotion associée introuvable' });
    }

    // Garantir cohérence bénéficiaire/créateur (ne jamais modifier)
    if (Number(team.beneficiaryId) !== Number(team.creatorId)) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }

    const status = effectiveTeamStatus(team);
    if (status === 'completed' || status === 'cancelled') {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }
    if (status === 'expired' || isTeamExpired(team)) {
      return res.status(400).json({ error: 'Équipe expirée' });
    }
    if (status !== 'open' || (team.status && team.status !== 'open')) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }

    const participants = Array.isArray(team.participants) ? team.participants.slice() : [];

    // Doublon (une seule participation par utilisateur)
    if (participants.some((p) => Number(p && p.userId) === userId)) {
      return res.status(409).json({ error: 'Participation déjà enregistrée' });
    }

    // Capacité (créateur inclus) — max 10
    if (participants.length >= TEAM_MAX_PARTICIPANTS) {
      return res.status(400).json({ error: 'Équipe complète' });
    }

    participants.push({ userId, joinedAt: new Date().toISOString() });

    const updatedTeam = {
      ...team,
      promotionId: team.promotionId, // ne pas permettre de changer la promotion
      creatorId: team.creatorId,     // ne jamais modifier
      beneficiaryId: team.creatorId, // garantir beneficiaryId === creatorId
      participants,
      status: 'open',
    };

    teams[idx] = updatedTeam;
    writeJSONFile(TEAM_PURCHASES_FILE, teams);

    // FCM (best-effort, après sauvegarde, ajout réel uniquement): créateur + membres déjà présents, exclure le nouveau.
    try {
      const existingParticipantIds = (Array.isArray(team.participants) ? team.participants : [])
        .map((p) => parseInt(p && p.userId, 10))
        .filter((id) => Number.isFinite(id) && id > 0 && id !== userId);
      const recipients = resolveFcmUsersByIds(existingParticipantIds);
      if (recipients.length > 0) {
        sendFcmToUsers(recipients, {
          title: 'Nouvel équipier !',
          body: "Un nouveau membre vient de rejoindre votre équipe d'achat.",
          type: 'team_participant_joined',
          data: { teamId: String(teamId) },
        }).catch(() => {});
      }
    } catch (_) {}

    return res.json({ message: 'Participation enregistrée', team: buildTeamView(updatedTeam) });
  } catch (error) {
    console.error('Join team error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams/join-by-code — retrouver/rejoindre une équipe par code d'invitation (additif, navigation/UI)
app.post('/api/teams/join-by-code', authenticateToken, (req, res) => {
  try {
    const rawCode = req.body && (req.body.invitationCode || req.body.code);
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    if (!code) {
      return res.status(400).json({ error: 'Code d\'invitation requis' });
    }
    const userId = parseInt(req.user.id, 10);
    if (!userId || Number.isNaN(userId)) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }
    // Relire les données avant écriture (stockage JSON)
    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const idx = Array.isArray(teams)
      ? teams.findIndex((t) => t && typeof t.invitationCode === 'string' && t.invitationCode.trim().toUpperCase() === code.toUpperCase())
      : -1;
    if (idx === -1) {
      return res.status(404).json({ error: 'Équipe introuvable. Vérifiez le code d\'invitation.' });
    }
    const team = teams[idx];
    // Vérifier la promotion associée (ne pas changer la promotion)
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotion = Array.isArray(promotions)
      ? promotions.find((p) => parseInt(p.id, 10) === parseInt(team.promotionId, 10))
      : null;
    if (!promotion) {
      return res.status(400).json({ error: 'Promotion associée introuvable' });
    }
    // Garantir cohérence bénéficiaire/créateur (ne jamais modifier)
    if (Number(team.beneficiaryId) !== Number(team.creatorId)) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }
    const status = effectiveTeamStatus(team);
    if (status === 'completed' || status === 'cancelled') {
      return res.status(400).json({ error: 'Équipe terminée' });
    }
    if (status === 'expired' || isTeamExpired(team)) {
      return res.status(400).json({ error: 'Équipe expirée' });
    }
    if (status !== 'open' || (team.status && team.status !== 'open')) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }
    const participants = Array.isArray(team.participants) ? team.participants.slice() : [];
    // Idempotent (additif, route dédiée) : déjà membre -> renvoyer l'équipe pour navigation.
    if (participants.some((p) => Number(p && p.userId) === userId)) {
      return res.json({ message: 'Participation déjà enregistrée', team: buildTeamView(team) });
    }
    // Capacité (créateur inclus) — max 10
    if (participants.length >= TEAM_MAX_PARTICIPANTS) {
      return res.status(400).json({ error: 'Équipe complète' });
    }
    participants.push({ userId, joinedAt: new Date().toISOString() });
    const updatedTeam = {
      ...team,
      promotionId: team.promotionId, // ne pas permettre de changer la promotion
      creatorId: team.creatorId,     // ne jamais modifier
      beneficiaryId: team.creatorId, // garantir beneficiaryId === creatorId
      participants,
      status: 'open',
    };
    teams[idx] = updatedTeam;
    writeJSONFile(TEAM_PURCHASES_FILE, teams);

    // FCM (best-effort, après sauvegarde, ajout réel uniquement): créateur + membres déjà présents, exclure le nouveau.
    try {
      const existingParticipantIds = (Array.isArray(team.participants) ? team.participants : []).map((pp) => parseInt(pp && pp.userId, 10)).filter((id) => Number.isFinite(id) && id > 0 && id !== userId);
      const recipients = resolveFcmUsersByIds(existingParticipantIds);
      if (recipients.length > 0) {
        sendFcmToUsers(recipients, { title: 'Nouvel equipier !', body: "Un nouveau membre vient de rejoindre votre equipe d'achat.", type: 'team_participant_joined', data: { teamId: String(teamId) } }).catch(() => {});
      }
    } catch (_) {}
    return res.json({ message: 'Participation enregistrée', team: buildTeamView(updatedTeam) });
  } catch (error) {
    console.error('Join team by code error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teams/:id/status — progression d'une équipe (PHASE C)
app.get('/api/teams/:id/status', authenticateToken, async (req, res) => {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (!teamId || Number.isNaN(teamId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }

    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const idx = teams.findIndex((t) => parseInt(t.teamId, 10) === teamId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const team = teams[idx];
    const newStatus = effectiveTeamStatus(team);
    let currentTeam = team;
    if (team.status !== newStatus && team.status !== 'completed' && team.status !== 'cancelled') {
      teams[idx] = { ...team, status: newStatus };
      writeJSONFile(TEAM_PURCHASES_FILE, teams);
      currentTeam = teams[idx];
    }

    // Reprise idempotente lecture (best-effort, sans nouveau paiement) : si financée/non finalisée.
    if (!currentTeam.finalOrderId && currentTeam.status !== 'completed') {
      try { await tryFinalizeTeamPurchase(teamId); } catch (_) {}
      const _t2 = readJSONFile(TEAM_PURCHASES_FILE);
      const _i2 = Array.isArray(_t2) ? _t2.findIndex((t) => parseInt(t.teamId, 10) === teamId) : -1;
      if (_i2 !== -1) currentTeam = _t2[_i2];
    }

    const view = buildTeamView(currentTeam);
    // collectedAmount provient des paiements CONFIRMÉS — jamais d'intention de paiement.
    return res.json({
      teamId: view.teamId,
      promotionId: view.promotionId,
      creatorId: view.creatorId,
      beneficiaryId: view.beneficiaryId,
      targetAmount: view.targetAmount,
      collectedAmount: view.collectedAmount,
      remainingAmount: view.remainingAmount,
      participantsCount: view.participantsCount,
      maxParticipants: TEAM_MAX_PARTICIPANTS,
      createdAt: view.createdAt,
      expiresAt: view.expiresAt,
      status: view.status,
      isComplete: view.isComplete,
    });
  } catch (error) {
    console.error('Get team status error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ===== TEAM CHAT (F6-C HTTP routes only; no Socket.IO) =====
app.get('/api/teams/:id/messages', authenticateToken, (req, res) => {
  try {
    const rawId = String(req.params.id ?? '').trim();
    if (!/^[1-9]\d*$/.test(rawId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }
    const teamId = parseInt(rawId, 10);

    const team = findTeamById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const userId = parseInt(req.user.id, 10);
    if (!isTeamMember(team, userId)) {
      return res.status(403).json({ error: 'Accès refusé à cette équipe' });
    }

    const messages = readTeamMessagesFile()
      .filter((m) => m && parseInt(m.teamId, 10) === teamId)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    return res.json({ messages });
  } catch (error) {
    console.error('Get team messages error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/teams/:id/messages', authenticateToken, async (req, res) => {
  try {
    const rawId = String(req.params.id ?? '').trim();
    if (!/^[1-9]\d*$/.test(rawId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }
    const teamId = parseInt(rawId, 10);

    const team = findTeamById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const userId = parseInt(req.user.id, 10);
    if (!isTeamMember(team, userId)) {
      return res.status(403).json({ error: 'Accès refusé à cette équipe' });
    }

    if (isTeamChatReadOnly(team)) {
      return res.status(403).json({ error: 'Le chat est en lecture seule pour cette équipe' });
    }

    const text = sanitizeTeamMessageText(req.body && req.body.message);
    if (!text) {
      return res.status(400).json({ error: 'Message requis (1 à 1000 caractères)' });
    }

    const saved = await appendTeamMessageSerialized({ teamId, senderId: userId, message: text });
    if (!saved || !saved.ok || !saved.data) {
      return res.status(500).json({ error: 'Erreur lors de l\'enregistrement du message' });
    }

    // F6-D: diffusion uniquement aux membres de la room, après sauvegarde confirmée. Jamais global.
    try { io.to('team:' + teamId).emit('team_message', saved.data); } catch (_) {}

    return res.status(201).json({ message: 'Message envoyé', data: saved.data });
  } catch (error) {
    console.error('Post team message error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PHASE E: finalisation idempotente d'une Ã©quipe (appelÃ©e aprÃ¨s confirmation webhook)
// CrÃ©e UNE commande finale au nom du crÃ©ateur. Aucune garantie transactionnelle JSON.
// ===== TEAM CHAT (F6-B storage/helpers only; no routes/socket yet) =====
function readTeamMessagesFile() {
  const data = readJSONFile(TEAM_MESSAGES_FILE);
  return Array.isArray(data) ? data : [];
}

function findTeamById(teamIdInput) {
  const raw = String(teamIdInput ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const teamId = parseInt(raw, 10);
  const teams = readJSONFile(TEAM_PURCHASES_FILE);
  if (!Array.isArray(teams)) return null;
  return teams.find((t) => parseInt(t && t.teamId, 10) === teamId) || null;
}

function isTeamMember(team, userIdInput) {
  if (!team) return false;
  const userId = parseInt(userIdInput, 10);
  if (!userId || Number.isNaN(userId)) return false;
  if (Number(team.creatorId) === userId) return true;
  const participants = Array.isArray(team.participants) ? team.participants : [];
  return participants.some((p) => Number(p && p.userId) === userId);
}

function isTeamChatReadOnly(team) {
  if (!team) return true;
  const status = effectiveTeamStatus(team);
  return status === 'completed' || status === 'cancelled' || status === 'expired';
}

let teamMessagesWriteQueue = Promise.resolve();
function loadTeamMessagesForAppend(filePath) {
  // Lecture spécifique (ne pas utiliser readJSONFile: il retourne [] sur erreur de parsing/lecture).
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: 'invalid_json', detail: e && e.message ? e.message : 'parse_error' };
    }
    if (!Array.isArray(parsed)) return { ok: false, error: 'invalid_format' };
    return { ok: true, data: parsed };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, data: [], missing: true }; // fichier absent: init autorisée
    return { ok: false, error: 'read_error', detail: e && e.message ? e.message : 'read_error' };
  }
}

function appendTeamMessageSerialized(entry) {
  const op = () => {
    try {
      const loaded = loadTeamMessagesForAppend(TEAM_MESSAGES_FILE);
      // IMPORTANT: ne jamais écraser un historique illisible/corrompu.
      if (!loaded || !loaded.ok || !Array.isArray(loaded.data)) {
        const err = loaded && loaded.error ? loaded.error : 'read_error';
        console.error('appendTeamMessageSerialized: refuse append (history unreadable)', err, loaded && loaded.detail);
        return { ok: false, error: err };
      }
      const messages = loaded.data;
      const existingIds = new Set(messages.map((m) => String(m && m.id)));
      let id = Date.now();
      let attempts = 0;
      while (existingIds.has(String(id)) && attempts < 50) {
        id = Date.now() + attempts + 1;
        attempts++;
      }
      if (existingIds.has(String(id))) return { ok: false, error: 'id_generation_failed' };
      const created = {
        id,
        teamId: Number(entry.teamId),
        senderId: Number(entry.senderId),
        message: String(entry.message),
        createdAt: new Date().toISOString(),
      };
      messages.push(created);
      fs.writeFileSync(TEAM_MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
      return { ok: true, data: created };
    } catch (error) {
      console.error('appendTeamMessageSerialized error:', error);
      return { ok: false, error: error && error.message ? error.message : 'write_error' };
    }
  };
  // File sérialisée (même processus). La queue est réarmée même en cas d'erreur.
  const p = teamMessagesWriteQueue.then(op, op);
  teamMessagesWriteQueue = p.then(() => undefined, () => undefined);
  return p;
}

function sanitizeTeamMessageText(textInput) {
  if (typeof textInput !== 'string') return null;
  const text = textInput.trim();
  if (!text) return null;
  if (text.length > 1000) return null;
  return text;
}

async function tryFinalizeTeamPurchase(teamIdInput) {
  const teamId = parseInt(teamIdInput, 10);
  if (!teamId || Number.isNaN(teamId)) return { ok: false, reason: 'invalid_team' };

  const teams = readJSONFile(TEAM_PURCHASES_FILE);
  const tIdx = Array.isArray(teams) ? teams.findIndex((t) => parseInt(t.teamId, 10) === teamId) : -1;
  if (tIdx === -1) return { ok: false, reason: 'team_not_found' };

  const team = teams[tIdx];
  // Idempotence: déjà finalisée ou commande finale existante
  if (team.finalOrderId || team.status === 'completed') {
    return { ok: true, reason: 'already_completed', finalOrderId: team.finalOrderId || null };
  }
  if (team.status === 'cancelled' || effectiveTeamStatus(team) === 'expired' || isTeamExpired(team)) {
    return { ok: false, reason: 'team_not_eligible' };
  }
  if (Number(team.beneficiaryId) !== Number(team.creatorId)) {
    return { ok: false, reason: 'beneficiary_mismatch' };
  }

  const targetAmount = Number(team.targetAmount || 0);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    return { ok: false, reason: 'invalid_target' };
  }

  // Recalcul serveur depuis contributions CONFIRMÉES uniquement
  const payments = readJSONFile(TEAM_PAYMENTS_FILE);
  const arrPayments = Array.isArray(payments) ? payments : [];
  const confirmedSum = arrPayments
    .filter((p) => p && parseInt(p.teamId, 10) === teamId && p.paymentStatus === 'confirmed')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  if (confirmedSum < targetAmount) {
    // garder collectedAmount cohérent
    if (Number(team.collectedAmount) !== confirmedSum) {
      teams[tIdx] = { ...team, collectedAmount: confirmedSum };
      if ((await writeJSONFile(TEAM_PURCHASES_FILE, teams)) === false) throw new Error('team_finalize_write_error');
    }
    return { ok: false, reason: 'not_funded', collectedAmount: confirmedSum };
  }

  // Vérifier si une commande finale équipe existe déjà (garde doublon)
  const orders = readJSONFile(ORDERS_FILE);
  const existingTeamOrder = Array.isArray(orders)
    ? orders.find((o) => o && (o.teamPurchaseId == teamId || o.teamId == teamId) && o.purchaseType === 'team_purchase')
    : null;
  if (existingTeamOrder) {
    teams[tIdx] = { ...team, collectedAmount: confirmedSum, status: 'completed', finalOrderId: existingTeamOrder.id };
    if ((await writeJSONFile(TEAM_PURCHASES_FILE, teams)) === false) throw new Error('team_finalize_write_error');
    return { ok: true, reason: 'existing_order_linked', finalOrderId: existingTeamOrder.id };
  }

  const promotions = readJSONFile(PROMOTIONS_FILE);
  const promotion = Array.isArray(promotions)
    ? promotions.find((p) => parseInt(p.id, 10) === parseInt(team.promotionId, 10))
    : null;
  if (!promotion) {
    return { ok: false, reason: 'promotion_not_found' };
  }
  // Note: promotion désactivée après création n'empêche pas la finalisation si paiements confirmés suffisent.

  const users = readJSONFile(USERS_FILE);
  const creatorId = parseInt(team.creatorId, 10);
  const creator = Array.isArray(users) ? users.find((u) => parseInt(u.id, 10) === creatorId) : null;
  if (!creator) {
    return { ok: false, reason: 'creator_not_found' };
  }

  const adminUser = Array.isArray(users) ? users.find((u) => u.role === 'admin') : null;
  const seller = adminUser?.id || promotion.vendeur || null;
  const itemPrice = Number(promotion.discountedPrice != null ? promotion.discountedPrice : promotion.price);
  const unitPrice = Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : targetAmount;

  const validatedItems = [{
    id: promotion.id,
    price: unitPrice,
    seller,
    name: promotion.name,
    image: promotion.image,
    categorie: promotion.categorie,
    vendeurNom: 'Djassa CI',
    vendeurCompte: '',
    quantite: 1,
  }];

  const subtotal = validatedItems.reduce((sum, item) => sum + item.price * (item.quantite || 1), 0);
  const commissionRate = 0.05;
  const commission = subtotal * commissionRate;
  const total = subtotal + commission; // 5% appliquée une seule fois (comme commande individuelle)

  const nowIso = new Date().toISOString();
  const finalOrderId = Date.now();
  const confirmedContribRefs = arrPayments
    .filter((p) => p && parseInt(p.teamId, 10) === teamId && p.paymentStatus === 'confirmed')
    .map((p) => ({ paymentId: p.paymentId, transactionReference: p.transactionReference, amount: p.amount, participantId: p.participantId }));

  // Structure alignée sur POST /api/orders (champs additifs pour traçabilité, sans casser l'existant)
  const finalOrder = {
    id: finalOrderId,
    transaction_id: `TEAM-${teamId}-${finalOrderId}`,
    utilisateurId: creatorId, // créateur = unique bénéficiaire/propriétaire
    seller,
    articles: validatedItems,
    total,
    date: nowIso,
    statut: 'payée', // contributions déjà confirmées
    statutVendeur: 'a_payer_vendeur',
    methodePaiement: 'team_contribution',
    numeroPaiement: creator.numero || creator.phone || '',
    nomCompte: creator.nom || creator.name || creator.username || '',
    nomLivraison: null,
    telLivraison: null,
    villeCommune: null,
    quartier: null,
    buyerLat: null,
    buyerLng: null,
    // champs additifs traçabilité (lecture optionnelle par clients existants)
    purchaseType: 'team_purchase',
    teamId,
    teamPurchaseId: teamId,
    beneficiaryId: creatorId,
    teamContributions: confirmedContribRefs,
    teamCollectedAmount: confirmedSum,
    teamTargetAmount: targetAmount,
  };

  const allOrders = Array.isArray(orders) ? orders : [];
  allOrders.push(finalOrder);
  // Écriture commande CRITIQUE : ne jamais marquer l'équipe complétée si la commande n'est pas persistée.
  if ((await writeJSONFile(ORDERS_FILE, allOrders)) === false) throw new Error('team_finalize_order_write_error');

  // Mettre à jour l'équipe. Si cette écriture échoue après commande persistée, la garde doublon
  // (commande team_purchase existante) reliera au prochain appel (reprise idempotente, sans nouveau paiement).
  teams[tIdx] = {
    ...team,
    collectedAmount: confirmedSum,
    status: 'completed',
    finalOrderId,
    completedAt: nowIso,
    goalNotifiedAt: team.goalNotifiedAt || nowIso,
    orderNotifiedAt: team.orderNotifiedAt || nowIso,
  };
  if ((await writeJSONFile(TEAM_PURCHASES_FILE, teams)) === false) throw new Error('team_finalize_write_error');

  // Notifications (best-effort, idempotence finale protège contre doublons d'ordre; garde persistée orderNotifiedAt/goalNotifiedAt).
  try { io.emit('payment_update', { teamId: String(teamId), orderId: String(finalOrderId), status: 'completed' }); } catch (_) {}
  try {
    const _allParts = Array.isArray(team.participants) ? team.participants.map((p)=>parseInt(p&&p.userId,10)).filter((id)=>Number.isFinite(id)&&id>0) : [];
    const _users = readJSONFile(USERS_FILE) || [];
    const _byId = new Map(_users.map((u)=>[parseInt(u&&u.id,10),u]));
    for (const uid of _allParts) {
      const u = _byId.get(uid); if (!u || !u.fcmToken) continue;
      if (!team.goalNotifiedAt) sendFcmToToken(u.fcmToken,{title:"Objectif atteint",body:"L'objectif de l'équipe est atteint.",type:"team_goal_reached",data:{teamId:String(teamId)}}).catch(()=>{});
      if (!team.orderNotifiedAt) {
        sendFcmToToken(u.fcmToken,{title:"Commande créée",body:`Commande #${finalOrderId} créée pour votre équipe.`,type:"team_order_created",data:{teamId:String(teamId),orderId:String(finalOrderId)}}).catch(()=>{});
        // compat existant (créateur / clients historiques)
        if (uid === parseInt(creatorId,10)) sendFcmToToken(u.fcmToken,{title:"Achat en équipe réussi",body:`Objectif atteint ! Votre commande #${finalOrderId} a été créée.`,type:"team_purchase_completed",data:{orderId:String(finalOrderId),teamId:String(teamId)}}).catch(()=>{});
      }
    }
  } catch (_) {}

  return { ok: true, reason: 'finalized', finalOrderId };
}

// POST /api/teams/:id/contributions/init — initier une cotisation GeniusPay (PHASE D1, sécurisée)
// Réservation locale "initializing" AVANT appel GeniusPay. Aucune confirmation de paiement ici.
app.post('/api/teams/:id/contributions/init', authenticateToken, async (req, res) => {
  let paymentId = null;
  try {
    const teamId = parseInt(req.params.id, 10);
    if (!teamId || Number.isNaN(teamId)) {
      return res.status(400).json({ error: 'Identifiant équipe invalide' });
    }

    const participantId = parseInt(req.user.id, 10);
    if (!participantId || Number.isNaN(participantId)) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    const rawAmount = req.body.amount;
    const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Montant de cotisation invalide' });
    }

    // Relire les données avant traitement (stockage JSON)
    const teams = readJSONFile(TEAM_PURCHASES_FILE);
    const idx = teams.findIndex((t) => parseInt(t.teamId, 10) === teamId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Équipe introuvable' });
    }

    const team = teams[idx];

    // Bénéficiaire toujours le créateur
    if (Number(team.beneficiaryId) !== Number(team.creatorId)) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }

    const status = effectiveTeamStatus(team);
    if (status === 'completed' || status === 'cancelled') {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }
    if (status === 'expired' || isTeamExpired(team)) {
      return res.status(400).json({ error: 'Équipe expirée' });
    }
    if (status !== 'open' || (team.status && team.status !== 'open')) {
      return res.status(400).json({ error: 'Équipe non disponible' });
    }

    // Utilisateur membre de l'équipe
    const participants = Array.isArray(team.participants) ? team.participants : [];
    if (!participants.some((p) => Number(p && p.userId) === participantId)) {
      return res.status(403).json({ error: 'Vous devez rejoindre l\'équipe avant de cotiser' });
    }

    // Promotion associée toujours valide (cohérence)
    const promotions = readJSONFile(PROMOTIONS_FILE);
    const promotion = promotions.find((p) => parseInt(p.id, 10) === parseInt(team.promotionId, 10));
    if (!promotion) {
      return res.status(400).json({ error: 'Promotion associée introuvable' });
    }
    if (promotion.isActive === false) {
      return res.status(400).json({ error: 'Promotion indisponible' });
    }

    const targetAmount = Number(team.targetAmount || 0);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      return res.status(400).json({ error: 'Objectif d\'équipe invalide' });
    }

    // Réserver le montant restant : confirmed + (pending + initializing) = réservations
    // Jamais comptabiliser pending/initializing comme contribution confirmée.
    const payments = readJSONFile(TEAM_PAYMENTS_FILE);
    const allPayments = Array.isArray(payments) ? payments : [];
    const teamPayments = allPayments.filter((p) => parseInt(p.teamId, 10) === teamId);
    const confirmedSum = teamPayments
      .filter((p) => p && p.paymentStatus === 'confirmed')
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const reservedSum = teamPayments
      .filter((p) => p && (p.paymentStatus === 'pending' || p.paymentStatus === 'initializing'))
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const reservedRemaining = Math.max(0, targetAmount - confirmedSum - reservedSum);

    if (reservedRemaining <= 0) {
      return res.status(400).json({ error: 'L\'objectif de l\'équipe est déjà atteint ou réservé' });
    }
    if (amount > reservedRemaining) {
      return res.status(400).json({
        error: 'Montant supérieur au reste disponible (réservations prises en compte)',
        remainingAmount: reservedRemaining,
      });
    }

    const users = readJSONFile(USERS_FILE);
    const user = users.find((u) => parseInt(u.id, 10) === participantId);
    const customerName = (user && (user.nom || user.name || user.username)) || `Participant ${participantId}`;
    const rawPhone = (user && (user.numero || user.phone || user.telephone)) || (req.body.phone || '');
    const phone = String(rawPhone).trim();

    // Générer paymentId unique
    const existingPaymentIds = new Set(teamPayments.map((p) => String(p.paymentId)));
    paymentId = Date.now();
    let pidAttempts = 0;
    while (existingPaymentIds.has(String(paymentId)) && pidAttempts < 20) {
      paymentId = Date.now() + pidAttempts + 1;
      pidAttempts++;
    }
    if (existingPaymentIds.has(String(paymentId))) {
      paymentId = null;
      return res.status(500).json({ error: 'Impossible de générer un identifiant de cotisation unique' });
    }

    const nowIso = new Date().toISOString();
    // 1) Réservation locale AVANT appel GeniusPay (statut initializing) — historique préservé
    const reservation = {
      paymentId,
      teamId,
      participantId,
      amount,
      transactionReference: null,
      paymentStatus: 'initializing',
      createdAt: nowIso,
      confirmedAt: null,
      failedAt: null,
      updatedAt: nowIso,
      provider: 'geniuspay',
    };

    // Cohérence stricte: teamId/participantId associés à cette réservation
    if (parseInt(reservation.teamId, 10) !== teamId || parseInt(reservation.participantId, 10) !== participantId) {
      paymentId = null;
      return res.status(400).json({ error: 'Réservation incohérente' });
    }

    allPayments.push(reservation);
    writeJSONFile(TEAM_PAYMENTS_FILE, allPayments);

    const description = `Cotisation équipe ${teamId} - paiement ${paymentId}`;
    const metadata = {
      payment_type: 'team_contribution',
      team_id: String(teamId),
      contribution_id: String(paymentId),
      participant_id: String(participantId),
      promotion_id: String(team.promotionId),
    };

    // Appel GeniusPay (mêmes credentials/endpoint) — format de réponse comparé aux routes existantes
    const payload = {
      amount: amount,
      description,
      customer: {
        name: customerName,
        phone: phone.startsWith('+') ? phone : (phone ? `+225${phone}` : ''),
      },
      metadata,
    };

    let response;
    let data = null;
    try {
      response = await fetch('https://geniuspay.ci/api/v1/merchant/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': GENIUSPAY_API_KEY,
          'X-API-Secret': GENIUSPAY_SECRET_KEY,
        },
        body: JSON.stringify(payload),
      });
      data = await response.json().catch(() => null);
    } catch (fetchError) {
      // Échec appel GeniusPay: marquer failed, libérer réservation, préserver historique
      const paymentsFail = readJSONFile(TEAM_PAYMENTS_FILE);
      const arrFail = Array.isArray(paymentsFail) ? paymentsFail : [];
      const fIdx = arrFail.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
      if (fIdx !== -1 && arrFail[fIdx].paymentStatus === 'initializing') {
        arrFail[fIdx] = { ...arrFail[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: 'geniuspay_request_error' };
        writeJSONFile(TEAM_PAYMENTS_FILE, arrFail);
      }
      return res.status(400).json({ success: false, error: 'Initialisation GeniusPay échouée' });
    }

    const checkoutUrl = data && data.data && data.data.checkout_url;
    const referenceRaw = data && data.data && data.data.reference;
    const reference = typeof referenceRaw === 'string' ? referenceRaw.trim() : '';

    // Exiger réponse valide + référence non vide (ne jamais inventer de référence)
    if (!response || !response.ok || !data || data.success !== true || typeof checkoutUrl !== 'string' || !checkoutUrl || !reference) {
      const paymentsFail = readJSONFile(TEAM_PAYMENTS_FILE);
      const arrFail = Array.isArray(paymentsFail) ? paymentsFail : [];
      const fIdx = arrFail.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
      if (fIdx !== -1 && arrFail[fIdx].paymentStatus === 'initializing') {
        arrFail[fIdx] = { ...arrFail[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: (!reference ? 'missing_reference' : 'geniuspay_invalid_response') };
        writeJSONFile(TEAM_PAYMENTS_FILE, arrFail);
      }
      return res.status(400).json({ success: false, error: 'Initialisation GeniusPay échouée' });
    }

    // Empêcher duplication des références (toutes tentatives confondues)
    const paymentsRef = readJSONFile(TEAM_PAYMENTS_FILE);
    const arrRef = Array.isArray(paymentsRef) ? paymentsRef : [];
    const refOwner = arrRef.find((p) => p && p.transactionReference === reference);
    if (refOwner && parseInt(refOwner.paymentId, 10) !== parseInt(paymentId, 10)) {
      const fIdx = arrRef.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
      if (fIdx !== -1 && arrRef[fIdx].paymentStatus === 'initializing') {
        arrRef[fIdx] = { ...arrRef[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: 'duplicate_reference' };
        writeJSONFile(TEAM_PAYMENTS_FILE, arrRef);
      }
      return res.status(409).json({ error: 'Référence de transaction déjà enregistrée' });
    }

    // Re-vérifier contraintes clés avant passage pending (fenêtre de concurrence JSON)
    const teamsAfter = readJSONFile(TEAM_PURCHASES_FILE);
    const idxAfter = teamsAfter.findIndex((t) => parseInt(t.teamId, 10) === teamId);
    if (idxAfter === -1) {
      const fIdx = arrRef.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
      if (fIdx !== -1 && arrRef[fIdx].paymentStatus === 'initializing') {
        arrRef[fIdx] = { ...arrRef[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: 'team_missing' };
        writeJSONFile(TEAM_PAYMENTS_FILE, arrRef);
      }
      return res.status(409).json({ error: 'Équipe introuvable après initialisation paiement' });
    }
    const teamAfter = teamsAfter[idxAfter];
    const statusAfter = effectiveTeamStatus(teamAfter);
    if (statusAfter !== 'open' || isTeamExpired(teamAfter) || Number(teamAfter.beneficiaryId) !== Number(teamAfter.creatorId)) {
      const fIdx = arrRef.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
      if (fIdx !== -1 && arrRef[fIdx].paymentStatus === 'initializing') {
        arrRef[fIdx] = { ...arrRef[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: 'team_unavailable' };
        writeJSONFile(TEAM_PAYMENTS_FILE, arrRef);
      }
      return res.status(409).json({ error: 'Équipe non disponible après initialisation paiement' });
    }

    // Réponse GeniusPay valide + référence présente → passer initializing -> pending (même enregistrement, historique préservé)
    const paymentsFinal = readJSONFile(TEAM_PAYMENTS_FILE);
    const arrFinal = Array.isArray(paymentsFinal) ? paymentsFinal : [];
    const tIdx = arrFinal.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
    if (tIdx === -1) {
      return res.status(500).json({ error: 'Réservation introuvable' });
    }
    const rec = arrFinal[tIdx];
    if (parseInt(rec.teamId, 10) !== teamId || parseInt(rec.participantId, 10) !== participantId) {
      return res.status(400).json({ error: 'Réservation incohérente' });
    }
    // Ne pas modifier le montant cible de l'équipe ; pending != confirmé
    arrFinal[tIdx] = {
      ...rec,
      transactionReference: reference,
      paymentStatus: 'pending',
      updatedAt: new Date().toISOString(),
      checkoutInitializedAt: new Date().toISOString(),
    };
    writeJSONFile(TEAM_PAYMENTS_FILE, arrFinal);

    // FCM (best-effort, après init réussie + référence/checkout valides): contribution initiée (en attente), jamais "confirmée".
    try {
      if (user) {
        sendFcmToToken(user.fcmToken, {
          title: 'Contribution initiée',
          body: 'Votre paiement est en attente de confirmation.',
          type: 'team_contribution_initiated',
          data: { teamId: String(teamId), contributionId: String(paymentId) },
        }).catch(() => {});
      }
    } catch (_) {}

    return res.json({
      success: true,
      checkout_url: checkoutUrl,
      reference,
      contribution: {
        paymentId,
        teamId,
        participantId,
        amount: rec.amount,
        paymentStatus: 'pending',
      },
    });
  } catch (error) {
    console.error('Team contribution init error:', error);
    // Best-effort: libérer réservation initializing en cas d'erreur inattendue (historique préservé)
    try {
      if (paymentId != null) {
        const paymentsFail = readJSONFile(TEAM_PAYMENTS_FILE);
        const arrFail = Array.isArray(paymentsFail) ? paymentsFail : [];
        const fIdx = arrFail.findIndex((p) => parseInt(p.paymentId, 10) === parseInt(paymentId, 10));
        if (fIdx !== -1 && arrFail[fIdx].paymentStatus === 'initializing') {
          arrFail[fIdx] = { ...arrFail[fIdx], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: 'unexpected_error' };
          writeJSONFile(TEAM_PAYMENTS_FILE, arrFail);
        }
      }
    } catch (_) {}
    return res.status(500).json({ error: 'Server error' });
  }
});


// ===== "ACHETER PETIT A PETIT" (promotion savings) — additif, isole team/order/classique =====
// payment_type: promotion_savings_contribution. Confirmation UNIQUEMENT via webhook HMAC+dedup.
let promotionSavingsWriteQueue = Promise.resolve();

function loadPromotionSavingsFileSafe(filePath) {
  // Ne pas utiliser readJSONFile ici: il retourne [] sur erreur de parse/lecture (risque ecrasement).
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { ok: false, error: 'invalid_json', detail: e && e.message ? e.message : 'parse_error' }; }
    if (!Array.isArray(parsed)) return { ok: false, error: 'invalid_format' };
    return { ok: true, data: parsed };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, data: [], missing: true };
    return { ok: false, error: 'read_error', detail: e && e.message ? e.message : 'read_error' };
  }
}

function runPromotionSavingsSerialized(op) {
  const p = promotionSavingsWriteQueue.then(op, op);
  promotionSavingsWriteQueue = p.then(() => undefined, () => undefined);
  return p;
}

// Helpers savings (additifs): mutations de statut contribution avec ecriture verifiee.
// A appeler UNIQUEMENT depuis une operation deja serialisee (runPromotionSavingsSerialized)
// ou comme unique op passee a runPromotionSavingsSerialized (jamais imbrique).
function markSavingsContributionFailedIfInitializing(paymentId, reason) {
  const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
  if (!paysL.ok) return { ok: false, error: 'storage_unreadable' };
  const arr = paysL.data;
  const i = arr.findIndex((p) => parseInt(p && p.paymentId, 10) === parseInt(paymentId, 10));
  if (i === -1) return { ok: false, error: 'not_found' };
  const st = arr[i].paymentStatus;
  if (st === 'confirmed' || st === 'pending') return { ok: false, skipped: true, status: st }; // ne jamais ecraser confirmed; pending = reference potentiellement payable
  if (st !== 'initializing') return { ok: false, skipped: true, status: st };
  arr[i] = { ...arr[i], paymentStatus: 'failed', failedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: reason || 'init_failed' };
  try { fs.writeFileSync(PROMOTION_SAVINGS_PAYMENTS_FILE, JSON.stringify(arr, null, 2), 'utf8'); } catch (e) { console.error('savings mark failed write error:', e && e.message ? e.message : e); return { ok: false, error: 'write_error' }; }
  return { ok: true };
}

function markSavingsContributionPending(paymentId, reference, checkoutUrl) {
  const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
  if (!paysL.ok) return { ok: false, error: 'storage_unreadable' };
  const arr = paysL.data;
  const i = arr.findIndex((p) => parseInt(p && p.paymentId, 10) === parseInt(paymentId, 10));
  if (i === -1) return { ok: false, error: 'not_found' };
  const st = arr[i].paymentStatus;
  if (st === 'confirmed') return { ok: true, already: true };
  if (st === 'pending' && String(arr[i].transactionReference || '') === String(reference || '')) return { ok: true, already: true };
  if (st !== 'initializing') return { ok: false, skipped: true, status: st };
  arr[i] = { ...arr[i], paymentStatus: 'pending', transactionReference: String(reference || '').trim(), checkoutUrl, updatedAt: new Date().toISOString() };
  try { fs.writeFileSync(PROMOTION_SAVINGS_PAYMENTS_FILE, JSON.stringify(arr, null, 2), 'utf8'); } catch (e) { console.error('savings mark pending write error:', e && e.message ? e.message : e); return { ok: false, error: 'write_error' }; }
  return { ok: true };
}

function normalizePositiveInt(input) {
  const raw = String(input ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return parseInt(raw, 10);
}

function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function computePromotionSavingsTargetServer(promotion) {
  const v = computePromotionTargetAmountServer(promotion);
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return null;
  return roundMoney2(v);
}

function buildPromotionSavingsPlanView(plan, payments) {
  const arr = Array.isArray(payments) ? payments : [];
  const planId = parseInt(plan && plan.planId, 10);
  const confirmed = arr.filter((p) => p && parseInt(p.planId, 10) === planId && p.paymentStatus === 'confirmed');
  const collected = roundMoney2(confirmed.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const target = roundMoney2(plan.targetAmount || 0);
  const remaining = roundMoney2(Math.max(0, target - collected));
  const progress = target > 0 ? Math.min(1, collected / target) : 0;
  const contributions = arr
    .filter((p) => p && parseInt(p.planId, 10) === planId)
    .map((p) => ({
      paymentId: p.paymentId, planId: p.planId, amount: p.amount,
      paymentStatus: p.paymentStatus,
      transactionReference: p.transactionReference || null,
      createdAt: p.createdAt || null, confirmedAt: p.confirmedAt || null, failedAt: p.failedAt || null,
    }))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return {
    planId: plan.planId, userId: plan.userId, promotionId: plan.promotionId,
    promotionName: plan.promotionName || null,
    targetAmount: target, collectedAmount: collected, remainingAmount: remaining,
    progress, isComplete: collected >= target && target > 0,
    status: plan.status || 'active', finalOrderId: plan.finalOrderId || null,
    createdAt: plan.createdAt || null, updatedAt: plan.updatedAt || null, completedAt: plan.completedAt || null,
    contributions,
  };
}

function tryFinalizePromotionSavingsPlan(planIdInput) {
  return runPromotionSavingsSerialized(async () => {
    try {
      const planId = normalizePositiveInt(planIdInput);
      if (!planId) return { ok: false, reason: 'invalid_plan' };
      const plansL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_FILE);
      const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
      if (!plansL.ok || !paysL.ok) return { ok: false, reason: 'storage_unreadable' };
      const plans = plansL.data; const payments = paysL.data;
      const idx = plans.findIndex((p) => parseInt(p && p.planId, 10) === planId);
      if (idx === -1) return { ok: false, reason: 'plan_not_found' };
      const plan = plans[idx];
      if (plan.finalOrderId || plan.status === 'completed') {
        return { ok: true, reason: 'already_completed', finalOrderId: plan.finalOrderId || null };
      }
      const confirmedSum = roundMoney2(payments
        .filter((p) => p && parseInt(p.planId, 10) === planId && p.paymentStatus === 'confirmed')
        .reduce((s, p) => s + (Number(p.amount) || 0), 0));
      const target = roundMoney2(plan.targetAmount || 0);
      plans[idx] = { ...plan, collectedAmount: confirmedSum, remainingAmount: roundMoney2(Math.max(0, target - confirmedSum)), updatedAt: new Date().toISOString() };
      // Ecriture critique: ne jamais signaler un succes si la persistence echoue.
      if (target <= 0 || confirmedSum < target) {
        try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (we) { console.error('savings finalize write error:', we && we.message); throw new Error('savings_write_error'); }
        return { ok: false, reason: 'not_funded', collectedAmount: confirmedSum };
      }
      const orders = readJSONFile(ORDERS_FILE);
      const arrOrders = Array.isArray(orders) ? orders : [];
      const existing = arrOrders.find((o) => o && o.purchaseType === 'promotion_savings' && parseInt(o.planId, 10) === planId);
      if (existing) {
        // Idempotence: commande deja creee -> lier le plan (ne jamais creer une 2e commande).
        plans[idx] = { ...plans[idx], collectedAmount: confirmedSum, remainingAmount: 0, status: 'completed', finalOrderId: existing.id, completedAt: plans[idx].completedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), ...(plans[idx].goalNotifiedAt ? { goalNotifiedAt: plans[idx].goalNotifiedAt } : {}), ...(plans[idx].orderNotifiedAt ? { orderNotifiedAt: plans[idx].orderNotifiedAt } : {}) };
        try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (we) { console.error('savings finalize write error:', we && we.message); throw new Error('savings_write_error'); }
        return { ok: true, reason: 'existing_order_linked', finalOrderId: existing.id };
      }
      const promotions = readJSONFile(PROMOTIONS_FILE);
      const promotion = Array.isArray(promotions) ? promotions.find((p) => parseInt(p && p.id, 10) === parseInt(plan.promotionId, 10)) : null;
      if (!promotion) { try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (_) {} return { ok: false, reason: 'promotion_not_found' }; }
      const users = readJSONFile(USERS_FILE);
      const ownerId = parseInt(plan.userId, 10);
      const owner = Array.isArray(users) ? users.find((u) => parseInt(u && u.id, 10) === ownerId) : null;
      if (!owner) { try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (_) {} return { ok: false, reason: 'owner_not_found' }; }
      // Re-verification idempotente juste avant creation (fenetre de concurrence JSON, mono-instance).
      const ordersRe = readJSONFile(ORDERS_FILE);
      const arrOrdersRe = Array.isArray(ordersRe) ? ordersRe : [];
      const existingRe = arrOrdersRe.find((o) => o && o.purchaseType === 'promotion_savings' && parseInt(o.planId, 10) === planId);
      if (existingRe) {
        plans[idx] = { ...plans[idx], collectedAmount: confirmedSum, remainingAmount: 0, status: 'completed', finalOrderId: existingRe.id, completedAt: plans[idx].completedAt || new Date().toISOString(), updatedAt: new Date().toISOString(), ...(plans[idx].goalNotifiedAt ? { goalNotifiedAt: plans[idx].goalNotifiedAt } : {}), ...(plans[idx].orderNotifiedAt ? { orderNotifiedAt: plans[idx].orderNotifiedAt } : {}) };
        try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (we) { console.error('savings finalize write error:', we && we.message); throw new Error('savings_write_error'); }
        return { ok: true, reason: 'existing_order_linked', finalOrderId: existingRe.id };
      }
      const adminUser = Array.isArray(users) ? users.find((u) => u.role === 'admin') : null;
      const seller = adminUser?.id || promotion.vendeur || null;
      const itemPrice = roundMoney2(target);
      const validatedItems = [{ id: promotion.id, price: itemPrice, seller, name: promotion.name, image: promotion.image, categorie: promotion.categorie, vendeurNom: 'Djassa CI', vendeurCompte: '', quantite: 1 }];
      const subtotal = itemPrice; const commission = roundMoney2(subtotal * 0.05); const total = roundMoney2(subtotal + commission);
      let finalOrderId = Date.now(); let idTry = 0;
      while (arrOrdersRe.some((o) => o && parseInt(o.id, 10) === finalOrderId) && idTry < 50) { finalOrderId = Date.now() + idTry + 1; idTry++; }
      if (arrOrdersRe.some((o) => o && parseInt(o.id, 10) === finalOrderId)) throw new Error('savings_order_id_collision');
      const nowIso = new Date().toISOString();
      const confirmedRefs = payments.filter((p) => p && parseInt(p.planId, 10) === planId && p.paymentStatus === 'confirmed')
        .map((p) => ({ paymentId: p.paymentId, transactionReference: p.transactionReference, amount: p.amount }));
      arrOrdersRe.push({
        id: finalOrderId, transaction_id: `SAVINGS-${planId}-${finalOrderId}`, utilisateurId: ownerId, seller,
        articles: validatedItems, total, date: nowIso, statut: 'payÃ©e', statutVendeur: 'a_payer_vendeur',
        methodePaiement: 'promotion_savings', numeroPaiement: owner.numero || owner.phone || '',
        nomCompte: owner.nom || owner.name || owner.username || '',
        nomLivraison: null, telLivraison: null, villeCommune: null, quartier: null, buyerLat: null, buyerLng: null,
        purchaseType: 'promotion_savings', planId, promotionId: plan.promotionId,
        savingsContributions: confirmedRefs, savingsCollectedAmount: confirmedSum, savingsTargetAmount: target,
      });
      // Ecriture commande critique: si elle echoue, ne JAMAIS marquer le plan complete.
      let ordersWritten = false;
      try { ordersWritten = ((await writeJSONFile(ORDERS_FILE, arrOrdersRe)) === true); } catch (oe) { console.error('savings finalize: order write threw:', oe && oe.message ? oe.message : oe); ordersWritten = false; }
      if (!ordersWritten) { console.error('savings finalize: order write failed, plan kept non-completed'); throw new Error('savings_order_write_error'); }
      // La commande finale est enregistree: marquer le plan complete. Si cette ecriture echoue, la commande reste source de verite et la prochaine tentative reliera via idempotence.
      plans[idx] = { ...plans[idx], collectedAmount: confirmedSum, remainingAmount: 0, status: 'completed', finalOrderId, completedAt: nowIso, updatedAt: nowIso, goalNotifiedAt: plan.goalNotifiedAt || nowIso, orderNotifiedAt: plan.orderNotifiedAt || nowIso };
      try { fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8'); } catch (we) { console.error('savings finalize: plan write failed after order written (idempotent link on retry):', we && we.message); throw new Error('savings_plan_write_error'); }
      try { io.emit('payment_update', { orderId: String(finalOrderId), planId: String(planId), status: 'completed' }); } catch (_) {}
      // Notifications (best-effort): garde persistée goalNotifiedAt/orderNotifiedAt (idempotence tryFinalize + relink). Ne jamais interrompre la finalisation.
      if (!plan.goalNotifiedAt || !plan.orderNotifiedAt) {
        try {
          if (owner && owner.fcmToken) {
            if (!plan.goalNotifiedAt) sendFcmToToken(owner.fcmToken,{title:"Objectif atteint",body:"Votre objectif d'épargne est atteint.",type:"savings_goal_reached",data:{planId:String(planId)}}).catch(()=>{});
            if (!plan.orderNotifiedAt) {
              sendFcmToToken(owner.fcmToken,{title:"Commande créée",body:`Commande #${finalOrderId} créée pour votre achat petit à petit.`,type:"savings_order_created",data:{planId:String(planId),orderId:String(finalOrderId)}}).catch(()=>{});
              sendFcmToToken(owner.fcmToken,{title:"Achat petit a petit termine",body:`Objectif atteint ! Votre commande #${finalOrderId} a ete creee.`,type:"promotion_savings_completed",data:{orderId:String(finalOrderId),planId:String(planId)}}).catch(()=>{});
            }
          }
        } catch (_) {}
      }
      return { ok: true, reason: 'completed', finalOrderId };
    } catch (e) {
      console.error('tryFinalizePromotionSavingsPlan error:', e && e.message ? e.message : e);
      // Propager les erreurs de stockage/ecriture critiques pour que l'appelant (webhook) renvoie 500 (retriable). Idempotence/gardes preservent la surete.
      if (e && typeof e.message === 'string' && (e.message === 'savings_storage_unreadable' || e.message.indexOf('savings_') === 0)) throw e;
      return { ok: false, reason: 'error' };
    }
  });
}

app.post('/api/promotions/:promotionId/savings', authenticateToken, async (req, res) => {
  try {
    const promotionId = normalizePositiveInt(req.params.promotionId);
    if (!promotionId) return res.status(400).json({ error: 'Identifiant promotion invalide' });
    const userId = normalizePositiveInt(req.user && req.user.id);
    if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifie' });
    const result = await runPromotionSavingsSerialized(() => {
      try {
        const promotions = readJSONFile(PROMOTIONS_FILE);
        const promotion = Array.isArray(promotions) ? promotions.find((p) => parseInt(p && p.id, 10) === promotionId) : null;
        if (!promotion) return { status: 404, body: { error: 'Promotion introuvable' } };
        if (promotion.isActive === false) return { status: 400, body: { error: 'Promotion indisponible' } };
        const targetAmount = computePromotionSavingsTargetServer(promotion);
        if (!targetAmount || targetAmount <= 0) return { status: 400, body: { error: 'Prix promotionnel invalide' } };
        const plansL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_FILE);
        const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
        if (!plansL.ok || !paysL.ok) return { status: 500, body: { error: 'Stockage indisponible' } };
        const plans = plansL.data; const payments = paysL.data;
        let plan = plans.find((p) => p && parseInt(p.userId, 10) === userId && parseInt(p.promotionId, 10) === promotionId && p.status !== 'cancelled');
        let created = false;
        if (!plan) {
          const existingIds = new Set(plans.map((p) => String(p && p.planId)));
          let planId = Date.now(); let a = 0; while (existingIds.has(String(planId)) && a < 50) { planId = Date.now() + a + 1; a++; }
          if (existingIds.has(String(planId))) return { status: 500, body: { error: 'Impossible de generer un identifiant unique' } };
          const nowIso = new Date().toISOString();
          plan = { planId, userId, promotionId, promotionName: promotion.name || null, targetAmount, collectedAmount: 0, remainingAmount: targetAmount, status: 'active', createdAt: nowIso, updatedAt: nowIso, completedAt: null, finalOrderId: null };
          plans.push(plan);
          fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8');
          created = true;
        }
        // FCM (best-effort): plan créé seulement (pas à la relecture idempotente).
        if (created) {
          try {
            const owner = (readJSONFile(USERS_FILE) || []).find((u) => parseInt(u && u.id, 10) === userId);
            if (owner && owner.fcmToken) sendFcmToToken(owner.fcmToken, { title: 'Achat petit à petit', body: 'Votre objectif d\'épargne a été créé.', type: 'savings_plan_created', data: { planId: String(plan.planId), promotionId: String(promotionId) } }).catch(() => {});
          } catch (_) {}
        }
        return { status: created ? 201 : 200, body: { success: true, created, plan: buildPromotionSavingsPlanView(plan, payments) } };
      } catch (e) { console.error('POST promotion savings error:', e && e.message ? e.message : e); return { status: 500, body: { error: 'Server error' } }; }
    });
    return res.status(result.status).json(result.body);
  } catch (error) { console.error('POST promotion savings outer error:', error); return res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/savings/:planId', authenticateToken, async (req, res) => {
  try {
    const planId = normalizePositiveInt(req.params.planId);
    if (!planId) return res.status(400).json({ error: 'Identifiant objectif invalide' });
    const userId = normalizePositiveInt(req.user && req.user.id);
    if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifie' });
    const plansL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_FILE);
    const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
    if (!plansL.ok || !paysL.ok) return res.status(500).json({ error: 'Stockage indisponible' });
    const plan = plansL.data.find((p) => p && parseInt(p.planId, 10) === planId);
    if (!plan) return res.status(404).json({ error: 'Objectif introuvable' });
    if (parseInt(plan.userId, 10) !== userId) return res.status(403).json({ error: 'Acces refuse' });
    return res.json({ success: true, plan: buildPromotionSavingsPlanView(plan, paysL.data) });
  } catch (error) { console.error('GET savings plan error:', error); return res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/savings/:planId/contributions/init', authenticateToken, async (req, res) => {
  let paymentId = null;
  try {
    const planId = normalizePositiveInt(req.params.planId);
    if (!planId) return res.status(400).json({ error: 'Identifiant objectif invalide' });
    const userId = normalizePositiveInt(req.user && req.user.id);
    if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifie' });
    const rawAmount = req.body && req.body.amount;
    const amount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Montant de contribution invalide' });
    const amountR = roundMoney2(amount);
    if (amountR <= 0) return res.status(400).json({ error: 'Montant de contribution invalide' });

    const initRes = await runPromotionSavingsSerialized(() => {
      try {
        const plansL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_FILE);
        const paysL = loadPromotionSavingsFileSafe(PROMOTION_SAVINGS_PAYMENTS_FILE);
        if (!plansL.ok || !paysL.ok) return { status: 500, body: { error: 'Stockage indisponible' } };
        const plans = plansL.data; const payments = paysL.data;
        const pIdx = plans.findIndex((p) => p && parseInt(p.planId, 10) === planId);
        if (pIdx === -1) return { status: 404, body: { error: 'Objectif introuvable' } };
        const plan = plans[pIdx];
        if (parseInt(plan.userId, 10) !== userId) return { status: 403, body: { error: 'Acces refuse' } };
        if (plan.status === 'completed' || plan.finalOrderId) return { status: 400, body: { error: 'Objectif deja atteint' } };
        if (plan.status === 'cancelled') return { status: 400, body: { error: 'Objectif indisponible' } };
        const promotions = readJSONFile(PROMOTIONS_FILE);
        const promotion = Array.isArray(promotions) ? promotions.find((p) => parseInt(p && p.id, 10) === parseInt(plan.promotionId, 10)) : null;
        if (!promotion) return { status: 400, body: { error: 'Promotion associee introuvable' } };
        const planPayments = payments.filter((p) => p && parseInt(p.planId, 10) === planId);
        const confirmedSum = roundMoney2(planPayments.filter((p) => p.paymentStatus === 'confirmed').reduce((s, p) => s + (Number(p.amount) || 0), 0));
        const reservedSum = roundMoney2(planPayments.filter((p) => p.paymentStatus === 'pending' || p.paymentStatus === 'initializing').reduce((s, p) => s + (Number(p.amount) || 0), 0));
        const target = roundMoney2(plan.targetAmount || 0);
        const reservedRemaining = roundMoney2(Math.max(0, target - confirmedSum - reservedSum));
        if (reservedRemaining <= 0) return { status: 400, body: { error: 'L\'objectif est deja atteint ou entierement reserve' } };
        if (amountR > reservedRemaining) return { status: 400, body: { error: 'Montant superieur au montant restant disponible', remainingAmount: reservedRemaining } };
        const existingIds = new Set(planPayments.map((p) => String(p.paymentId)));
        paymentId = Date.now(); let a = 0; while (existingIds.has(String(paymentId)) && a < 50) { paymentId = Date.now() + a + 1; a++; }
        if (existingIds.has(String(paymentId))) { paymentId = null; return { status: 500, body: { error: 'Impossible de generer un identifiant unique' } }; }
        const nowIso = new Date().toISOString();
        payments.push({ paymentId, planId, userId, promotionId: plan.promotionId, amount: amountR, transactionReference: null, paymentStatus: 'initializing', provider: 'geniuspay', createdAt: nowIso, updatedAt: nowIso, confirmedAt: null, failedAt: null });
        fs.writeFileSync(PROMOTION_SAVINGS_PAYMENTS_FILE, JSON.stringify(payments, null, 2), 'utf8');
        plans[pIdx] = { ...plan, collectedAmount: confirmedSum, remainingAmount: roundMoney2(Math.max(0, target - confirmedSum)), updatedAt: nowIso };
        fs.writeFileSync(PROMOTION_SAVINGS_FILE, JSON.stringify(plans, null, 2), 'utf8');
        const users = readJSONFile(USERS_FILE);
        const user = Array.isArray(users) ? users.find((u) => parseInt(u && u.id, 10) === userId) : null;
        return { ok: true, plan, user, amountR };
      } catch (e) { console.error('savings init reserve error:', e && e.message ? e.message : e); return { status: 500, body: { error: 'Server error' } }; }
    });
    if (!initRes || !initRes.ok) return res.status((initRes && initRes.status) || 500).json((initRes && initRes.body) || { error: 'Server error' });

    const { plan, user } = initRes;
    const customerName = (user && (user.nom || user.name || user.username)) || `Utilisateur ${userId}`;
    const rawPhone = (user && (user.numero || user.phone || user.telephone)) || (req.body && req.body.phone) || '';
    const phone = String(rawPhone || '').trim();
    const payload = {
      amount: amountR, description: `Achat petit a petit promo ${plan.promotionId} - plan ${planId}`,
      customer: { name: customerName, phone: phone.startsWith('+') ? phone : (phone ? `+225${phone}` : '') },
      metadata: { payment_type: 'promotion_savings_contribution', plan_id: String(planId), contribution_id: String(paymentId), user_id: String(userId), promotion_id: String(plan.promotionId) },
    };
    let response, data = null;
    try {
      response = await fetch('https://geniuspay.ci/api/v1/merchant/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': GENIUSPAY_API_KEY, 'X-API-Secret': GENIUSPAY_SECRET_KEY }, body: JSON.stringify(payload) });
      data = await response.json().catch(() => null);
    } catch (fetchError) {
      // Aucun checkout_url/reference exploitable obtenu (erreur reseau) -> marquer failed pour liberer la reservation. Ecriture verifiee; si incertaine, on signale l'echec sans mentir sur l'etat.
      let mark = { ok: false };
      try { mark = await runPromotionSavingsSerialized(() => markSavingsContributionFailedIfInitializing(paymentId, 'provider_fetch_error')); } catch (_) {}
      if (!mark || !mark.ok) console.error('savings init: unable to persist failed state after fetch error', paymentId);
      return res.status(502).json({ error: 'Echec d\'initialisation du paiement GeniusPay' });
    }
    if (!response || !response.ok || !data || data.success === false) {
      // Reponse provider rejetee (pas de paiement confirme) -> marquer failed pour liberer la reservation.
      let mark = { ok: false };
      try { mark = await runPromotionSavingsSerialized(() => markSavingsContributionFailedIfInitializing(paymentId, 'provider_rejected')); } catch (_) {}
      if (!mark || !mark.ok) console.error('savings init: unable to persist failed state after provider rejection', paymentId);
      return res.status(502).json({ error: 'Echec d\'initialisation du paiement GeniusPay' });
    }
    const checkoutUrl = data && data.data && data.data.checkout_url;
    const reference = data && data.data && data.data.reference;
    if (typeof checkoutUrl !== 'string' || !checkoutUrl.trim() || reference == null || String(reference).trim() === '') {
      // Reponse invalide (pas de checkout_url/reference) -> pas de paiement initiable cote client; marquer failed.
      let mark = { ok: false };
      try { mark = await runPromotionSavingsSerialized(() => markSavingsContributionFailedIfInitializing(paymentId, 'invalid_provider_response')); } catch (_) {}
      if (!mark || !mark.ok) console.error('savings init: unable to persist failed state after invalid provider response', paymentId);
      return res.status(502).json({ error: 'Reponse GeniusPay invalide (checkout_url/reference manquants)' });
    }
    // Reference/checkout valides recus: passage pending CRITIQUE. Ne JAMAIS marquer failed si cette ecriture echoue (un paiement peut etre effectue avec cette reference).
    let pendingRes = null;
    try { pendingRes = await runPromotionSavingsSerialized(() => markSavingsContributionPending(paymentId, String(reference).trim(), checkoutUrl)); } catch (pe) { pendingRes = { ok: false, error: pe && pe.message ? pe.message : 'write_error' }; }
    if (!pendingRes || !pendingRes.ok) {
      console.error('savings init: pending write failed after valid provider response (do NOT mark failed; reference may be payable)', paymentId, pendingRes && pendingRes.error);
      return res.status(500).json({ error: 'Paiement initialise chez GeniusPay mais enregistrement local incertain. Ne renvoyez pas de paiement; contactez le support avec la reference.', reference: String(reference).trim(), contribution: { paymentId, planId, userId, amount: amountR, paymentStatus: 'initializing' } });
    }
    // FCM (best-effort, après init réussie): contribution initiée, en attente webhook.
    try { if (owner && owner.fcmToken) sendFcmToToken(owner.fcmToken, { title: "Versement initie", body: "Votre paiement est en attente de confirmation.", type: 'savings_contribution_initiated', data: { planId: String(planId), contributionId: String(paymentId) } }).catch(() => {}); } catch (_) {}
    return res.json({ success: true, checkout_url: checkoutUrl, reference: String(reference).trim(), contribution: { paymentId, planId, userId, amount: amountR, paymentStatus: 'pending' } });
  } catch (error) {
    console.error('Promotion savings contribution init error:', error);
    // Erreur inattendue: ne marquer failed que si l'ecriture confirme (et seulement depuis initializing). Ne pas convertir en echec confirme sans preuve.
    try {
      if (paymentId != null) {
        const mark = await runPromotionSavingsSerialized(() => markSavingsContributionFailedIfInitializing(paymentId, 'unexpected_error'));
        if (!mark || !mark.ok) console.error('savings init: unable to persist failed state after unexpected error', paymentId);
      }
    } catch (_) {}
    return res.status(500).json({ error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Djassa CI Backend Server running on port ${PORT}`);
});
