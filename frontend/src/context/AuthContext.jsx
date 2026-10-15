import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      // Read from localStorage for offline persistence
      const stored = localStorage.getItem('hms_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage first
    const token = localStorage.getItem('hms_token');
    
    if (token) {
      authApi.getMe()
        .then((res) => {
          const userData = res?.data || res;
          if (userData && userData.id) {
            setUser(userData);
            localStorage.setItem('hms_user', JSON.stringify(userData));
          } else {
            logout();
          }
        })
        .catch((error) => {
          if (!error.response || error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
            console.warn('Network error: keeping offline session');
          } else {
            logout();
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (credentials) => {
    const res = await authApi.login(credentials);
    const payload = res?.data || res; // Handle both wrapped and unwrapped responses safely
    
    if (!payload || !payload.user) {
      throw new Error('Invalid response from server: User data missing');
    }
    
    const { user, token } = payload;
    
    // Store in localStorage for offline persistence
    if (token) localStorage.setItem('hms_token', token);
    localStorage.setItem('hms_user', JSON.stringify(user));
    setUser(user);
    return user;
  }, []);

  const signup = useCallback(async (data) => {
    const res = await authApi.signup(data);
    return res.data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('hms_token');
    localStorage.removeItem('hms_user');
    setUser(null);
  }, []);

  const hasRole = useCallback((...roles) => roles.includes(user?.role), [user]);
  const canEdit = useCallback((uploaderId, uploaderRole) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'hod') return true;
    if (user.id === uploaderId) return true;
    return false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, hasRole, canEdit }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
