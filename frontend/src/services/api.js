import axios from 'axios';

// Safe check for environment variables (supports both CRA and Vite)
const getEnv = (name) => {
  try {
    // Try Vite style
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
      return import.meta.env[name];
    }
  } catch (e) {}
  
  try {
    // Try CRA/Webpack style
    const craName = name.startsWith('VITE_') ? `REACT_APP_${name.slice(5)}` : name;
    if (typeof process !== 'undefined' && process.env && process.env[craName]) {
      return process.env[craName];
    }
    if (typeof process !== 'undefined' && process.env && process.env[name]) {
      return process.env[name];
    }
  } catch (e) {}
  
  return null;
};

const VITE_URL = getEnv('VITE_API_URL');
const BASE_URL = VITE_URL ? `${VITE_URL}/api` : 'https://hospital-dms-pyhq.onrender.com/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

// Request interceptor - attach token
api.interceptors.request.use(
  (config) => {
    // Check sessionStorage (tab-specific)
    const token = sessionStorage.getItem('hms_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle 401
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('hms_token');
      sessionStorage.removeItem('hms_user');
      window.location.href = '/login';
    }
    
    // Check for detailed validation errors
    if (error.response?.data?.details && Array.isArray(error.response.data.details)) {
      const details = error.response.data.details.map(d => d.message).join(', ');
      return Promise.reject(new Error(`${error.response.data.message}: ${details}`));
    }

    const message = error.response?.data?.message || 'An error occurred';
    return Promise.reject(new Error(message));
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  signup: (data) => api.post('/auth/signup', data),
  getMe: () => api.get('/auth/me'),
};

// ── Patients ──────────────────────────────────────────────────────────────────
export const patientApi = {
  getAll: (params) => api.get('/patients', { params }),
  getOne: (id) => api.get(`/patients/${id}`),
  create: (data) => api.post('/patients', data),
  update: (id, data) => api.patch(`/patients/${id}`, data),
  delete: (id) => api.delete(`/patients/${id}`),
  bulkUpdate: (data) => api.post('/patients/bulk', data),
  getStats: () => api.get('/patients/stats'),
  getUploadHistory: () => api.get('/patients/upload-history'),
  exportExcel: (params) => api.get('/patients/export', { params, responseType: 'blob' }),
};

// ── Documents ─────────────────────────────────────────────────────────────────
export const documentApi = {
  getAll: (params) => api.get('/documents', { params }),
  upload: (formData) => api.post('/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  }),
  getForPatient: (patientId, params) => api.get(`/patients/${patientId}/documents`, { params }),
  getOne: (id) => api.get(`/documents/${id}`),
  update: (id, data) => api.patch(`/documents/${id}`, data),
  delete: (id) => api.delete(`/documents/${id}`),
  bulkDelete: (ids) => api.post('/documents/bulk-delete', { ids }),
  exportZip: (patientId) => api.get(`/patients/${patientId}/documents/export`, { responseType: 'blob' }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const userApi = {
  getAll: (params) => api.get('/users', { params }),
  create: (data) => api.post('/users', data),
  toggleStatus: (id) => api.patch(`/users/${id}/status`),
};

// ── Audit ─────────────────────────────────────────────────────────────────────
export const auditApi = {
  getLogs: (params) => api.get('/audit-logs', { params }),
};

export default api;
