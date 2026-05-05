import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      // Only read from sessionStorage (tab-specific), NOT localStorage
      // This ensures new tabs show login, not previous user's dashboard
      const stored = sessionStorage.getItem('hms_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check sessionStorage first (same tab session)
    let token = sessionStorage.getItem('hms_token');
    
    // If no sessionStorage token, check localStorage (browser restart scenario)
    if (!token) {
      token = localStorage.getItem('hms_token');
    }
    
    if (token) {
      authApi.getMe()
        .then((res) => {
          setUser(res.data);
          sessionStorage.setItem('hms_user', JSON.stringify(res.data));
          localStorage.setItem('hms_user', JSON.stringify(res.data));
        })
        .catch(() => { logout(); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (credentials) => {
    const res = await authApi.login(credentials);
    const { user, token } = res.data;
    // Store in sessionStorage (tab-specific) AND localStorage (persistent)
    sessionStorage.setItem('hms_token', token);
    sessionStorage.setItem('hms_user', JSON.stringify(user));
    localStorage.setItem('hms_token', token);
    localStorage.setItem('hms_user', JSON.stringify(user));
    setUser(user);
    return user;
  }, []);

  const signup = useCallback(async (data) => {
    const res = await authApi.signup(data);
    return res.data;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('hms_token');
    sessionStorage.removeItem('hms_user');
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
