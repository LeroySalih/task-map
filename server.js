require('dotenv').config();
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { initDb } = require('./db');
const { createApp } = require('./app');

const db = initDb();
const store = new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') });
const app = createApp(db, { sessionStore: store });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Task Map running on http://localhost:${PORT}`);
});
