import { Button } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import useAnalysisStore from '@/store/useAnalysisStore';
import URL from '@/constants/url';

const AnalysisControls = () => {
    const navigate = useNavigate();
    const { resetAnalysis } = useAnalysisStore();

    const handleReset = () => {
        if (window.confirm("분석 결과를 모두 초기화하고 메인 화면으로 돌아가시겠습니까?")) {
            resetAnalysis();
            navigate(URL.MAIN);
        }
    };

    return (
        <Button
            variant="outline"
            color="dark"
            leftSection={<RotateCcw size={16} />}
            onClick={handleReset}
            size="sm"
            w={120}
        >
            초기화
        </Button>
    );
};

export default AnalysisControls;
