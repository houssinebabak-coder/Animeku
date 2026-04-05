const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'super-secret-anime-crown-key-2026';

// ─── Nodemailer Setup ───
// IMPORTANT: You need to replace these with your real Gmail and App Password
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Use SSL
  auth: {
    user: 'x5t7zk9.m4qw82@gmail.com',
    pass: 'tyja bkrj zlje okuh'
  }
});

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = path.join(__dirname, 'animeku.db');

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ─── Multer config ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, 'anime_' + Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/.test(file.mimetype);
    cb(null, ok);
  }
});

// ─── Database ───
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS anime (
      id TEXT PRIMARY KEY,
      nameAr TEXT,
      nameEn TEXT,
      genre TEXT DEFAULT '',
      rating REAL DEFAULT 0,
      year TEXT DEFAULT '',
      status TEXT DEFAULT '',
      description TEXT DEFAULT '',
      emoji TEXT DEFAULT '🎌',
      imagePath TEXT DEFAULT '',
      isNew INTEGER DEFAULT 1,
      createdAt INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      animeId TEXT NOT NULL,
      num INTEGER NOT NULL,
      title TEXT DEFAULT '',
      duration TEXT DEFAULT '',
      url TEXT DEFAULT '',
      createdAt INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      animeId TEXT NOT NULL,
      username TEXT DEFAULT 'مجهول',
      text TEXT NOT NULL,
      createdAt INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      resetToken TEXT,
      resetTokenExpires INTEGER,
      createdAt INTEGER DEFAULT 0
    )
  `);

  // Add columns if they don't exist (for existing databases)
  try { db.run('ALTER TABLE users ADD COLUMN resetToken TEXT'); } catch (e) { }
  try { db.run('ALTER TABLE users ADD COLUMN resetTokenExpires INTEGER'); } catch (e) { }

  saveDb();
}

// Helper to run queries and get results as array of objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ─── API Routes ───

app.get('/api/anime', (req, res) => {
  try {
    const anime = queryAll('SELECT * FROM anime ORDER BY createdAt DESC');
    const result = anime.map(a => {
      const c = queryOne('SELECT COUNT(*) as count FROM episodes WHERE animeId = ?', [a.id]);
      return { ...a, episodeCount: c ? c.count : 0, isNew: !!a.isNew };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/anime/top', (req, res) => {
  try {
    const anime = queryAll('SELECT * FROM anime ORDER BY rating DESC LIMIT 6');
    res.json(anime.map(a => ({ ...a, isNew: !!a.isNew })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/anime/:id', (req, res) => {
  try {
    const anime = queryOne('SELECT * FROM anime WHERE id = ?', [req.params.id]);
    if (!anime) return res.status(404).json({ error: 'Not found' });
    const episodes = queryAll('SELECT * FROM episodes WHERE animeId = ? ORDER BY num ASC', [req.params.id]);
    res.json({ ...anime, isNew: !!anime.isNew, episodes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search', (req, res) => {
  try {
    const q = `%${req.query.q || ''}%`;
    const anime = queryAll('SELECT * FROM anime WHERE nameAr LIKE ? OR nameEn LIKE ? OR genre LIKE ? ORDER BY createdAt DESC', [q, q, q]);
    const result = anime.map(a => {
      const c = queryOne('SELECT COUNT(*) as count FROM episodes WHERE animeId = ?', [a.id]);
      return { ...a, episodeCount: c ? c.count : 0, isNew: !!a.isNew };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/anime', upload.single('image'), (req, res) => {
  try {
    const b = req.body;
    const id = 'a' + Date.now();
    const img = req.file ? '/uploads/' + req.file.filename : '';
    runSql(
      'INSERT INTO anime (id,nameAr,nameEn,genre,rating,year,status,description,emoji,imagePath,isNew,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, b.nameAr || '', b.nameEn || '', b.genre || '', parseFloat(b.rating) || 0, b.year || '', b.status || '', b.description || '', b.emoji || '🎌', img, 1, Date.now()]
    );
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/anime/:id', (req, res) => {
  try {
    const a = queryOne('SELECT imagePath FROM anime WHERE id = ?', [req.params.id]);
    if (a && a.imagePath) {
      const f = path.join(__dirname, a.imagePath);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    runSql('DELETE FROM episodes WHERE animeId = ?', [req.params.id]);
    runSql('DELETE FROM anime WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/episodes/:animeId', (req, res) => {
  try {
    res.json(queryAll('SELECT * FROM episodes WHERE animeId = ? ORDER BY num ASC', [req.params.animeId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/episodes', (req, res) => {
  try {
    const b = req.body;
    if (!b.animeId) return res.status(400).json({ error: 'animeId required' });
    if (!b.num) return res.status(400).json({ error: 'num required' });
    const id = 'e' + Date.now();
    runSql(
      'INSERT INTO episodes (id,animeId,num,title,duration,url,createdAt) VALUES (?,?,?,?,?,?,?)',
      [id, b.animeId, parseInt(b.num) || 1, b.title || '', b.duration || '', b.url || '', Date.now()]
    );
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/episodes/:id', (req, res) => {
  try {
    runSql('DELETE FROM episodes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/comments/:animeId', (req, res) => {
  try {
    res.json(queryAll('SELECT * FROM comments WHERE animeId = ? ORDER BY createdAt DESC', [req.params.animeId]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/comments', (req, res) => {
  try {
    const b = req.body;
    if (!b.animeId || !b.text) return res.status(400).json({ error: 'animeId and text required' });
    const id = 'c' + Date.now();
    runSql(
      'INSERT INTO comments (id,animeId,username,text,createdAt) VALUES (?,?,?,?,?)',
      [id, b.animeId, b.username || 'مجهول', b.text, Date.now()]
    );
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth API ───
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });

    // Check if email or username exists
    const existingEmail = queryAll('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0) return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });

    const existingName = queryAll('SELECT id FROM users WHERE username = ?', [username]);
    if (existingName.length > 0) return res.status(400).json({ error: 'اسم المستخدم محجوز، اختر اسماً آخر' });

    const hashedPassword = await bcrypt.hash(password, 8);
    const id = 'u' + Date.now();
    runSql(
      'INSERT INTO users (id,username,email,password,createdAt) VALUES (?,?,?,?,?)',
      [id, username, email, hashedPassword, Date.now()]
    );

    const token = jwt.sign({ id, username, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) res.status(400).json({ error: 'Username or Email already exists' });
    else res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields required' });

    const users = queryAll('SELECT id, username, password FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });

    const token = jwt.sign({ id: user.id, username: user.username, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

    const user = queryOne('SELECT id, username FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: 'البريد الإلكتروني غير مسجل لدينا' });

    // Generate 6-digit token
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes from now

    runSql('UPDATE users SET resetToken = ?, resetTokenExpires = ? WHERE email = ?', [token, expires, email]);

    // Send Email
    const mailOptions = {
      from: 'AnimeCrown <x5t7zk9.m4qw82@gmail.com>',
      to: email,
      subject: 'رمز استعادة كلمة المرور — AnimeCrown',
      html: `
        <div dir="rtl" style="font-family: sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: #6c5ce7; text-align: center;">AnimeCrown 👑</h2>
          <p>أهلاً <strong>${user.username}</strong>،</p>
          <p>لقد طلبت استعادة كلمة المرور لحسابك. يرجى استخدام الرمز التالي:</p>
          <div style="background: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333; border-radius: 8px; margin: 20px 0;">
            ${token}
          </div>
          <p style="font-size: 13px; color: #666;">هذا الرمز صالح لمدة 10 دقائق فقط. إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="text-align: center; font-size: 12px; color: #999;">© 2026 AnimeCrown Support</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' });

  } catch (err) {
    console.error('Email Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال البريد. تأكد من إعدادات Gmail في الخادم.' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });

    const user = queryOne('SELECT resetToken, resetTokenExpires FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: 'البريد الإلكتروني غير مسجل' });

    if (user.resetToken !== token) return res.status(400).json({ error: 'رمز التحقق غير صحيح' });
    if (Date.now() > user.resetTokenExpires) return res.status(400).json({ error: 'انتهت صلاحية الرمز، اطلب رمزاً جديداً' });

    const hashedPassword = await bcrypt.hash(newPassword, 8);
    runSql('UPDATE users SET password = ?, resetToken = NULL, resetTokenExpires = NULL WHERE email = ?', [hashedPassword, email]);

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start ───
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║  🎌 AnimeCrown Server Running!        ║');
    console.log(`  ║  → http://localhost:${PORT}              ║`);
    console.log('  ║  → Database: animeku.db               ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to start:', err);
});
