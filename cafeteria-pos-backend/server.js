// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'super_secret_cafeteria_key_2026';
const getTodayDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

// ==========================================
// 1. SECURITY MIDDLEWARES
// ==========================================
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access Denied: Please log in.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Session expired or invalid. Please log in again.' });
        req.user = user; 
        next();
    });
};

const requireRole = (allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: You do not have the required role for this action.' });
    }
    next();
};

const requirePermission = (permissionColumn) => (req, res, next) => {
    const { role } = req.user;
    if (role === 'SuperAdmin' || role === 'Admin') return next();
    if (req.user[permissionColumn] === 1) return next();
    res.status(403).json({ error: 'Forbidden: You do not have permission to do this.' });
};

// Helper: Log actions to Audit Trail
const logAudit = (userId, action, details) => {
    try {
        db.prepare('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)')
          .run(userId, action, details);
    } catch (err) { console.error('Audit Log Error:', err); }
};

// ==========================================
// 2. AUTHENTICATION & USERS
// ==========================================
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(400).json({ error: 'Invalid username or password.' });
        }

        const tokenPayload = {
            id: user.id, username: user.username, role: user.role,
            perm_edit_employee: user.perm_edit_employee,
            perm_archive_employee: user.perm_archive_employee,
            perm_view_transactions: user.perm_view_transactions,
            perm_access_settings: user.perm_access_settings,
            perm_manage_menu: user.perm_manage_menu,
            perm_view_reports: user.perm_view_reports
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token, user: tokenPayload });
    } catch (error) { res.status(500).json({ error: 'Server error during login.' }); }
});

app.get('/api/users', authenticate, requireRole(['SuperAdmin', 'Admin']), (req, res) => {
    res.json(db.prepare('SELECT id, username, role, perm_edit_employee, perm_archive_employee, perm_view_transactions, perm_access_settings, perm_manage_menu, perm_view_reports FROM users').all());
});

app.post('/api/users', authenticate, requireRole(['SuperAdmin', 'Admin']), (req, res) => {
    const { username, password, role, permissions } = req.body;
    if (req.user.role === 'Admin' && role === 'SuperAdmin') return res.status(403).json({ error: 'Admins cannot create SuperAdmin accounts.' });

    try {
        const hash = bcrypt.hashSync(password, 10);
        db.prepare(`
            INSERT INTO users (username, password_hash, role, perm_edit_employee, perm_archive_employee, perm_view_transactions, perm_access_settings, perm_manage_menu, perm_view_reports)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(username, hash, role, permissions.editEmp||0, permissions.archEmp||0, permissions.viewTrans||0, permissions.settings||0, permissions.menu||0, permissions.reports||0);
        
        logAudit(req.user.id, 'CREATE_USER', `Created user ${username} with role ${role}`);
        res.json({ success: true });
    } catch (error) { res.status(400).json({ error: 'Username might already exist.' }); }
});

// ==========================================
// 3. POS ENGINE & CHECKOUT
// ==========================================
app.post('/api/scan', authenticate, (req, res) => {
    const { barcode } = req.body;
    try {
        let employee = db.prepare('SELECT * FROM employees WHERE barcode = ? AND is_active = 1').get(barcode);
        if (!employee) return res.status(404).json({ error: 'Employee not found or archived.' });

        const today = getTodayDate();
        if (employee.last_meal_date !== today) {
            db.prepare('UPDATE employees SET free_meal_balance = daily_allowance, last_meal_date = ? WHERE id = ?').run(today, employee.id);
            employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee.id);
        }
        res.json(employee);
    } catch (error) { res.status(500).json({ error: 'Scan failed' }); }
});

app.post('/api/checkout', authenticate, (req, res) => {
    const { cart, employeeId, paymentDetails } = req.body;
    try {
        const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        const processCheckout = db.transaction(() => {
            // Deduct employee balances if not a guest
            if (employeeId) {
                const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
                const credit = paymentDetails.creditAmount || 0;
                const free = paymentDetails.freeMealAmount || 0;

                if (free > 0 && emp.free_meal_balance < free) throw new Error('Insufficient Free Meal balance.');
                if (credit > 0) {
                    if (emp.credit_allowed === 0) throw new Error('Not authorized for credit.');
                    if (emp.credit_limit > 0 && (emp.credit_balance + credit) > emp.credit_limit) throw new Error('Credit limit exceeded.');
                }
                db.prepare('UPDATE employees SET credit_balance = credit_balance + ?, free_meal_balance = free_meal_balance - ? WHERE id = ?').run(credit, free, employeeId);
            }
            
            // Log the Cashier ID
            const insertOrder = db.prepare('INSERT INTO orders (total_amount, employee_id, cashier_id, payment_method) VALUES (?, ?, ?, ?)');
            const orderId = insertOrder.run(totalAmount, employeeId || null, req.user.id, paymentDetails.method).lastInsertRowid;

            const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, cost_at_sale, price_at_sale) VALUES (?, ?, ?, ?, ?)');
            const updateStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?');

            for (const item of cart) {
                // Fetch current cost price to lock in profit margin
                const dbProd = db.prepare('SELECT cost_price FROM products WHERE id = ?').get(item.id);
                insertItem.run(orderId, item.id, item.quantity, dbProd ? dbProd.cost_price : 0, item.price);
                updateStock.run(item.quantity, item.id);
            }
            return orderId;
        });

        const newOrderId = processCheckout();
        res.json({ success: true, orderId: newOrderId });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

// ==========================================
// 4. ADVANCED OPERATIONS (Voids & Audits)
// ==========================================

// VOID TRANSACTION
app.post('/api/orders/:id/void', authenticate, requireRole(['SuperAdmin', 'Admin']), (req, res) => {
    const orderId = req.params.id;
    try {
        db.transaction(() => {
            const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            if (!order) throw new Error('Order not found.');
            if (order.status === 'Voided') throw new Error('Order is already voided.');

            // FIX 1: Use single quotes for 'Voided'
            db.prepare(`UPDATE orders SET status = 'Voided' WHERE id = ?`).run(orderId);

            // 2. Return Inventory
            const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(orderId);
            const restoreStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?');
            for (const item of items) restoreStock.run(item.quantity, item.product_id);

            // 3. Refund Employee
            if (order.employee_id) {
                if (order.payment_method === 'Free Meal') {
                    db.prepare('UPDATE employees SET free_meal_balance = free_meal_balance + ? WHERE id = ?').run(order.total_amount, order.employee_id);
                } else if (order.payment_method === 'Credit') {
                    db.prepare('UPDATE employees SET credit_balance = credit_balance - ? WHERE id = ?').run(order.total_amount, order.employee_id);
                }
            }

            logAudit(req.user.id, 'VOID_ORDER', `Voided Order #${orderId} for ₱${(order.total_amount/100).toFixed(2)}`);
        })();
        
        res.json({ success: true, message: 'Order voided and inventory/balances restored.' });
    } catch (error) { 
        // FIX 2: Log the exact error to your terminal for easy debugging
        console.error("Void Transaction Error:", error.message);
        res.status(400).json({ error: error.message }); 
    }
});

// PHYSICAL STOCK COUNT (Log Shrinkage)
app.post('/api/inventory/count', authenticate, requireRole(['SuperAdmin', 'Admin']), (req, res) => {
    const { product_id, actual_stock, notes } = req.body;
    try {
        db.transaction(() => {
            const product = db.prepare('SELECT name, stock_quantity FROM products WHERE id = ?').get(product_id);
            if (!product) throw new Error('Product not found.');

            const variance = actual_stock - product.stock_quantity;
            
            // Log the count
            db.prepare('INSERT INTO stock_counts (product_id, user_id, expected_stock, actual_stock, variance, notes) VALUES (?, ?, ?, ?, ?, ?)')
              .run(product_id, req.user.id, product.stock_quantity, actual_stock, variance, notes || '');
            
            // Update actual stock
            db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(actual_stock, product_id);
            
            logAudit(req.user.id, 'STOCK_COUNT', `Adjusted ${product.name} from ${product.stock_quantity} to ${actual_stock} (Variance: ${variance})`);
        })();
        res.json({ success: true });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

// ==========================================
// 5. BUSINESS INTELLIGENCE (BI) REPORTS
// ==========================================
app.get('/api/reports/dashboard', authenticate, requirePermission('perm_view_reports'), (req, res) => {
    try {
        // High-level Stats (Only counting 'Completed' orders)
        const stats = db.prepare(`
            SELECT 
                COUNT(id) as total_orders, 
                SUM(total_amount) as total_revenue
            FROM orders WHERE status = 'Completed'
        `).get();

        // Calculate COGS and Profit Margin
        const cogsData = db.prepare(`
            SELECT SUM(quantity * cost_at_sale) as total_cogs
            FROM order_items JOIN orders ON order_items.order_id = orders.id
            WHERE orders.status = 'Completed'
        `).get();
        
        const totalProfit = (stats.total_revenue || 0) - (cogsData.total_cogs || 0);

        // Low Stock Alerts (Custom Thresholds)
        const lowStock = db.prepare('SELECT name, stock_quantity, low_stock_threshold FROM products WHERE is_active = 1 AND stock_quantity <= low_stock_threshold').all();

        // Top 5 Best Sellers
        const topItems = db.prepare(`
            SELECT p.name, SUM(oi.quantity) as total_sold, SUM(oi.price_at_sale * oi.quantity) as revenue
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status = 'Completed'
            GROUP BY p.id ORDER BY total_sold DESC LIMIT 5
        `).all();

        // Cashier Performance
        const cashierStats = db.prepare(`
            SELECT u.username, COUNT(o.id) as transactions_processed, SUM(o.total_amount) as total_handled
            FROM orders o JOIN users u ON o.cashier_id = u.id
            WHERE o.status = 'Completed'
            GROUP BY u.id ORDER BY total_handled DESC
        `).all();

        res.json({
            stats: { 
                orders: stats.total_orders || 0, 
                revenue: stats.total_revenue || 0, 
                profit: totalProfit,
                cogs: cogsData.total_cogs || 0
            },
            lowStock, topItems, cashierStats
        });
    } catch (error) { res.status(500).json({ error: 'Failed to generate BI report' }); }
});

// Customer / Employee Deep Dive Analytics
app.get('/api/reports/employee/:id', authenticate, requirePermission('perm_view_reports'), (req, res) => {
    try {
        const empId = req.params.id;
        
        // FIX 1: Use safe optional chaining (?.) and single quotes for 'Completed'
        const spentRow = db.prepare(`
            SELECT SUM(total_amount) as total 
            FROM orders 
            WHERE employee_id = ? AND status = 'Completed'
        `).get(empId);
        
        // Safely extract the total, defaulting to 0 if undefined or null
        const totalSpent = spentRow?.total || 0;
        
        // FIX 2: Ensure single quotes are used here as well
        const favoriteItems = db.prepare(`
            SELECT p.name, SUM(oi.quantity) as times_bought
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN orders o ON oi.order_id = o.id
            WHERE o.employee_id = ? AND o.status = 'Completed'
            GROUP BY p.id 
            ORDER BY times_bought DESC 
            LIMIT 5
        `).all(empId);

        res.json({ totalSpent, favoriteItems });
    } catch (error) { 
        // Added a console.log so if it ever fails again, your terminal tells you exactly why
        console.error("Employee Analytics Error:", error.message);
        res.status(500).json({ error: 'Failed to fetch customer analytics: ' + error.message }); 
    }
});

// Fetch Audit Logs
app.get('/api/audit-logs', authenticate, requireRole(['SuperAdmin', 'Admin']), (req, res) => {
    res.json(db.prepare(`
        SELECT a.*, u.username FROM audit_logs a 
        JOIN users u ON a.user_id = u.id 
        ORDER BY a.created_at DESC LIMIT 50
    `).all());
});

// ==========================================
// 6. STANDARD ROUTES (Menu, Employees, Basic Settings)
// ==========================================
app.get('/api/menu', authenticate, (req, res) => {
    res.json(db.prepare('SELECT products.*, categories.name as category_name FROM products JOIN categories ON products.category_id = categories.id WHERE is_active = 1').all());
});

app.get('/api/categories', authenticate, (req, res) => res.json(db.prepare('SELECT * FROM categories').all()));

app.post('/api/products', authenticate, requirePermission('perm_manage_menu'), (req, res) => {
    const { category_id, name, price, cost_price, stock_quantity, low_stock_threshold } = req.body;
    db.prepare('INSERT INTO products (category_id, name, price, cost_price, stock_quantity, low_stock_threshold, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(category_id, name, price, cost_price || 0, stock_quantity || 0, low_stock_threshold || 10);
    logAudit(req.user.id, 'ADD_PRODUCT', `Added ${name}`);
    res.json({ success: true });
});

app.put('/api/products/:id', authenticate, requirePermission('perm_manage_menu'), (req, res) => {
    const { category_id, name, price, cost_price, stock_quantity, low_stock_threshold } = req.body;
    db.prepare('UPDATE products SET category_id = ?, name = ?, price = ?, cost_price = ?, stock_quantity = ?, low_stock_threshold = ? WHERE id = ?')
      .run(category_id, name, price, cost_price || 0, stock_quantity || 0, low_stock_threshold || 10, req.params.id);
    logAudit(req.user.id, 'UPDATE_PRODUCT', `Updated ${name}`);
    res.json({ success: true });
});

app.delete('/api/products/:id', authenticate, requirePermission('perm_manage_menu'), (req, res) => {
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
    logAudit(req.user.id, 'ARCHIVE_PRODUCT', `Archived product ID ${req.params.id}`);
    res.json({ success: true });
});

app.get('/api/employees', authenticate, (req, res) => {
    res.json(db.prepare('SELECT * FROM employees WHERE is_active = 1 ORDER BY name ASC').all());
});

app.post('/api/employees', authenticate, requirePermission('perm_edit_employee'), (req, res) => {
    const { barcode, name, credit_allowed, credit_limit, daily_allowance } = req.body;
    db.prepare('INSERT INTO employees (barcode, name, credit_allowed, credit_limit, free_meal_balance, daily_allowance, last_meal_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .run(barcode, name, credit_allowed, credit_limit, daily_allowance, daily_allowance, getTodayDate());
    logAudit(req.user.id, 'ADD_EMPLOYEE', `Registered ${name}`);
    res.json({ success: true });
});

app.put('/api/employees/:id', authenticate, requirePermission('perm_edit_employee'), (req, res) => {
    const { barcode, name, credit_allowed, credit_limit, daily_allowance } = req.body;
    db.prepare('UPDATE employees SET barcode = ?, name = ?, credit_allowed = ?, credit_limit = ?, daily_allowance = ? WHERE id = ?')
      .run(barcode, name, credit_allowed, credit_limit, daily_allowance, req.params.id);
    logAudit(req.user.id, 'UPDATE_EMPLOYEE', `Updated ${name}`);
    res.json({ success: true });
});

app.delete('/api/employees/:id', authenticate, requirePermission('perm_archive_employee'), (req, res) => {
    db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?').run(req.params.id);
    logAudit(req.user.id, 'ARCHIVE_EMPLOYEE', `Archived employee ID ${req.params.id}`);
    res.json({ success: true });
});

// Need the standard sales feed for the "Transactions" tab (Historical log)
app.get('/api/sales', authenticate, requirePermission('perm_view_transactions'), (req, res) => {
    const recentOrders = db.prepare(`
        SELECT orders.id, orders.total_amount, orders.payment_method, orders.status, orders.created_at, employees.name as employee_name, users.username as cashier_name
        FROM orders 
        LEFT JOIN employees ON orders.employee_id = employees.id
        LEFT JOIN users ON orders.cashier_id = users.id
        ORDER BY orders.created_at DESC LIMIT 50
    `).all();
    res.json({ recentOrders });
});

// Settings operations
app.post('/api/settings/reset-meals', authenticate, requirePermission('perm_access_settings'), (req, res) => {
    db.prepare('UPDATE employees SET free_meal_balance = daily_allowance, last_meal_date = ? WHERE is_active = 1').run(getTodayDate());
    logAudit(req.user.id, 'FORCE_RESET', 'Manually reset all free meal balances.');
    res.json({ success: true });
});

app.post('/api/settings/factory-reset', authenticate, requireRole(['SuperAdmin']), (req, res) => {
    db.transaction(() => {
        db.exec(`DELETE FROM order_items; DELETE FROM orders; DELETE FROM employees; DELETE FROM products; DELETE FROM stock_counts; DELETE FROM audit_logs;`);
    })();
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`BI Server running on http://localhost:${PORT}`));