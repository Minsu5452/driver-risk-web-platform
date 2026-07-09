import axios from 'axios';
import useAdminStore from '@/store/useAdminStore';

const adminClient = axios.create({
    baseURL: '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// 요청 시 토큰 자동 첨부
adminClient.interceptors.request.use((config) => {
    const token = useAdminStore.getState().token;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// 401 응답 시 자동 로그아웃
adminClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            useAdminStore.getState().logout();
        }
        return Promise.reject(error);
    }
);

export default adminClient;
