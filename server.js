// Backend Server for Djassa CI - E-commerce Platform
// Author: Djassa CI Team

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const chatRoutes = require('./routes/chatRoutes');
const admin = require('firebase-admin');
const serviceAccount = require('./config/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'djassa_ci_secret_key_2024';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer pour uploads images
const multer = require('multer');
// fs et path déjà importés en haut



const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seule les images sont autorisées'));
    }
  }
});


// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files (frontend)
app.get('/', (req, res) => {
  res.send('Djassa CI Backend OK 🚀');
});

// File paths for JSON storage
const USERS_FILE = path.join(__dirname, 'users.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');
const ARTICLES_FILE = path.join(__dirname, 'articles.json');

// Helper functions to read/write JSON files
const readJSONFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
};

const writeJSONFile = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    return false;
  }
};

// Initialize default data if files don't exist
const initializeData = () => {
  if (!fs.existsSync(PRODUCTS_FILE)) {
    const defaultProducts = [
      {
        id: 1,
        name: "Téléphone portable",
        price: 50000,
        image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Smartphone dernière génération avec caméra haute résolution",
        categorie: "Téléphones",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 2,
        name: "Ordinateur portable",
        price: 300000,
        image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Ordinateur portable performant pour le travail et les jeux",
        categorie: "Ordinateurs",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 3,
        name: "Casque audio",
        price: 15000,
        image: "https://images.unsplash.com/photo-1484704849700-f032a568e944?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Casque sans fil avec réduction de bruit active",
        categorie: "Audio",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 4,
        name: "Chargeur USB",
        price: 5000,
        image: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Chargeur rapide compatible avec tous les appareils",
        categorie: "Accessoires",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 5,
        name: "Tablette",
        price: 80000,
        image: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Tablette tactile légère et puissante",
        categorie: "Tablettes",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 6,
        name: "Smartwatch",
        price: 25000,
        image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Montre connectée avec suivi de santé",
        categorie: "Montres",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 7,
        name: "Télévision LED",
        price: 150000,
        image: "https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Télévision LED 4K avec Smart TV",
        categorie: "TV",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      },
      {
        id: 8,
        name: "Mixeur électrique",
        price: 20000,
        image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=80",
        description: "Mixeur puissant avec plusieurs vitesses",
        categorie: "Électroménager",
        vendeur: "Admin",
        vendeurCompte: "",
        vendeurLocalisation: "Abidjan",
        datePublication: new Date().toISOString(),
        isActive: true
      }
    ];
    writeJSONFile(PRODUCTS_FILE, defaultProducts);
  }

  if (!fs.existsSync(USERS_FILE)) {
    writeJSONFile(USERS_FILE, []);
  }

  if (!fs.existsSync(ORDERS_FILE)) {
    writeJSONFile(ORDERS_FILE, []);
  }
};

initializeData();

// ==================== AUTHENTICATION MIDDLEWARE ====================
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
    req.user = user;
    next();
  });
};

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', (req, res) => {
  try {
    const { nom, prenom, numero, address, password } = req.body;

    // Validation
    if (!nom || !prenom || !numero || !address || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const users = readJSONFile(USERS_FILE);

    // Check if user already exists
    const existingUser = users.find(u => u.numero === numero);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this phone number already exists' });
    }

    // Create new user (in production, hash the password!)
    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    const newUser = {
      id: Date.now(),
      nom,
      prenom,
      numero,
      address,
      password: hashedPassword, // In production: await bcrypt.hash(password, 10)
      role: 'user',
      dateInscription: new Date().toISOString()
    };

    users.push(newUser);
    writeJSONFile(USERS_FILE, users);

    // Generate token
    const token = jwt.sign(
      {
        id: newUser.id,
        numero: newUser.numero,
        role: newUser.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { numero, password } = req.body;

    if (!numero || !password) {
      return res.status(400).json({ error: 'Phone number and password are required' });
    }

    const users = readJSONFile(USERS_FILE);

    // Find user by numero (flexible matching - phone or email)
    const user = users.find(u => u.numero === numero || u.numero.toLowerCase() === numero.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");
    const passwordValid = user.password === password || user.password === hashedPassword;

    if (!passwordValid) {
      return res.status(401).json({ message: "Mot de passe incorrect" });
    }

    if (user.password === password) {
      user.password = hashedPassword;
      writeJSONFile(USERS_FILE, users);
    }

    // Generate token
    const token = jwt.sign(
      {
        id: user.id,
        numero: user.numero,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);

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

// Refresh token - Generate a new token without requiring login
app.post('/api/auth/refresh', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate new token with fresh expiration
    const token = jwt.sign(
      {
        id: user.id,
        numero: user.numero,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Token refreshed successfully', token });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Server error during token refresh' });
  }
});

// ==================== PRODUCTS ROUTES ====================

// Get all products
app.get('/api/products', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const activeProducts = products.filter(p => p.isActive !== false);
    res.json(activeProducts);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get product by ID
app.get('/api/products/:id', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const product = products.find(p => p.id === parseInt(req.params.id));

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get products by category
app.get('/api/products/category/:category', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const categoryProducts = products.filter(
      p => p.categorie.toLowerCase() === req.params.category.toLowerCase() && p.isActive !== false
    );

    res.json(categoryProducts);
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search products
app.get('/api/products/search/:query', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const query = req.params.query.toLowerCase();
    const searchResults = products.filter(p => (p.isActive !== false) &&
      (
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.categorie.toLowerCase().includes(query)
      )
    );

    res.json(searchResults);
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create product (seller) - Support multipart upload
app.post('/api/products', authenticateToken, upload.single('image'), (req, res) => {
  try {
    let imageUrl = 'https://via.placeholder.com/400x400?text=Product';
    
    // Si fichier uploadé
    if (req.file) {
      const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      imageUrl = publicUrl;
    } else if (req.body.image && req.body.image.startsWith('data:image')) {
      // Fallback base64 (compatibilité ancienne)
      imageUrl = req.body.image;
    }

    const { name, price, description, categorie, vendeurCompte, vendeurLocalisation, paymentMethod, paymentAccount } = req.body;


    if (!name || !price || !description || !categorie) {
      return res.status(400).json({ error: 'Name, price, description, and category are required' });
    }

    const users = readJSONFile(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const products = readJSONFile(PRODUCTS_FILE);

    const newProduct = {
      id: Date.now(),
      name,
      price: parseFloat(price),
      image: image || 'https://via.placeholder.com/400x400?text=Product',
      description,
      categorie,
      vendeur: req.user.id,
      vendeurNom: `${user.prenom} ${user.nom}`,
      vendeurCompte: vendeurCompte || '',
      vendeurLocalisation: vendeurLocalisation || user.address,
      datePublication: new Date().toISOString(),
      isActive: true
    };

    products.push(newProduct);
    writeJSONFile(PRODUCTS_FILE, products);

    res.status(201).json({ message: 'Product created successfully', product: newProduct });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update product
app.put('/api/products/:id', authenticateToken, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const productIndex = products.findIndex(p => p.id === parseInt(req.params.id));

    if (productIndex === -1) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[productIndex];

    // Check if user is the owner or admin
    if (product.vendeur !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only update your own products' });
    }

    const { name, price, image, description, categorie, vendeurCompte, vendeurLocalisation, isActive } = req.body;

    products[productIndex] = {
      ...product,
      name: name || product.name,
      price: price ? parseFloat(price) : product.price,
      image: image || product.image,
      description: description || product.description,
      categorie: categorie || product.categorie,
      vendeurCompte: vendeurCompte !== undefined ? vendeurCompte : product.vendeurCompte,
      vendeurLocalisation: vendeurLocalisation !== undefined ? vendeurLocalisation : product.vendeurLocalisation,
      isActive: isActive !== undefined ? isActive : product.isActive
    };

    writeJSONFile(PRODUCTS_FILE, products);

    res.json({ message: 'Product updated successfully', product: products[productIndex] });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/products/:id', authenticateToken, (req, res) => {
  const products = readJSONFile(PRODUCTS_FILE);
  const productIndex = products.findIndex(p => p.id === parseInt(req.params.id));

  if (productIndex === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = products[productIndex];

  if (product.vendeur !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not allowed' });
  }

  products[productIndex].isActive = false;

  writeJSONFile(PRODUCTS_FILE, products);

  res.json({ message: 'Produit supprimé (caché)' });
});

// Get seller's products
app.get('/api/products/seller/my', authenticateToken, (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellerProducts = products.filter(p => p.vendeur === req.user.id);
    res.json(sellerProducts);
  } catch (error) {
    console.error('Get seller products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get unique sellers/boutiques
app.get('/api/sellers', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellers = [...new Set(products.map(p => p.vendeurNom))];
    res.json(sellers);
  } catch (error) {
    console.error('Get sellers error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get products by seller
app.get('/api/sellers/:name/products', (req, res) => {
  try {
    const products = readJSONFile(PRODUCTS_FILE);
    const sellerProducts = products.filter(
      p => p.vendeurNom === req.params.name && p.isActive !== false
    );
    res.json(sellerProducts);
  } catch (error) {
    console.error('Get seller products error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== ORDERS ROUTES ====================

// Seller confirm delivery endpoint
app.put('/api/orders/:id/confirm-delivery', authenticateToken, async (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === parseInt(req.params.id));

    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[orderIndex];

    // Check if seller owns any product in order
    const ownsOrder = order.articles.some(article => {
      const products = readJSONFile(PRODUCTS_FILE);
      const product = products.find(p => p.id === article.product?.id);
      return product && product.vendeur === req.user.id;
    });

    if (!ownsOrder) {
      return res.status(403).json({ error: 'You can only confirm delivery for your orders' });
    }

    // Only allow if already 'livree'
    if (order.statut !== 'livree') {
      return res.status(400).json({ error: 'Order must be marked as delivered first' });
    }

    order.statut = 'livraison_confirmee';
    writeJSONFile(ORDERS_FILE, orders);

    // Send FCM notification to buyer
    const buyerId = order.utilisateurId;
    const users = readJSONFile(USERS_FILE);
    const buyer = users.find(u => u.id == buyerId);

if (buyer && buyer.fcmToken) {
      await admin.messaging().send({
        token: buyer.fcmToken,
        notification: {
          title: "Livraison Confirmée",
          body: `Votre commande #${order.id} est livrée`,
        },
        data: {
          type: "order_confirmed",
          orderId: String(order.id),
        },
      });

      console.log("Notification envoyée ✔");
    } else {
      console.log("No FCM token for buyer, skipping notification");
    }

    res.json({
      message: 'Livraison confirmée! Notification envoyée à l\'acheteur.',
      order: order
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create order - Backend source of truth: lookup products, set seller
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

    // Validate/lookup each item, extract seller from products (source of truth)
    const validatedItems = items.map(item => {
      const product = products.find(p => p.id === item.id);
      if (!product || !product.isActive) {
        throw new Error(`Product ID ${item.id} not found or inactive`);
      }
      return {
        ...item,
        seller: product.vendeur, // Backend authoritative seller ID
        name: product.name,
        image: product.image,
        categorie: product.categorie,
        vendeurNom: product.vendeurNom,
        vendeurCompte: product.vendeurCompte
      };
    });

    const primarySeller = validatedItems[0].seller; // Main seller for order

    const subtotal = validatedItems.reduce((sum, item) => sum + (item.price * item.quantite), 0);
    const commissionRate = 0.05;
    const commission = subtotal * commissionRate;
    const total = subtotal + commission;

    const orders = readJSONFile(ORDERS_FILE);
    console.log('🆕 Creating order - userId:', req.user.id, 'primarySeller:', primarySeller);

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
      buyerLng: parseFloat(req.body.buyerLng) || null
    };

    orders.push(newOrder);
    writeJSONFile(ORDERS_FILE, orders);

    res.status(201).json({
      message: 'Order placed successfully',
      order: newOrder,
      commission: commission
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Get user's orders (buyer)
app.get('/api/orders/my', authenticateToken, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const currentUserId = parseInt(req.user.id);

    const userOrders = orders.filter(o => parseInt(o.utilisateurId) === currentUserId);

    res.json(userOrders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get order by ID
app.get('/api/orders/:id', authenticateToken, (req, res) => {
  try {
    const orders = readJSONFile(ORDERS_FILE);
    const order = orders.find(o => o.id === parseInt(req.params.id));

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if user owns the order or is admin
    if (order.utilisateurId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all orders (admin)
app.get('/api/orders', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const orders = readJSONFile(ORDERS_FILE);
    res.json(orders);

  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get seller orders - Filter articles to only those owned by seller
app.get('/api/orders/seller/:sellerId', authenticateToken, (req, res) => {
  const sellerId = parseInt(req.params.sellerId);
  const currentUserId = parseInt(req.user.id);

  // Security: sellers can only view their own orders, admins can view any
  if (currentUserId !== sellerId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Vous ne pouvez voir que vos propres commandes' });
  }

  try {
    const orders = readJSONFile(ORDERS_FILE);
    const products = readJSONFile(PRODUCTS_FILE);

    const sellerOrders = orders.map(order => {
      // Filter articles to only those belonging to this seller
      const sellerArticles = order.articles.filter(article => {
        // 1. Direct seller field on article (new orders)
        const articleSeller = parseInt(article.seller || article.vendeur || -1);
        if (articleSeller === sellerId) {
          return true;
        }
        // 2. Lookup product in catalog to find owner (legacy orders without article.seller)
        const product = products.find(p => p.id === (article.product?.id || article.id));
        if (product && parseInt(product.vendeur) === sellerId) {
          return true;
        }
        return false;
      });

      if (sellerArticles.length === 0) return null;

      // Calculate seller subtotal (only their articles)
      const sellerSubtotal = sellerArticles.reduce((sum, item) => sum + (item.price * (item.quantite || 1)), 0);
      const commissionRate = 0.05;
      const sellerCommission = sellerSubtotal * commissionRate;
      const sellerTotal = sellerSubtotal + sellerCommission;

      return {
        ...order,
        articles: sellerArticles,
        sellerTotal: sellerTotal
      };
    }).filter(Boolean);

    res.json(sellerOrders);
  } catch (error) {
    console.error('Get seller orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});



// Update order status (admin)
app.put('/api/orders/:id/status', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const orders = readJSONFile(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === parseInt(req.params.id));

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

// ==================== CHAT ROUTES ====================
app.use('/api/messages', authenticateToken, chatRoutes);

// ==================== USERS ROUTES ====================

// Get user profile
app.get('/api/users/profile', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);

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

// Update user profile
app.put('/api/users/profile', authenticateToken, (req, res) => {
  try {
    const users = readJSONFile(USERS_FILE);
    const userIndex = users.findIndex(u => u.id === req.user.id);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { nom, prenom, address } = req.body;

    users[userIndex] = {
      ...users[userIndex],
      nom: nom || users[userIndex].nom,
      prenom: prenom || users[userIndex].prenom,
      address: address || users[userIndex].address
    };

    writeJSONFile(USERS_FILE, users);

    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({
      message: 'Profile updated successfully',
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users (admin)
app.get('/api/users', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = readJSONFile(USERS_FILE);
    const usersWithoutPassword = users.map(({ password, ...user }) => user);

    res.json(usersWithoutPassword);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== ARTICLES/BLOG ROUTES ====================

// Get all articles
app.get('/api/articles', (req, res) => {
  try {
    const articles = readJSONFile(ARTICLES_FILE);
    res.json(articles);
  } catch (error) {
    console.error('Get articles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get article by ID
app.get('/api/articles/:id', (req, res) => {
  try {
    const articles = readJSONFile(ARTICLES_FILE);
    const article = articles.find(a => a.id === parseInt(req.params.id));

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (error) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new article
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
      datePublication: new Date().toISOString()
    };

    articles.push(newArticle);
    writeJSONFile(ARTICLES_FILE, articles);

    res.status(201).json({ message: 'Article created successfully', article: newArticle });
  } catch (error) {
    console.error('Create article error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete article
app.delete('/api/articles/:id', (req, res) => {
  try {
    const articles = readJSONFile(ARTICLES_FILE);
    const articleIndex = articles.findIndex(a => a.id === parseInt(req.params.id));

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

// ==================== CONTACT ROUTES ====================

// Send contact message
app.post('/api/contact', (req, res) => {
  try {
    const { nom, email, sujet, message } = req.body;

    if (!nom || !email || !sujet || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // In production, save to database and/or send email
    console.log('Contact form submission:', { nom, email, sujet, message });

    res.json({ message: 'Message sent successfully! We will contact you soon.' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Contact seller
app.post('/api/contact/seller', (req, res) => {
  try {
    const { nomVendeur, numeroVendeur, sujet, message } = req.body;

    if (!nomVendeur || !numeroVendeur || !sujet || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // In production, save to database and/or send SMS/email
    console.log('Seller contact submission:', { nomVendeur, numeroVendeur, sujet, message });

    res.json({ message: 'Message sent to seller successfully!' });
  } catch (error) {
    console.error('Seller contact error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== STATS ROUTES ====================

// Get dashboard stats (admin)
app.get('/api/stats', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = readJSONFile(USERS_FILE);
    const products = readJSONFile(PRODUCTS_FILE);
    const orders = readJSONFile(ORDERS_FILE);

    const stats = {
      totalUsers: users.length,
      totalProducts: products.length,
      activeProducts: products.filter(p => p.isActive).length,
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, o) => sum + o.total, 0)
    };

    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Djassa CI API is running',
    timestamp: new Date().toISOString()
  });
});

// CinetPay webhook
app.post('/notify', (req, res) => {
  console.log('🔔 CinetPay notification:', req.body);

  const { transaction_id, cpm_trans_status } = req.body;

  const orders = readJSONFile(ORDERS_FILE);
  const orderIndex = orders.findIndex(o => o.transaction_id == transaction_id);

  if (orderIndex === -1) {
    console.log("❌ Commande non trouvée");
    return res.send("OK");
  }

  if (cpm_trans_status === "ACCEPTED") {
    orders[orderIndex].statut = 'payée';
    console.log("✅ Paiement confirmé pour commande:", transaction_id);
  } else {
    orders[orderIndex].statut = "refusée";
  }

  writeJSONFile(ORDERS_FILE, orders);
  res.send("OK");
});

// ==================== START SERVER ====================
app.put('/api/orders/:id/pay-vendor', authenticateToken, (req, res) => {
  const orderId = parseInt(req.params.id);

  const orders = readJSONFile(ORDERS_FILE);
  const orderIndex = orders.findIndex(o => o.id === orderId);

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
    const orderIndex = orders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    const order = orders[orderIndex];

    // Vérifier que le vendeur possède un article de la commande
    const products = readJSONFile(PRODUCTS_FILE);
    const ownsOrder = order.articles.some(article => {
      const product = products.find(p => p.id === article.product?.id || p.id === article.id);
      return product && product.vendeur === req.user.id;
    });

    if (!ownsOrder) {
      return res.status(403).json({ error: 'Vous ne pouvez livrer que vos propres commandes' });
    }

    // Vérifier que la commande est payée
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

app.listen(PORT, () => {
  console.log(`🚀 Djassa CI Backend Server running on port ${PORT}`);
});

