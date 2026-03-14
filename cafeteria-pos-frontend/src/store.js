// src/store.js
import { create } from 'zustand';

// ==========================================
// NEW: AUTHENTICATION STORE
// ==========================================
export const useAuthStore = create((set) => ({
  // Check if we already have a saved session in the browser when the app loads
  user: JSON.parse(localStorage.getItem('pos_user')) || null,
  token: localStorage.getItem('pos_token') || null,

  // Function to trigger on successful login
  login: (userData, tokenData) => {
    localStorage.setItem('pos_user', JSON.stringify(userData));
    localStorage.setItem('pos_token', tokenData);
    set({ user: userData, token: tokenData });
  },

  // Function to trigger when clicking Logout
  logout: () => {
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    set({ user: null, token: null });
  }
}));

// ==========================================
// EXISTING: CART STORE
// ==========================================
export const useCartStore = create((set, get) => ({
  cart: [],

  addToCart: (product) => set((state) => {
    const existingItem = state.cart.find(item => item.id === product.id);
    if (existingItem) {
      return {
        cart: state.cart.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      };
    }
    return { cart: [...state.cart, { ...product, quantity: 1 }] };
  }),

  decreaseQuantity: (productId) => set((state) => {
    const existingItem = state.cart.find(item => item.id === productId);
    if (existingItem && existingItem.quantity > 1) {
      return {
        cart: state.cart.map(item =>
          item.id === productId ? { ...item, quantity: item.quantity - 1 } : item
        )
      };
    }
    return state; 
  }),

  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter(item => item.id !== productId)
  })),

  clearCart: () => set({ cart: [] }),

  getCartTotal: () => {
    const currentCart = get().cart;
    return currentCart.reduce((total, item) => total + (item.price * item.quantity), 0);
  }
}));