// init-db.js
const db = require('./database');
const bcrypt = require('bcryptjs');

console.log('Initializing Enterprise Analytics & RBAC database schema...');

const init = db.transaction(() => {
    // 1. Drop existing tables
    db.exec(`
        DROP TABLE IF EXISTS audit_logs;
        DROP TABLE IF EXISTS stock_counts;
        DROP TABLE IF EXISTS order_items; 
        DROP TABLE IF EXISTS orders; 
        DROP TABLE IF EXISTS products; 
        DROP TABLE IF EXISTS categories;
        DROP TABLE IF EXISTS employees;
        DROP TABLE IF EXISTS app_settings;
        DROP TABLE IF EXISTS users;
    `);

    // 2. Create Users Table (Role-Based Access Control)
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL, -- 'SuperAdmin', 'Admin', 'Cashier'
            perm_edit_employee INTEGER DEFAULT 0,
            perm_archive_employee INTEGER DEFAULT 0,
            perm_view_transactions INTEGER DEFAULT 0,
            perm_access_settings INTEGER DEFAULT 0,
            perm_manage_menu INTEGER DEFAULT 0,
            perm_view_reports INTEGER DEFAULT 0 -- NEW: Access BI Dashboard
        );
    `);

    // 3. Create App Settings Table
    db.exec(`
        CREATE TABLE app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            allow_split_payments INTEGER DEFAULT 0,
            global_free_meal_allowance INTEGER DEFAULT 5000
        );
    `);

    // 4. Create Employees Table (The "Customers")
    db.exec(`
        CREATE TABLE employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            credit_balance INTEGER DEFAULT 0,
            credit_allowed INTEGER DEFAULT 1,
            credit_limit INTEGER DEFAULT 0,
            free_meal_balance INTEGER DEFAULT 0,
            daily_allowance INTEGER DEFAULT 5000,
            last_meal_date DATE,
            is_active INTEGER DEFAULT 1
        );
    `);

    // 5. Create Menu Tables (Added COGS and Specific Thresholds)
    db.exec(`
        CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER,
            name TEXT NOT NULL,
            cost_price INTEGER NOT NULL DEFAULT 0, -- NEW: Supplier cost for P&L
            price INTEGER NOT NULL, -- Selling price
            stock_quantity INTEGER DEFAULT 0,
            low_stock_threshold INTEGER DEFAULT 10, -- NEW: Item-specific alert level
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (category_id) REFERENCES categories(id)
        );
    `);

    // 6. Create Order Tables (Added Cashier Tracking, Status, and Historical Costs)
    db.exec(`
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total_amount INTEGER NOT NULL,
            employee_id INTEGER,
            cashier_id INTEGER, -- NEW: Who processed the sale
            payment_method TEXT NOT NULL,
            status TEXT DEFAULT 'Completed', -- NEW: 'Completed' or 'Voided'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id),
            FOREIGN KEY (cashier_id) REFERENCES users(id)
        );

        CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_id INTEGER,
            quantity INTEGER NOT NULL,
            cost_at_sale INTEGER NOT NULL DEFAULT 0, -- NEW: Locks in profit margin even if costs change later
            price_at_sale INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        );
    `);

    // 7. NEW: Create Audit Logs Table
    db.exec(`
        CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, -- Who did it
            action TEXT NOT NULL, -- e.g., 'VOID_TRANSACTION', 'UPDATE_PRICE', 'FORCE_RESET'
            details TEXT, -- e.g., 'Voided Order #104. Reason: Customer changed mind.'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    // 8. NEW: Create Physical Stock Counts Table (For Shrinkage/Variance)
    db.exec(`
        CREATE TABLE stock_counts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            user_id INTEGER, -- Admin who counted
            expected_stock INTEGER NOT NULL, -- What the system thought we had
            actual_stock INTEGER NOT NULL, -- What was physically counted
            variance INTEGER NOT NULL, -- Actual - Expected (Negative = Shrinkage)
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    // --- SEEDING INITIAL DATA ---

    // Seed Users
    const superAdminPassword = bcrypt.hashSync('password123', 10);
    const adminPassword = bcrypt.hashSync('admin123', 10);
    
    const insertUser = db.prepare(`
        INSERT INTO users (username, password_hash, role, perm_edit_employee, perm_archive_employee, perm_view_transactions, perm_access_settings, perm_manage_menu, perm_view_reports)
        VALUES (?, ?, ?, 1, 1, 1, 1, 1, 1)
    `);
    insertUser.run('superadmin', superAdminPassword, 'SuperAdmin');
    insertUser.run('manager', adminPassword, 'Admin'); // Give you a test admin account too

    // Seed Settings
    db.prepare('INSERT INTO app_settings (id, allow_split_payments, global_free_meal_allowance) VALUES (1, 0, 5000)').run();

    // Seed Employees
    const insertEmployee = db.prepare(`
        INSERT INTO employees (barcode, name, credit_allowed, credit_limit, free_meal_balance, daily_allowance, last_meal_date, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const today = new Date().toISOString().split('T')[0];
    insertEmployee.run('1111', 'John Doe', 1, 0, 5000, 5000, today);
    insertEmployee.run('2222', 'Jane Smith', 0, 0, 10000, 10000, today);

    // Seed Categories
    const insertCategory = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)');
    insertCategory.run(1, 'Hot Meals');
    insertCategory.run(2, 'Snacks');
    insertCategory.run(3, 'Beverages');

    // Seed Products (Now with Cost Price and Thresholds)
    const insertProduct = db.prepare('INSERT INTO products (category_id, name, cost_price, price, stock_quantity, low_stock_threshold, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)');
    // Adobo: Costs ₱40, Sells for ₱75. Alert if under 5.
    insertProduct.run(1, 'Chicken Adobo with Rice', 4000, 7500, 50, 5); 
    // Spaghetti: Costs ₱20, Sells for ₱50. Alert if under 10.
    insertProduct.run(1, 'Spaghetti', 2000, 5000, 30, 10);              
    // Turon: Costs ₱5, Sells for ₱15. Alert if under 20.
    insertProduct.run(2, 'Turon', 500, 1500, 100, 20);                 
    // Water: Costs ₱5, Sells for ₱15. Alert if under 50.
    insertProduct.run(3, 'Bottled Water', 500, 1500, 100, 50);         
});

init();
console.log('BI Database initialized! Audit Logs and Stock Counts tables created.');