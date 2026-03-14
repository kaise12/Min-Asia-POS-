// src/pages/AdminDashboard.jsx
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function AdminDashboard() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuthStore();
  
  // Role Calculations
  const isSuperAdmin = user?.role === 'SuperAdmin';
  const isAdmin = user?.role === 'Admin';
  
  const canManageUsers = isSuperAdmin || isAdmin;
  const canViewAudit = isSuperAdmin || isAdmin;
  const canManageMenu = user?.role !== 'Cashier' || user?.perm_manage_menu === 1;
  const canManageEmployees = user?.role !== 'Cashier' || user?.perm_edit_employee === 1 || user?.perm_archive_employee === 1;
  const canViewTransactions = user?.role !== 'Cashier' || user?.perm_view_transactions === 1;
  const canAccessSettings = user?.role !== 'Cashier' || user?.perm_access_settings === 1;
  const canViewReports = user?.role !== 'Cashier' || user?.perm_view_reports === 1;

  const [activeTab, setActiveTab] = useState(canViewReports ? 'reports' : 'menu');
  
  // Data States
  const [salesData, setSalesData] = useState({ recentOrders: [] });
  const [reportsData, setReportsData] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });
  const [editingId, setEditingId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modals
  const [countModal, setCountModal] = useState({ isOpen: false, product: null, actual: '', notes: '' });
  const [empAnalyticsModal, setEmpAnalyticsModal] = useState({ isOpen: false, data: null, name: '' });

  // Forms
  const [productForm, setProductForm] = useState({ name: '', category_id: '', cost_price: '', price: '', stock_quantity: '', low_stock_threshold: '10' });
  const [employeeForm, setEmployeeForm] = useState({ barcode: '', name: '', credit_allowed: 1, credit_limit: '', daily_allowance: '50.00' });
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'Cashier', permissions: { editEmp: 0, archEmp: 0, viewTrans: 0, settings: 0, menu: 0, reports: 0 }});

  const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  const handleLogout = () => { logout(); navigate('/login'); };
  const formatPrice = (cents) => `₱${((cents || 0) / 100).toFixed(2)}`;
  const formatDate = (dateString) => new Date(dateString).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const showMessage = (type, text) => { setFormMessage({ type, text }); setTimeout(() => setFormMessage({ type: '', text: '' }), 4000); };

  // ==========================================
  // DATA FETCHING
  // ==========================================
  const loadDashboardData = useCallback(() => {
    const promises = [fetch('http://localhost:5000/api/categories', { headers: authHeaders }).then(r => r.json())];
    
    if (canManageMenu) promises.push(fetch('http://localhost:5000/api/menu', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve([]));
    if (canManageEmployees) promises.push(fetch('http://localhost:5000/api/employees', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve([]));
    if (canViewTransactions) promises.push(fetch('http://localhost:5000/api/sales', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve({ recentOrders: [] }));
    if (canManageUsers) promises.push(fetch('http://localhost:5000/api/users', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve([]));
    if (canViewReports) promises.push(fetch('http://localhost:5000/api/reports/dashboard', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve(null));
    if (canViewAudit) promises.push(fetch('http://localhost:5000/api/audit-logs', { headers: authHeaders }).then(r => r.json())); else promises.push(Promise.resolve([]));

    Promise.all(promises).then(([cats, menuData, empsData, salesData, usersData, reports, audits]) => {
      if (cats.error) { handleLogout(); return; }
      setCategories(cats); setProducts(menuData); setEmployees(empsData); setSalesData(salesData); setUsers(usersData); setReportsData(reports); setAuditLogs(audits);
      
      // Auto-select category for product form if empty
      if (cats.length > 0 && !editingId && !productForm.category_id) {
        setProductForm(prev => ({ ...prev, category_id: cats[0].id }));
      }
      setLoading(false);
    }).catch(() => { setLoading(false); showMessage('error', 'Failed to load some dashboard data.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  // ==========================================
  // ACTION HANDLERS
  // ==========================================
  const handleVoidOrder = async (id) => {
    if (!window.confirm(`Admin Action Required: Are you sure you want to VOID Order #${id}? This will restore stock and refund balances.`)) return;
    try {
      const res = await fetch(`http://localhost:5000/api/orders/${id}/void`, { method: 'POST', headers: authHeaders });
      const data = await res.json();
      if (res.ok) { showMessage('success', `Order #${id} voided successfully.`); loadDashboardData(); } 
      else { showMessage('error', data.error || 'Failed to void order.'); }
    } catch (err) { showMessage('error', 'Network error reaching server.'); }
  };

  const handleStockCountSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:5000/api/inventory/count', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ product_id: countModal.product.id, actual_stock: parseInt(countModal.actual), notes: countModal.notes })
      });
      if (res.ok) { showMessage('success', 'Physical count logged and stock updated.'); setCountModal({ isOpen: false, product: null, actual: '', notes: '' }); loadDashboardData(); }
      else { const data = await res.json(); showMessage('error', data.error); }
    } catch (err) { showMessage('error', 'Network error.'); }
  };

  const fetchEmployeeAnalytics = async (emp) => {
    try {
      const res = await fetch(`http://localhost:5000/api/reports/employee/${emp.id}`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok) { setEmpAnalyticsModal({ isOpen: true, data, name: emp.name }); }
      else { showMessage('error', data.error || 'Failed to fetch analytics.'); }
    } catch (err) { showMessage('error', 'Could not load analytics. Network error.'); }
  };

  const handleArchive = async (type, id) => {
    if (!window.confirm(`Are you sure you want to archive this ${type}? It will be hidden from the active system.`)) return;
    try {
      const res = await fetch(`http://localhost:5000/api/${type}s/${id}`, { method: 'DELETE', headers: authHeaders });
      if (res.ok) { showMessage('success', `${type} archived.`); loadDashboardData(); } 
      else { const data = await res.json(); showMessage('error', data.error); }
    } catch (err) { showMessage('error', 'Network error.'); }
  };

  // ==========================================
  // FORM SUBMISSIONS (Products, Employees, Users)
  // ==========================================
  const handleProductSubmit = async (e) => {
    e.preventDefault(); setIsSubmitting(true);
    const payload = { 
        name: productForm.name, category_id: parseInt(productForm.category_id), 
        price: Math.round(parseFloat(productForm.price) * 100), cost_price: Math.round(parseFloat(productForm.cost_price || 0) * 100), 
        stock_quantity: parseInt(productForm.stock_quantity) || 0, low_stock_threshold: parseInt(productForm.low_stock_threshold) || 10 
    };
    const url = editingId ? `http://localhost:5000/api/products/${editingId}` : 'http://localhost:5000/api/products';
    try {
      const res = await fetch(url, { method: editingId ? 'PUT' : 'POST', headers: authHeaders, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) { showMessage('success', 'Menu updated!'); setEditingId(null); setProductForm({ name: '', category_id: categories[0].id, cost_price: '', price: '', stock_quantity: '', low_stock_threshold: '10' }); loadDashboardData(); }
      else { showMessage('error', data.error); }
    } catch (err) { showMessage('error', 'Network error.'); } finally { setIsSubmitting(false); }
  };

  const handleEmployeeSubmit = async (e) => {
    e.preventDefault(); setIsSubmitting(true);
    const payload = {
      barcode: employeeForm.barcode, name: employeeForm.name, credit_allowed: parseInt(employeeForm.credit_allowed),
      credit_limit: employeeForm.credit_limit ? Math.round(parseFloat(employeeForm.credit_limit) * 100) : 0,
      daily_allowance: Math.round(parseFloat(employeeForm.daily_allowance) * 100)
    };
    const url = editingId ? `http://localhost:5000/api/employees/${editingId}` : 'http://localhost:5000/api/employees';
    try {
      const res = await fetch(url, { method: editingId ? 'PUT' : 'POST', headers: authHeaders, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) { showMessage('success', 'Employee saved!'); setEditingId(null); setEmployeeForm({ barcode: '', name: '', credit_allowed: 1, credit_limit: '', daily_allowance: '50.00' }); loadDashboardData(); }
      else { showMessage('error', data.error); }
    } catch (err) { showMessage('error', 'Network error.'); } finally { setIsSubmitting(false); }
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault(); setIsSubmitting(true);
    try {
      const res = await fetch('http://localhost:5000/api/users', { method: 'POST', headers: authHeaders, body: JSON.stringify(userForm) });
      const data = await res.json();
      if (res.ok) { showMessage('success', `User ${userForm.username} created!`); setUserForm({ username: '', password: '', role: 'Cashier', permissions: { editEmp: 0, archEmp: 0, viewTrans: 0, settings: 0, menu: 0, reports: 0 }}); loadDashboardData(); } 
      else { showMessage('error', data.error); }
    } catch (err) { showMessage('error', 'Network error.'); } finally { setIsSubmitting(false); }
  };

  const handleGlobalReset = async () => {
    if (!window.confirm("Are you sure you want to reset ALL employees' Free Meal balances right now?")) return;
    try {
      const res = await fetch('http://localhost:5000/api/settings/reset-meals', { method: 'POST', headers: authHeaders });
      if (res.ok) { showMessage('success', 'All Free Meals reset.'); loadDashboardData(); }
    } catch (err) { showMessage('error', 'Network error.'); }
  };

  const handleFactoryReset = async () => {
    const code = prompt("SUPERADMIN ONLY: Type 'WIPE_EVERYTHING' to permanently delete all operational data. This cannot be undone.");
    if (code !== 'WIPE_EVERYTHING') { alert("Incorrect code. Factory reset aborted."); return; }
    try {
      const res = await fetch('http://localhost:5000/api/settings/factory-reset', { method: 'POST', headers: authHeaders });
      if (res.ok) { alert("Factory Reset Complete. System wiped."); window.location.reload(); }
    } catch (err) { showMessage('error', 'Failed to execute factory reset.'); }
  };

  if (loading) return <div className="flex h-screen items-center justify-center text-xl font-bold text-gray-500">Loading Enterprise Dashboard...</div>;

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden relative">
      
      {/* SIDEBAR NAVIGATION */}
      <div className="w-64 bg-gray-900 text-white flex flex-col shadow-xl z-20 shrink-0">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-2xl font-black tracking-tight">{user?.role}</h1>
          <p className="text-gray-400 text-sm font-medium mt-1">@{user?.username}</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {canViewReports && <button onClick={() => { setActiveTab('reports'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'reports' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>📈 BI Reports</button>}
          {canManageMenu && <button onClick={() => { setActiveTab('menu'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'menu' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>🍔 Menu & Inventory</button>}
          {canManageEmployees && <button onClick={() => { setActiveTab('employees'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'employees' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>👥 Employees</button>}
          {canViewTransactions && <button onClick={() => { setActiveTab('orders'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'orders' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>🧾 Transactions</button>}
          
          {(canManageUsers || canViewAudit || canAccessSettings) && (
            <div className="pt-4 mt-4 border-t border-gray-800">
              <p className="px-4 text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Security & Admin</p>
              {canManageUsers && <button onClick={() => { setActiveTab('users'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>🛡️ User Accounts</button>}
              {canViewAudit && <button onClick={() => { setActiveTab('audit'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'audit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>📋 Audit Logs</button>}
              {canAccessSettings && <button onClick={() => { setActiveTab('settings'); setEditingId(null); }} className={`w-full text-left px-4 py-3 rounded-xl font-bold transition-all ${activeTab === 'settings' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>⚙️ Global Settings</button>}
            </div>
          )}
        </nav>
        <div className="p-4 border-t border-gray-800"><Link to="/" className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 rounded-xl text-center block">Back to POS</Link></div>
      </div>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        <div className="bg-white p-6 shadow-sm border-b border-gray-100 flex justify-between items-center z-10 shrink-0">
           <h2 className="text-2xl font-black text-gray-800 capitalize">{activeTab} Dashboard</h2>
        </div>

        {formMessage.text && (
          <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50">
            <div className={`px-6 py-3 rounded-full shadow-lg font-bold text-sm ${formMessage.type === 'success' ? 'bg-green-500' : 'bg-red-500'} text-white`}>{formMessage.text}</div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-8">
          
          {/* ==========================================
              TAB: BI REPORTS
          ========================================== */}
          {activeTab === 'reports' && reportsData && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-blue-500">
                  <p className="text-sm font-bold text-gray-400 uppercase">Gross Revenue</p>
                  <h3 className="text-3xl font-black text-gray-800">{formatPrice(reportsData.stats.revenue)}</h3>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-red-400">
                  <p className="text-sm font-bold text-gray-400 uppercase">Total COGS (Cost)</p>
                  <h3 className="text-3xl font-black text-gray-800">{formatPrice(reportsData.stats.cogs)}</h3>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-green-500">
                  <p className="text-sm font-bold text-gray-400 uppercase">Net Profit</p>
                  <h3 className="text-3xl font-black text-green-600">{formatPrice(reportsData.stats.profit)}</h3>
                  <p className="text-xs font-bold text-gray-400 mt-1">Margin: {reportsData.stats.revenue > 0 ? ((reportsData.stats.profit / reportsData.stats.revenue) * 100).toFixed(1) : 0}%</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-purple-500">
                  <p className="text-sm font-bold text-gray-400 uppercase">Total Orders</p>
                  <h3 className="text-3xl font-black text-gray-800">{reportsData.stats.orders}</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm">
                  <h3 className="font-bold text-gray-800 mb-6">Top 5 Best-Selling Items</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportsData.topItems} layout="vertical" margin={{ left: 40 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={12} width={100} />
                        <Tooltip cursor={{fill: 'transparent'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                        <Bar dataKey="total_sold" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                          {reportsData.topItems.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm">
                  <h3 className="font-bold text-gray-800 mb-6">Cashier Performance (Transactions)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={reportsData.cashierStats} dataKey="transactions_processed" nameKey="username" cx="50%" cy="50%" outerRadius={80} fill="#8884d8" label={({username, percent}) => `${username} (${(percent * 100).toFixed(0)}%)`}>
                          {reportsData.cashierStats.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {reportsData.lowStock.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                  <h3 className="font-bold text-red-800 mb-4 flex items-center gap-2">⚠️ Low Stock Alerts</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {reportsData.lowStock.map(item => (
                      <div key={item.name} className="bg-white p-4 rounded-xl shadow-sm border border-red-100">
                        <p className="font-bold text-gray-800">{item.name}</p>
                        <p className="text-sm font-medium text-red-600">Current: {item.stock_quantity} (Threshold: {item.low_stock_threshold})</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==========================================
              TAB: MENU (PRODUCTS)
          ========================================== */}
          {activeTab === 'menu' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 lg:col-span-1 p-6 h-fit">
                <h3 className="text-xl font-bold mb-4">{editingId ? 'Edit Item' : 'Add Item'}</h3>
                <form onSubmit={handleProductSubmit} className="space-y-4">
                  <input type="text" placeholder="Item Name" value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required />
                  <select value={productForm.category_id} onChange={(e) => setProductForm({...productForm, category_id: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required>{categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs font-bold text-gray-500">Cost (Supplier)</label><input type="number" step="0.01" min="0" value={productForm.cost_price} onChange={(e) => setProductForm({...productForm, cost_price: e.target.value})} className="w-full border-2 p-2 rounded-xl" required /></div>
                    <div><label className="text-xs font-bold text-gray-500">Selling Price</label><input type="number" step="0.01" min="0" value={productForm.price} onChange={(e) => setProductForm({...productForm, price: e.target.value})} className="w-full border-2 p-2 rounded-xl" required /></div>
                    <div><label className="text-xs font-bold text-gray-500">Initial Stock</label><input type="number" value={productForm.stock_quantity} onChange={(e) => setProductForm({...productForm, stock_quantity: e.target.value})} className="w-full border-2 p-2 rounded-xl" /></div>
                    <div><label className="text-xs font-bold text-gray-500">Low Stock Alert At</label><input type="number" value={productForm.low_stock_threshold} onChange={(e) => setProductForm({...productForm, low_stock_threshold: e.target.value})} className="w-full border-2 p-2 rounded-xl" /></div>
                  </div>
                  <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all">Save Item</button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setProductForm({ name: '', category_id: categories[0]?.id || '', cost_price: '', price: '', stock_quantity: '', low_stock_threshold: '10' }); }} className="w-full text-gray-500 font-bold text-sm mt-2">Cancel Edit</button>}
                </form>
              </div>
              <div className="bg-white rounded-2xl shadow-sm lg:col-span-2 overflow-auto h-[700px]">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 sticky top-0 shadow-sm"><tr className="text-xs uppercase text-gray-500"><th className="p-4">Item</th><th className="p-4">Cost / Price</th><th className="p-4">Stock</th><th className="p-4 text-right">Actions</th></tr></thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.id} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-4 font-bold">{p.name} <span className="block text-xs text-gray-400 font-normal">{p.category_name}</span></td>
                        <td className="p-4"><span className="text-red-500 text-sm block">{formatPrice(p.cost_price)} Cost</span><span className="text-green-600 font-bold">{formatPrice(p.price)} Sell</span></td>
                        <td className="p-4"><span className={`font-bold ${p.stock_quantity <= p.low_stock_threshold ? 'text-red-500' : 'text-gray-800'}`}>{p.stock_quantity}</span></td>
                        <td className="p-4 text-right">
                          <button onClick={() => setCountModal({ isOpen: true, product: p, actual: '', notes: '' })} className="text-xs font-bold bg-purple-50 text-purple-600 hover:bg-purple-100 px-2 py-1.5 rounded mr-2 transition-colors">Count Stock</button>
                          <button onClick={() => {setEditingId(p.id); setProductForm({ name: p.name, category_id: p.category_id, cost_price: (p.cost_price/100).toFixed(2), price: (p.price/100).toFixed(2), stock_quantity: p.stock_quantity, low_stock_threshold: p.low_stock_threshold })}} className="text-xs font-bold bg-amber-50 text-amber-600 hover:bg-amber-100 px-3 py-1.5 rounded mr-2 transition-colors">Edit</button>
                          <button onClick={() => handleArchive('product', p.id)} className="text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 px-2 py-1.5 rounded transition-colors">Archive</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==========================================
              TAB: EMPLOYEES
          ========================================== */}
          {activeTab === 'employees' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 lg:col-span-1 p-6 h-fit">
                <h3 className="text-xl font-bold mb-4">{editingId ? 'Edit Employee' : 'Register Employee'}</h3>
                <form onSubmit={handleEmployeeSubmit} className="space-y-4">
                  <div><label className="block text-sm font-bold text-gray-600 mb-1">Barcode / ID Number</label><input type="text" value={employeeForm.barcode} onChange={(e) => setEmployeeForm({...employeeForm, barcode: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required /></div>
                  <div><label className="block text-sm font-bold text-gray-600 mb-1">Full Name</label><input type="text" value={employeeForm.name} onChange={(e) => setEmployeeForm({...employeeForm, name: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required /></div>
                  <div>
                    <label className="block text-sm font-bold text-gray-600 mb-1">Credit Privileges</label>
                    <select value={employeeForm.credit_allowed} onChange={(e) => setEmployeeForm({...employeeForm, credit_allowed: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none">
                      <option value={1}>Authorized</option><option value={0}>Not Authorized</option>
                    </select>
                  </div>
                  {parseInt(employeeForm.credit_allowed) === 1 && (
                    <div><label className="block text-sm font-bold text-gray-600 mb-1">Credit Limit (₱) <span className="font-normal text-xs text-gray-400">Leave blank for open</span></label><input type="number" step="0.01" min="0" value={employeeForm.credit_limit} onChange={(e) => setEmployeeForm({...employeeForm, credit_limit: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" /></div>
                  )}
                  <div><label className="block text-sm font-bold text-gray-600 mb-1">Daily Free Meal (₱)</label><input type="number" step="0.01" min="0" value={employeeForm.daily_allowance} onChange={(e) => setEmployeeForm({...employeeForm, daily_allowance: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required /></div>
                  <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all">Save Employee</button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setEmployeeForm({ barcode: '', name: '', credit_allowed: 1, credit_limit: '', daily_allowance: '50.00' }); }} className="w-full text-gray-500 font-bold text-sm mt-2">Cancel Edit</button>}
                </form>
              </div>
              <div className="bg-white rounded-2xl shadow-sm lg:col-span-2 overflow-auto h-[700px]">
                 <table className="w-full text-left">
                   <thead className="bg-gray-50 sticky top-0 shadow-sm"><tr className="text-xs uppercase text-gray-500"><th className="p-4">Employee</th><th className="p-4">Balances</th><th className="p-4 text-right">Actions</th></tr></thead>
                   <tbody>
                     {employees.map(emp => (
                       <tr key={emp.id} className="border-b hover:bg-gray-50 transition-colors">
                         <td className="p-4 font-bold">{emp.name} <br/><span className="text-xs font-mono text-gray-400">ID: {emp.barcode}</span></td>
                         <td className="p-4">
                           <span className="text-green-600 font-bold block text-sm">Free: {formatPrice(emp.free_meal_balance)}</span>
                           <span className="text-red-500 font-bold block text-sm">Owes: {formatPrice(emp.credit_balance)}</span>
                         </td>
                         <td className="p-4 text-right">
                           {canViewReports && <button onClick={() => fetchEmployeeAnalytics(emp)} className="text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded mr-2 transition-colors">Analytics</button>}
                           <button onClick={() => {setEditingId(emp.id); setEmployeeForm({ barcode: emp.barcode, name: emp.name, credit_allowed: emp.credit_allowed, credit_limit: emp.credit_limit>0?(emp.credit_limit/100).toFixed(2):'', daily_allowance: (emp.daily_allowance/100).toFixed(2) })}} className="text-xs font-bold text-amber-500 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded mr-2 transition-colors">Edit</button>
                           <button onClick={() => handleArchive('employee', emp.id)} className="text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded transition-colors">Archive</button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
              </div>
            </div>
          )}

          {/* ==========================================
              TAB: TRANSACTIONS (Voids)
          ========================================== */}
          {activeTab === 'orders' && (
             <div className="bg-white rounded-2xl shadow-sm overflow-auto h-[700px]">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 sticky top-0 shadow-sm"><tr className="text-xs uppercase text-gray-500"><th className="p-4">ID / Time</th><th className="p-4">Customer</th><th className="p-4">Processed By</th><th className="p-4 text-right">Amount</th><th className="p-4">Status</th></tr></thead>
                  <tbody>
                    {salesData.recentOrders?.map(order => (
                      <tr key={order.id} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-4"><span className="font-bold">#{order.id}</span><br/><span className="text-xs text-gray-500">{formatDate(order.created_at)}</span></td>
                        <td className="p-4 font-bold text-gray-700">{order.employee_name || 'Walk-In Guest'}</td>
                        <td className="p-4 text-sm text-gray-500">@{order.cashier_name}</td>
                        <td className="p-4 font-black text-right">{formatPrice(order.total_amount)}<br/><span className="text-xs font-normal text-gray-500">{order.payment_method}</span></td>
                        <td className="p-4">
                          {order.status === 'Completed' ? (
                            <div className="flex items-center gap-2">
                              <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold">Completed</span>
                              {(isAdmin || isSuperAdmin) && <button onClick={() => handleVoidOrder(order.id)} className="text-xs text-red-500 underline font-bold hover:text-red-700">Void</button>}
                            </div>
                          ) : ( <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-bold line-through">Voided</span> )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          )}

          {/* ==========================================
              TAB: USERS (RBAC Control)
          ========================================== */}
          {activeTab === 'users' && canManageUsers && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 lg:col-span-1 p-6 h-fit">
                <h3 className="text-xl font-bold mb-4">Create System User</h3>
                <form onSubmit={handleUserSubmit} className="space-y-4">
                  <div><label className="block text-sm font-bold text-gray-600 mb-1">Username</label><input type="text" value={userForm.username} onChange={(e) => setUserForm({...userForm, username: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required /></div>
                  <div><label className="block text-sm font-bold text-gray-600 mb-1">Password</label><input type="password" value={userForm.password} onChange={(e) => setUserForm({...userForm, password: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none" required /></div>
                  <div>
                    <label className="block text-sm font-bold text-gray-600 mb-1">System Role</label>
                    <select value={userForm.role} onChange={(e) => setUserForm({...userForm, role: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-blue-500 outline-none">
                      {isSuperAdmin && <option value="Admin">Admin</option>}
                      <option value="Cashier">Cashier</option>
                    </select>
                  </div>

                  {userForm.role === 'Cashier' && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mt-2 space-y-3">
                      <h4 className="font-bold text-sm text-gray-800 mb-2">Granular Permissions</h4>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.editEmp} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, editEmp: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">Add & Edit Employees</span></label>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.archEmp} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, archEmp: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">Archive Employees</span></label>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.menu} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, menu: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">Manage Menu Items</span></label>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.viewTrans} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, viewTrans: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">View Transactions</span></label>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.reports} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, reports: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">View BI Reports</span></label>
                      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={userForm.permissions.settings} onChange={(e) => setUserForm({...userForm, permissions: {...userForm.permissions, settings: e.target.checked ? 1 : 0}})} className="w-5 h-5 text-blue-600 rounded" /><span className="text-sm font-medium text-gray-700">Access Global Settings</span></label>
                    </div>
                  )}
                  <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all">Create Account</button>
                </form>
              </div>

              <div className="bg-white rounded-2xl shadow-sm lg:col-span-2 overflow-auto h-[700px]">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 sticky top-0 shadow-sm"><tr className="text-xs uppercase text-gray-500"><th className="p-4">Username</th><th className="p-4">Role</th><th className="p-4">Permissions (If Cashier)</th></tr></thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b hover:bg-gray-50">
                        <td className="p-4 font-bold text-gray-800">{u.username}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${u.role === 'SuperAdmin' ? 'bg-purple-100 text-purple-800' : u.role === 'Admin' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{u.role}</span>
                        </td>
                        <td className="p-4 text-xs font-mono text-gray-500">
                          {u.role === 'Cashier' ? (
                            <div className="flex flex-wrap gap-2">
                              {u.perm_edit_employee===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">EditEmp</span>}
                              {u.perm_archive_employee===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">ArchEmp</span>}
                              {u.perm_manage_menu===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">Menu</span>}
                              {u.perm_view_transactions===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">Trans</span>}
                              {u.perm_view_reports===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">Reports</span>}
                              {u.perm_access_settings===1 && <span className="bg-green-50 border border-green-200 text-green-700 px-2 rounded">Settings</span>}
                              {(u.perm_edit_employee===0 && u.perm_archive_employee===0 && u.perm_manage_menu===0 && u.perm_view_transactions===0 && u.perm_access_settings===0 && u.perm_view_reports===0) && <span>Register Only</span>}
                            </div>
                          ) : 'Full Access'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==========================================
              TAB: AUDIT LOGS
          ========================================== */}
          {activeTab === 'audit' && (
             <div className="bg-white rounded-2xl shadow-sm overflow-auto h-[700px]">
                <table className="w-full text-left font-mono text-sm">
                  <thead className="bg-gray-900 text-gray-300 sticky top-0"><tr className="uppercase"><th className="p-4">Timestamp</th><th className="p-4">User</th><th className="p-4">Action</th><th className="p-4">Details</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="p-4 text-gray-500">{formatDate(log.created_at)}</td>
                        <td className="p-4 font-bold text-blue-600">@{log.username}</td>
                        <td className="p-4"><span className="bg-gray-200 text-gray-800 px-2 py-1 rounded font-bold text-xs">{log.action}</span></td>
                        <td className="p-4 text-gray-700">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          )}

          {/* ==========================================
              TAB: SETTINGS
          ========================================== */}
          {activeTab === 'settings' && canAccessSettings && (
             <div className="max-w-2xl space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                  <h4 className="font-bold text-gray-800 text-lg">Force Daily Reset</h4>
                  <p className="text-gray-500 text-sm mt-1 mb-4">Manually force all employees to reset to their maximum daily free meal allowance right now.</p>
                  <button onClick={handleGlobalReset} className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-md active:scale-95">Reset All Free Meals</button>
                </div>

                {isSuperAdmin && (
                  <div className="bg-red-50 rounded-2xl shadow-sm border border-red-200 p-8">
                    <h4 className="font-black text-red-700 text-lg">DANGER ZONE: Factory Reset</h4>
                    <p className="text-red-900 text-sm mt-1 mb-4 font-medium">This permanently deletes ALL operational data (Menu, Employees, Orders, Settings). This cannot be undone.</p>
                    <button onClick={handleFactoryReset} className="bg-red-600 hover:bg-red-700 text-white font-black py-3 px-6 rounded-xl transition-all shadow-md active:scale-95">WIPE ALL DATA</button>
                  </div>
                )}
             </div>
          )}
        </div>
      </main>

      {/* ==========================================
          MODALS
      ========================================== */}
      
      {/* Stock Count Modal */}
      {countModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-2xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold mb-2">Physical Stock Count</h3>
            <p className="text-gray-500 text-sm mb-6">Log the actual shelf count for <strong className="text-gray-800">{countModal.product.name}</strong> to calculate variance.</p>
            <div className="bg-gray-100 p-4 rounded-xl mb-4 flex justify-between">
              <span className="font-bold text-gray-600">System Expected:</span>
              <span className="font-black text-gray-800">{countModal.product.stock_quantity}</span>
            </div>
            <form onSubmit={handleStockCountSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-bold text-gray-700 mb-1">Actual Shelf Count</label>
                <input type="number" min="0" required autoFocus value={countModal.actual} onChange={(e) => setCountModal({...countModal, actual: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-purple-500 outline-none font-bold text-lg" />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-bold text-gray-700 mb-1">Notes / Reason (Optional)</label>
                <input type="text" placeholder="e.g. Found expired items" value={countModal.notes} onChange={(e) => setCountModal({...countModal, notes: e.target.value})} className="w-full border-2 p-3 rounded-xl focus:border-purple-500 outline-none" />
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setCountModal({ isOpen: false, product: null, actual: '', notes: '' })} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition-colors">Cancel</button>
                <button type="submit" className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl transition-colors">Log Count</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Analytics Modal */}
      {empAnalyticsModal.isOpen && empAnalyticsModal.data && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-8 rounded-2xl w-full max-w-md shadow-2xl relative">
            <button onClick={() => setEmpAnalyticsModal({ isOpen: false, data: null, name: '' })} className="absolute top-6 right-6 text-gray-400 hover:text-gray-800 transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            <h3 className="text-2xl font-black mb-2">{empAnalyticsModal.name}'s Profile</h3>
            
            <div className="bg-blue-50 p-6 rounded-2xl mb-6 text-center border border-blue-100">
              <span className="text-blue-800 font-bold uppercase tracking-wider text-xs">Lifetime Total Spent</span>
              <div className="text-4xl font-black text-blue-600 mt-1">{formatPrice(empAnalyticsModal.data.totalSpent)}</div>
            </div>

            <h4 className="font-bold text-gray-800 mb-4">Top Favorite Items</h4>
            {empAnalyticsModal.data.favoriteItems.length === 0 ? (
              <p className="text-gray-500 italic text-center p-4 bg-gray-50 rounded-xl">No purchases recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {empAnalyticsModal.data.favoriteItems.map((item, index) => (
                  <li key={index} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <span className="font-bold text-gray-700">{index + 1}. {item.name}</span>
                    <span className="text-sm font-bold text-gray-500 bg-white px-2 py-1 rounded shadow-sm">Bought {item.times_bought}x</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default AdminDashboard;