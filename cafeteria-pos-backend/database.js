// database.js
const Database = require('better-sqlite3');
const path = require('path');

// Create or connect to the SQLite database file
// This will create a 'cafeteria.db' file in your project folder
const dbPath = path.join(__dirname, 'cafeteria.db');
const db = new Database(dbPath, { verbose: console.log }); 

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

console.log('Connected to local SQLite database.');

module.exports = db;