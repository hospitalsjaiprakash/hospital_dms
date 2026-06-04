const axios = require('axios');
const api = axios.create({ baseURL: 'http://localhost:5001/api' });

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // simulate skipping redirect
    }
    const message = error.response?.data?.message || 'An error occurred';
    return Promise.reject(new Error(message));
  }
);

api.post('/auth/login', { employee_id: 'wrong', password: 'wrong' })
  .then(res => console.log('SUCCESS:', res))
  .catch(err => console.log('ERROR CAUGHT:', err.message));
