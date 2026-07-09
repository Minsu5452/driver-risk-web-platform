import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useAnalysisStore = create(
    persist(
        (set) => ({
            isUploaded: false,
            analysisResults: [],
            isDownloading: false,
            setDownloading: (v) => set({ isDownloading: v }),

            setAnalysisResults: (results) => set({
                isUploaded: true,
                analysisResults: results,
            }),

            appendAnalysisResults: (newResults) => set((state) => {
                // PrimaryKey 기반 — 같은 사람이면 새 데이터로 교체
                const newPKs = new Set(newResults.map(r => r.PrimaryKey));
                const kept = state.analysisResults.filter(r => !newPKs.has(r.PrimaryKey));
                return {
                    isUploaded: true,
                    analysisResults: [...kept, ...newResults],
                };
            }),

            resetAnalysis: () => set({
                isUploaded: false,
                analysisResults: [],
            })
        }),
        {
            name: 'risk-analysis-storage',
            storage: createJSONStorage(() => {
                // sessionStorage 용량 초과 시 graceful fallback
                return {
                    getItem: (name) => sessionStorage.getItem(name),
                    setItem: (name, value) => {
                        try {
                            sessionStorage.setItem(name, value);
                        } catch {
                            // QuotaExceededError — 데이터가 너무 큼, 메모리에만 유지
                            console.warn('sessionStorage 용량 초과 — 새로고침 시 데이터 초기화됩니다.');
                        }
                    },
                    removeItem: (name) => sessionStorage.removeItem(name),
                };
            }),
            partialize: (state) => ({
                isUploaded: state.isUploaded,
                analysisResults: state.analysisResults,
            }),
        }
    )
);

export default useAnalysisStore;
