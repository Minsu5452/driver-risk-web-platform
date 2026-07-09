import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useAdminStore = create(
    persist(
        (set) => ({
            isAdmin: false,
            token: null,
            login: (token) => set({ isAdmin: true, token }),
            logout: () => set({ isAdmin: false, token: null }),
        }),
        {
            name: 'risk-admin-storage',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
);

export default useAdminStore;
