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

const BASE_URL = '/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 300000, // 5 minutes for large file uploads/compression
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
      // Completely removed redirect here just in case it's causing a refresh loop
    }
    
    // Check for detailed validation errors (backend uses 'errors' key)
    if (error.response?.data?.errors && Array.isArray(error.response.data.errors)) {
      const details = error.response.data.errors.map(d => d.message).join(', ');
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
  getDashboardData: () => api.get('/dashboard-data'),
  getAll: (params) => api.get('/patients', { params }),
  getOne: (id) => api.get(`/patients/${id}`),
  create: (data) => api.post('/patients', data),
  update: (id, data) => api.post(`/patients/${id}`, data),
  delete: (id) => api.post(`/patients/${id}/delete`),
  bulkUpdate: (data) => api.post('/patients/bulk', data),
  getStats: () => api.get('/patients/stats'),
  getUploadHistory: () => api.get('/patients/upload-history'),
  exportExcel: (params) => api.get('/patients/export', { params, responseType: 'blob' }),
};

// ── Documents ─────────────────────────────────────────────────────────────────
export const documentApi = {
  getAll: (params) => api.get('/documents', { params }),
  upload: (formData, onProgress) => api.post('/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000,
    onUploadProgress: onProgress,
  }),
  getForPatient: (patientId, params) => api.get(`/patients/${patientId}/documents`, { params }),
  getOne: (id) => api.get(`/documents/${id}`),
  update: (id, data, onProgress) => {
    const isMultipart = data instanceof FormData;
    return api.post(`/documents/${id}`, data, {
      headers: isMultipart ? { 'Content-Type': 'multipart/form-data' } : {},
      timeout: 600000,
      onUploadProgress: onProgress,
    });
  },
  delete: (id) => api.post(`/documents/${id}/delete`),
  bulkDelete: (ids) => api.post('/documents/bulk-delete', { ids }),
  exportZip: (patientId) => api.get(`/patients/${patientId}/documents/export`, { responseType: 'blob' }),
  downloadRaw: (id) => api.get(`/documents/${id}/download-raw`, { responseType: 'blob' }),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const userApi = {
  getAll: (params) => api.get('/users', { params }),
  create: (data) => api.post('/users', data),
  toggleStatus: (id) => api.post(`/users/${id}/status`),
  delete: (id) => api.post(`/users/${id}/delete`),
  syncGSheet: () => api.post('/users/sync-gsheet'),
};

// ── Audit ─────────────────────────────────────────────────────────────────────
export const auditApi = {
  getLogs: (params) => api.get('/audit-logs', { params }),
};

export default api;
