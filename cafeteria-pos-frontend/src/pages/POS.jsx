// src/pages/POS.jsx
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore, useCartStore } from '../store'; 

function POS() {
  const navigate = useNavigate();
  // AUTH STATE
  const { user, token, logout } = useAuthStore();

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const [currentCustomer, setCurrentCustomer] = useState(null); 
  const [scanInput, setScanInput] = useState('');
  const scannerInputRef = useRef(null);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentStep, setPaymentStep] = useState('select_method'); 
  const [tenderedInput, setTenderedInput] = useState('');
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, type: 'success', title: '', message: '' });

  const { cart, addToCart, decreaseQuantity, removeFromCart, clearCart, getCartTotal } = useCartStore();

  // Reusable configuration for our secure fetch requests
  const authHeaders = { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    fetch('http://localhost:5000/api/menu', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => {
        if (res.status === 401 || res.status === 403) { handleLogout(); throw new Error('Session Expired'); }
        return res.json();
      })
      .then(data => { setMenuItems(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!currentCustomer && scannerInputRef.current) scannerInputRef.current.focus();
  }, [currentCustomer]);

  const formatPrice = (cents) => `₱${((cents || 0) / 100).toFixed(2)}`;
  const showAlert = (type, title, message) => setAlertConfig({ isOpen: true, type, title, message });
  const closeAlert = () => setAlertConfig({ ...alertConfig, isOpen: false });

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;

    try {
      const response = await fetch('http://localhost:5000/api/scan', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ barcode: scanInput.trim() })
      });
      const data = await response.json();

      if (response.ok) {
        setCurrentCustomer(data);
        setScanInput(''); 
      } else {
        showAlert('error', 'Scan Failed', data.error || 'Employee not found.');
        setScanInput('');
      }
    } catch (err) { showAlert('error', 'Network Error', 'Could not reach the server.'); }
  };

  const resetSession = () => {
    setCurrentCustomer(null);
    clearCart();
    setShowPaymentModal(false);
    setPaymentStep('select_method');
    setTenderedInput('');
  };

  const totalDueCents = getCartTotal();
  const tenderedCents = Math.round(parseFloat(tenderedInput || 0) * 100); 
  const changeCents = tenderedCents - totalDueCents;
  const isValidCashPayment = tenderedCents >= totalDueCents;

  const handleCheckout = async (selectedMethod) => {
    const paymentDetails = {
      method: selectedMethod,
      cashAmount: selectedMethod === 'Cash' ? totalDueCents : 0,
      creditAmount: selectedMethod === 'Credit' ? totalDueCents : 0,
      freeMealAmount: selectedMethod === 'Free Meal' ? totalDueCents : 0
    };

    if (selectedMethod === 'Cash' && !isValidCashPayment) return;
    setIsCheckingOut(true);
    
    try {
      const payload = { cart, employeeId: currentCustomer !== 'guest' ? currentCustomer.id : null, paymentDetails };
      const response = await fetch('http://localhost:5000/api/checkout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (response.ok) {
        let msg = `Order #${data.orderId} recorded successfully.`;
        if (selectedMethod === 'Cash') msg = `Change Due: ${formatPrice(changeCents)}\n` + msg;
        showAlert('success', 'Payment Successful!', msg);
        resetSession(); 
      } else {
        showAlert('error', 'Checkout Failed', data.error);
      }
    } catch (err) { showAlert('error', 'Network Error', 'Could not reach the local server.'); } 
    finally { setIsCheckingOut(false); }
  };

  if (loading) return <div className="flex h-screen items-center justify-center text-xl font-bold text-gray-500">Loading POS...</div>;
  if (error) return <div className="flex h-screen items-center justify-center text-red-500 font-bold">System Error: {error}</div>;

  // ==========================================
  // GATEKEEPER SCREEN (IDLE STATE)
  // ==========================================
  if (!currentCustomer) {
    return (
      <div className="flex h-screen w-full bg-gray-900 flex-col items-center justify-center relative">
        {/* Top Header Controls */}
        <div className="absolute top-6 right-6 flex gap-4">
          <div className="bg-gray-800 text-gray-400 px-5 py-2.5 rounded-xl font-bold border border-gray-700 flex items-center gap-2">
             <span className="w-2 h-2 bg-green-500 rounded-full"></span>
             {user?.username} ({user?.role})
          </div>
          <Link to="/admin" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md active:scale-95">
            Admin Panel
          </Link>
          <button onClick={handleLogout} className="bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md active:scale-95">
            Logout
          </button>
        </div>

        <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-lg w-full text-center">
          <div className="w-24 h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
             <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
          </div>
          <h1 className="text-3xl font-black text-gray-800 mb-2">Ready for Next Customer</h1>
          <p className="text-gray-500 mb-8 font-medium">Scan Employee ID Badge to begin transaction.</p>
          
          <form onSubmit={handleScanSubmit} className="mb-8">
            <input ref={scannerInputRef} type="text" value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Waiting for scanner..." className="w-full bg-gray-50 border-2 border-gray-200 p-4 rounded-xl text-center text-xl font-bold focus:border-blue-500 outline-none transition-all" />
            <button type="submit" className="hidden">Submit</button>
          </form>

          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 font-bold text-sm uppercase">OR</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <button onClick={() => setCurrentCustomer('guest')} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-4 rounded-xl text-lg transition-colors border-2 border-gray-200 active:scale-95">
            Guest / Walk-In Checkout
          </button>
        </div>

        {/* ========================================== */}
        {/* FIX: ADD ALERT MODAL TO GATEKEEPER SCREEN  */}
        {/* ========================================== */}
        {alertConfig.isOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] backdrop-blur-sm">
            <div className="bg-white rounded-3xl p-8 w-[400px] shadow-2xl flex flex-col items-center text-center">
              <h3 className="text-2xl font-black text-gray-800 mb-2">{alertConfig.title}</h3>
              <p className="text-gray-600 mb-8 whitespace-pre-line text-lg font-medium">{alertConfig.message}</p>
              <button onClick={closeAlert} className="w-full font-bold py-4 rounded-xl text-xl bg-gray-800 hover:bg-gray-900 text-white transition-colors">
                OK
              </button>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ==========================================
  // ACTIVE POS SCREEN
  // ==========================================
  const categories = ['All', ...new Set(menuItems.map(item => item.category_name))];
  const displayedItems = searchQuery.trim() !== '' 
    ? menuItems.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : (activeCategory === 'All' ? menuItems : menuItems.filter(item => item.category_name === activeCategory));

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="pt-6 px-6 pb-2 bg-white flex justify-between items-start z-10">
          <div className="flex-1">
            <h1 className="text-2xl font-extrabold text-gray-800 mb-4 tracking-tight">Cafeteria POS</h1>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {categories.map(category => (
                <button key={category} onClick={() => { setActiveCategory(category); setSearchQuery(''); }} className={`px-5 py-2 rounded-full font-bold whitespace-nowrap transition-all ${activeCategory === category && searchQuery === '' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-white shadow-sm z-0 border-t border-gray-50">
          <div className="relative w-full">
            <input type="text" className="block w-full pl-4 pr-12 py-3 bg-gray-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-xl text-lg transition-all font-medium text-gray-800 outline-none" placeholder="Search menu items..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-red-500 transition-colors">✕</button>
            )}
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {displayedItems.map((item) => (
                <button key={item.id} onClick={() => addToCart(item)} disabled={item.stock_quantity <= 0} className={`p-6 rounded-2xl shadow-sm border-2 transition-all flex flex-col items-center justify-center text-center group ${item.stock_quantity <= 0 ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' : 'bg-white border-transparent hover:border-blue-400 hover:shadow-lg active:scale-95'}`}>
                  <span className="font-bold text-lg text-gray-800 mb-3 group-hover:text-blue-600">{item.name}</span>
                  <span className={`px-4 py-1.5 rounded-full font-bold text-sm ${item.stock_quantity <= 0 ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700 border border-blue-100'}`}>
                    {item.stock_quantity <= 0 ? 'Out of Stock' : formatPrice(item.price)}
                  </span>
                </button>
              ))}
            </div>
        </div>
      </div>

      <div className="w-[400px] bg-white shadow-2xl border-l flex flex-col z-20">
        <div className={`p-4 border-b ${currentCustomer === 'guest' ? 'bg-gray-100' : 'bg-blue-50'}`}>
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-black text-gray-800 truncate">{currentCustomer === 'guest' ? 'Walk-In Guest' : currentCustomer.name}</h3>
            <button onClick={resetSession} className="text-xs font-bold text-gray-500 hover:text-red-500 underline">Cancel Order</button>
          </div>
          {currentCustomer !== 'guest' && (
            <div className="flex gap-4 text-xs font-bold">
              <div className="bg-green-100 text-green-800 px-2 py-1 rounded-md">Free: {formatPrice(currentCustomer.free_meal_balance)}</div>
              <div className="bg-red-50 text-red-800 px-2 py-1 rounded-md">Owes: {formatPrice(currentCustomer.credit_balance)}</div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-50/50">
           <ul className="space-y-3">
             {cart.map((cartItem) => (
               <li key={cartItem.id} className="flex flex-col bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                 <div className="flex justify-between items-start mb-3">
                   <span className="font-bold text-gray-800">{cartItem.name}</span>
                   <button onClick={() => removeFromCart(cartItem.id)} className="text-gray-400 hover:text-red-500">✕</button>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="font-bold text-blue-700">{formatPrice(cartItem.price * cartItem.quantity)}</span>
                   <div className="flex items-center bg-gray-100 rounded-lg p-1">
                     <button onClick={() => decreaseQuantity(cartItem.id)} className="w-8 h-8 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 font-bold">-</button>
                     <span className="w-8 text-center font-bold text-gray-800">{cartItem.quantity}</span>
                     <button onClick={() => addToCart(cartItem)} className="w-8 h-8 flex items-center justify-center bg-white rounded shadow-sm text-gray-600 font-bold">+</button>
                   </div>
                 </div>
               </li>
             ))}
           </ul>
        </div>

        <div className="p-6 bg-white border-t shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between items-center mb-4">
            <span className="text-lg font-bold text-gray-500">Total</span>
            <span className="text-3xl font-black text-gray-800">{formatPrice(getCartTotal())}</span>
          </div>
          <button onClick={() => { if(currentCustomer === 'guest') setPaymentStep('cash_input'); else setPaymentStep('select_method'); setShowPaymentModal(true); }} disabled={cart.length === 0} className={`w-full font-bold py-5 rounded-2xl text-xl transition-all ${cart.length === 0 ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg'}`}>
             Pay {formatPrice(getCartTotal())}
          </button>
        </div>
      </div>

      {/* PAYMENT MODAL & ALERTS (Kept exactly as before) */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-[500px] shadow-2xl flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-gray-800">{paymentStep === 'select_method' ? 'Select Payment Method' : 'Cash Payment'}</h2>
              <button onClick={() => { setShowPaymentModal(false); setTenderedInput(''); }} className="text-gray-400 hover:text-gray-800 transition-colors">✕</button>
            </div>
            <div className="bg-gray-100 p-6 rounded-2xl mb-6 text-center">
              <span className="text-gray-500 font-bold uppercase tracking-wider text-sm">Total Due</span>
              <div className="text-5xl font-black text-gray-800 mt-2">{formatPrice(totalDueCents)}</div>
            </div>

            {paymentStep === 'select_method' && (
              <div className="flex flex-col space-y-4">
                <button onClick={() => handleCheckout('Free Meal')} disabled={currentCustomer.free_meal_balance < totalDueCents || isCheckingOut} className={`w-full py-4 rounded-xl font-bold text-lg border-2 flex flex-col items-center ${currentCustomer.free_meal_balance < totalDueCents ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'}`}>
                  <span>Deduct from Free Meal</span><span className="text-sm font-medium mt-1">Available: {formatPrice(currentCustomer.free_meal_balance)}</span>
                </button>
                <button onClick={() => handleCheckout('Credit')} disabled={currentCustomer.credit_allowed === 0 || (currentCustomer.credit_limit > 0 && (currentCustomer.credit_balance + totalDueCents > currentCustomer.credit_limit)) || isCheckingOut} className={`w-full py-4 rounded-xl font-bold text-lg border-2 flex flex-col items-center ${currentCustomer.credit_allowed === 0 || (currentCustomer.credit_limit > 0 && (currentCustomer.credit_balance + totalDueCents > currentCustomer.credit_limit)) ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                  <span>Charge to Credit</span>
                  <span className="text-sm font-medium mt-1">{currentCustomer.credit_allowed === 0 ? 'Not Authorized' : currentCustomer.credit_limit > 0 ? `Limit: ${formatPrice(currentCustomer.credit_limit)}` : 'Open Credit'}</span>
                </button>
                <div className="relative flex py-2 items-center"><div className="flex-grow border-t border-gray-200"></div><span className="flex-shrink-0 mx-4 text-gray-400 font-bold text-sm uppercase">OR</span><div className="flex-grow border-t border-gray-200"></div></div>
                <button onClick={() => setPaymentStep('cash_input')} className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-4 rounded-xl text-lg transition-colors active:scale-95">Pay with Cash</button>
              </div>
            )}

            {paymentStep === 'cash_input' && (
              <>
                <div className="mb-6"><label className="block text-gray-600 font-bold mb-2">Cash Tendered (₱)</label><input type="number" autoFocus value={tenderedInput} onChange={(e) => setTenderedInput(e.target.value)} placeholder="0.00" className="w-full bg-white border-2 border-gray-200 p-4 rounded-xl text-2xl font-bold text-gray-800 focus:border-blue-500 outline-none" /></div>
                <div className="grid grid-cols-4 gap-2 mb-6">
                  <button onClick={() => setTenderedInput((totalDueCents / 100).toString())} className="bg-blue-50 text-blue-700 font-bold py-3 rounded-xl border border-blue-200">Exact</button>
                  <button onClick={() => setTenderedInput('100')} className="bg-gray-50 text-gray-700 font-bold py-3 rounded-xl border border-gray-200">₱100</button>
                  <button onClick={() => setTenderedInput('500')} className="bg-gray-50 text-gray-700 font-bold py-3 rounded-xl border border-gray-200">₱500</button>
                  <button onClick={() => setTenderedInput('1000')} className="bg-gray-50 text-gray-700 font-bold py-3 rounded-xl border border-gray-200">₱1000</button>
                </div>
                <div className="flex justify-between items-end mb-8 border-t-2 border-dashed border-gray-200 pt-6">
                  <span className="text-xl font-bold text-gray-500">Change</span>
                  <span className={`text-4xl font-black ${isValidCashPayment ? 'text-green-500' : 'text-red-400'}`}>{tenderedInput ? formatPrice(changeCents) : '₱0.00'}</span>
                </div>
                <div className="flex gap-4">
                  {currentCustomer !== 'guest' && <button onClick={() => setPaymentStep('select_method')} className="px-6 py-5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-2xl">Back</button>}
                  <button onClick={() => handleCheckout('Cash')} disabled={!isValidCashPayment || isCheckingOut} className={`flex-1 font-bold py-5 rounded-2xl text-xl transition-all ${!isValidCashPayment || isCheckingOut ? 'bg-gray-200 text-gray-400' : 'bg-green-500 hover:bg-green-600 text-white'}`}>{isCheckingOut ? 'Processing...' : 'Complete Transaction'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {alertConfig.isOpen && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] backdrop-blur-sm">
           <div className="bg-white rounded-3xl p-8 w-[400px] shadow-2xl flex flex-col items-center text-center">
             <h3 className="text-2xl font-black text-gray-800 mb-2">{alertConfig.title}</h3>
             <p className="text-gray-600 mb-8 whitespace-pre-line text-lg font-medium">{alertConfig.message}</p>
             <button onClick={closeAlert} className="w-full font-bold py-4 rounded-xl text-xl bg-gray-800 text-white">OK</button>
           </div>
         </div>
       )}
    </div>
  )
}

export default POS;