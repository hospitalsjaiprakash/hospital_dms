import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
});

// Request interceptor - attach token
api.interceptors.request.use(
  (config) => {
    // Check sessionStorage first (tab-specific), then localStorage
    const token = sessionStorage.getItem('hms_token') || localStorage.getItem('hms_token');
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
      localStorage.removeItem('hms_token');
      localStorage.removeItem('hms_user');
      window.location.href = '/login';
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
  getStats: () => api.get('/patients/stats'),
  getUploadHistory: () => api.get('/patients/upload-history'),
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
