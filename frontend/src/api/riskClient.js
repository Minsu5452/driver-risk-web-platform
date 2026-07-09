import axios from 'axios';

const riskClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api', // 프록시 설정은 vite.config.js 참조
  headers: {
    'Content-Type': 'application/json',
  },
});

export default riskClient;
