
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container, Title, Text, Button, SimpleGrid, Card, Group,
    ThemeIcon, Stack, Box, Paper, Tooltip, Grid
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import '@mantine/dropzone/styles.css';

import { 
    LayoutDashboard, Users, FileText, Upload, CheckCircle, 
    BarChart3, ShieldCheck, FileSpreadsheet, ArrowRight, X, 
    RefreshCw, Plus
} from 'lucide-react';

import URL from '@/constants/url';
import useAnalysisStore from '@/store/useAnalysisStore';
import riskClient from '@/api/riskClient';
import '@/css/main.css';

function EgovMain() {
    const navigate = useNavigate();
    const { isUploaded, setAnalysisResults, appendAnalysisResults, resetAnalysis } = useAnalysisStore();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const openRef = React.useRef(null);
    const appendRef = React.useRef(null);

    // 파일 업로드 (isAppend=false: 초기화 후 새 분석, isAppend=true: 기존 결과에 병합)
    const handleUpload = async (files, isAppend = false) => {
        if (!files || files.length === 0) return;
        if (!isAppend && isUploaded) resetAnalysis();

        setLoading(true);
        setError(null);

        const formData = new FormData();
        Array.from(files).forEach(file => formData.append('files', file));

        try {
            const response = await riskClient.post('/analysis/predict/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (isAppend) {
                appendAnalysisResults(response.data);
                alert(`${response.data.length}건의 데이터가 성공적으로 추가되었습니다.`);
            } else {
                setAnalysisResults(response.data);
            }
        } catch (err) {
            const errMsg = err.response?.data?.detail || err.message
                || (isAppend ? "추가 업로드에 실패했습니다." : "업로드에 실패했습니다.");
            setError(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
        } finally {
            setLoading(false);
        }
    };

    // 초기화
    const handleReset = () => {
        if (window.confirm('현재 분석 결과를 모두 초기화하고 처음으로 돌아가시겠습니까?')) {
            resetAnalysis();
            setError(null);
        }
    };

    return (

        <div style={{ paddingBottom: '40px', backgroundColor: '#f8f9fa', minHeight: 'calc(100vh - 200px)' }}>
            
            {/* 히어로 섹션 / 메인 드롭존 */}
            {!isUploaded ? (
                <Dropzone
                    openRef={openRef} 
                    onDrop={handleUpload}
                    activateOnClick={false}
                    maxSize={100 * 1024 ** 2}
                    accept={['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv']}
                    loading={loading}
                    styles={{
                        root: { border: 'none', padding: 0, backgroundColor: 'transparent', marginBottom: '-50px' }, 
                        inner: { pointerEvents: 'none' } 
                    }}
                    disabled={loading}
                >
                    <div style={{ pointerEvents: 'none' }}>
                        <HeroSection 
                            contentMode="drop" 
                            loading={loading}
                            onOpen={() => openRef.current?.()}
                            error={error} 
                        />
                    </div>
                </Dropzone>
            ) : (
                <div style={{ marginBottom: '-50px' }}>
                     <HeroSection contentMode="static" loading={false} onOpen={() => {}} />
                </div>
            )}

            {/* 메인 콘텐츠 컨테이너 — 히어로 섹션과 겹침 */}
            <Container size="lg" style={{ position: 'relative', zIndex: 10 }}>
                
                {/* 업로드 완료 후: 결과 카드 및 기능 메뉴 */}
                {isUploaded && (
                    <>
                        <Paper 
                            shadow="xl" 
                            radius="lg" 
                            p="xl" 
                            mb={40}
                            style={{ 
                                backgroundColor: 'white', 
                                borderLeft: '6px solid var(--mantine-color-green-6)',
                            }}
                        >
                            <Stack gap="lg">
                                {/* 헤더 */}
                                <Group justify="space-between" align="start">
                                    <Group align="center">
                                        <ThemeIcon size={50} radius="xl" color="green" variant="light">
                                            <CheckCircle size={28} strokeWidth={2.5} />
                                        </ThemeIcon>
                                        <div>
                                            <Title order={3} mb={2}>분석 완료</Title>
                                            <Text c="dimmed" size="sm">
                                                운전자 데이터 분석이 성공적으로 완료되었습니다.
                                            </Text>
                                        </div>
                                    </Group>
                                    
                                    <Tooltip label="처음으로 돌아가기">
                                        <Button 
                                            variant="subtle" 
                                            color="gray" 
                                            size="xs" 
                                            leftSection={<RefreshCw size={12}/>}
                                            onClick={handleReset}
                                        >
                                            초기화
                                        </Button>
                                    </Tooltip>
                                </Group>

                                {/* 오류 알림 (업로드 후) */}
                                {error && (
                                    <Paper 
                                        shadow="md" 
                                        radius="md" 
                                        p="md" 
                                        withBorder 
                                        style={{ borderColor: 'var(--mantine-color-red-5)', backgroundColor: '#fff5f5' }} 
                                        mb="md"
                                    >
                                        <Group align="flex-start" wrap="nowrap">
                                            <ThemeIcon color="red" variant="light" size="md" style={{ minWidth: '28px' }}>
                                                <X size={16} />
                                            </ThemeIcon>
                                            <div style={{ flex: 1 }}>
                                                <Text fw={700} c="red.9" size="sm">오류 발생</Text>
                                                <Text c="red.8" size="xs" style={{ whiteSpace: 'pre-wrap' }}>{String(error)}</Text>
                                            </div>
                                        </Group>
                                    </Paper>
                                )}

                                <Grid gutter="md">
                                    {/* 대시보드 바로가기 */}
                                    <Grid.Col span={{ base: 12, sm: 6 }}>
                                        <Paper
                                            shadow="sm"
                                            radius="lg"
                                            withBorder
                                            h={150}
                                            onClick={() => navigate(URL.RISK_DASHBOARD)}
                                            style={{ 
                                                cursor: 'pointer', 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                padding: '0 40px',
                                                transition: 'all 0.2s ease',
                                                borderColor: '#dee2e6'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                                                e.currentTarget.style.borderColor = '#339af0';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'none';
                                                e.currentTarget.style.boxShadow = 'var(--mantine-shadow-sm)';
                                                e.currentTarget.style.borderColor = '#dee2e6';
                                            }}
                                        >
                                            <Group style={{ width: '100%' }} justify="space-between">
                                                <Group>
                                                    <ThemeIcon size={60} radius="md" variant="light" color="blue">
                                                        <BarChart3 size={32} />
                                                    </ThemeIcon>
                                                    <Stack gap={2}>
                                                        <Text size="xl" fw={800} c="dark.8">대시보드 바로가기</Text>
                                                        <Text size="sm" c="dimmed" fw={500}>사고 위험도 분석 결과 확인</Text>
                                                    </Stack>
                                                </Group>
                                                <ThemeIcon size={40} radius="xl" variant="transparent" c="gray.4">
                                                    <ArrowRight size={24} />
                                                </ThemeIcon>
                                            </Group>
                                        </Paper>
                                    </Grid.Col>

                                    {/* 데이터 추가 드롭존 */}
                                    <Grid.Col span={{ base: 12, sm: 6 }}>
                                        <Dropzone
                                            openRef={appendRef}
                                            onDrop={(files) => handleUpload(files, true)}
                                            activateOnClick={false}
                                            maxSize={100 * 1024 ** 2}
                                            accept={['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv']}
                                            loading={loading}
                                            styles={{
                                                root: { 
                                                    height: '150px', 
                                                    display: 'flex', 
                                                    padding: 0, 
                                                    border: '2px dashed #4dabf7',
                                                    borderRadius: '12px',
                                                    cursor: 'pointer',
                                                    backgroundColor: '#ffffff',
                                                    justifyContent: 'center',
                                                    alignItems: 'center',
                                                    transition: 'all 0.2s ease'
                                                },
                                                inner: { margin: '0', width: '100%' }
                                            }}
                                            onClick={() => appendRef.current?.()}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                                                e.currentTarget.style.borderColor = '#339af0';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'none';
                                                e.currentTarget.style.boxShadow = 'none';
                                                e.currentTarget.style.borderColor = '#4dabf7';
                                            }}
                                        >
                                            <Group justify="center" gap="sm" style={{ pointerEvents: 'none' }}>
                                                <Dropzone.Idle>
                                                    <Group gap="xs" align="center">
                                                        <ThemeIcon variant="light" color="blue" size="lg" radius="xl">
                                                            <Plus size={20} />
                                                        </ThemeIcon>
                                                        <Stack gap={0}>
                                                            <Text size="xl" fw={800} c="blue.9">데이터 추가</Text>
                                                            <Text size="sm" c="dimmed">파일을 여기로 드래그하세요</Text>
                                                        </Stack>
                                                    </Group>
                                                </Dropzone.Idle>
                                                <Dropzone.Accept>
                                                    <Group gap="xs" align="center">
                                                        <ThemeIcon variant="filled" color="blue" size="lg" radius="xl">
                                                            <Upload size={20} />
                                                        </ThemeIcon>
                                                        <Text size="md" fw={700} c="blue.7">파일 놓기</Text>
                                                    </Group>
                                                </Dropzone.Accept>
                                                <Dropzone.Reject>
                                                    <Group gap="xs" align="center">
                                                        <ThemeIcon variant="filled" color="red" size="lg" radius="xl">
                                                            <X size={20} />
                                                        </ThemeIcon>
                                                        <Text size="md" fw={700} c="red.7">불가능</Text>
                                                    </Group>
                                                </Dropzone.Reject>
                                            </Group>
                                        </Dropzone>
                                    </Grid.Col>
                                </Grid>
                            </Stack>
                        </Paper>

                        {/* 바로가기 메뉴 그리드 */}
                        <Box>
                            <Title order={4} mb="md" pl="xs" c="dimmed">바로가기 메뉴</Title>
                            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
                                <FeatureCard 
                                    icon={<LayoutDashboard size={28} color="#228be6" />}
                                    title="대시보드"
                                    description="전체 사고 위험도 현황 및 통계"
                                    onClick={() => navigate(URL.RISK_DASHBOARD)}
                                />
                                <FeatureCard 
                                    icon={<Users size={28} color="#e64980" />}
                                    title="운전자 목록"
                                    description="운전자별 사고 위험도 조회 및 상세 진단"
                                    onClick={() => navigate(URL.RISK_LIST)}
                                />
                                <FeatureCard
                                    icon={<FileText size={28} color="#40c057" />}
                                    title="비교 분석"
                                    description="그룹별 사고 위험도 비교 및 AI 요인 분석"
                                    onClick={() => navigate(URL.RISK_ANALYSIS)}
                                />
                            </SimpleGrid>
                        </Box>
                    </>
                )}

                {/* 업로드 전: 안내 단계 */}
                {!isUploaded && (
                    <Paper shadow="xl" radius="lg" p={40} style={{ backgroundColor: 'white' }}>
                         <SimpleGrid cols={{ base: 1, sm: 3 }} spacing={40}>
                            <StepCard 
                                icon={<FileSpreadsheet size={32} />} 
                                title="1. 데이터 업로드"
                                desc="적성검사 결과 파일을 업로드합니다." 
                            />
                            <StepCard 
                                icon={<BarChart3 size={32} />} 
                                title="2. AI 자동 분석" 
                                desc="업로드 즉시 AI가 사고 위험도를 예측합니다." 
                            />
                            <StepCard 
                                icon={<ShieldCheck size={32} />} 
                                title="3. 결과 확인"
                                desc="대시보드에서 사고 위험도 현황과 고위험군을 확인합니다." 
                            />
                        </SimpleGrid>
                    </Paper>
                )}

            </Container>
        </div>
    );
}

// HeroSection을 외부로 분리하여 불필요한 리렌더링 방지
const HeroSection = ({ contentMode, loading, onOpen, error }) => (
    <Box 
        style={{ 
            background: 'linear-gradient(135deg, #1c7ed6 0%, #228be6 100%)', 
            padding: '60px 0 100px 0',
            color: 'white',
            position: 'relative',
            overflow: 'hidden',
            textAlign: 'center'
        }}
    >
        <Container size="lg" style={{ position: 'relative', zIndex: 1 }}>
            <Stack align="center" gap="lg">
                <Title order={1} size={42} fw={900} style={{ textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    AI 기반 운수종사자 사고 위험도 예측 시스템
                </Title>
                <Text size="lg" opacity={0.9} maw={600} lh={1.5}>
                    인공지능 기반 적성검사 데이터 분석을 통한 사고 위험도 예측
                </Text>

                {/* 오류 알림 (업로드 전) */}
                {error && contentMode === 'drop' && (
                    <Paper 
                        shadow="md" 
                        radius="md" 
                        p="md" 
                        withBorder 
                        style={{ 
                            borderColor: 'var(--mantine-color-red-5)', 
                            backgroundColor: '#fff5f5', 
                            maxWidth: 900, 
                            width: '100%',
                            textAlign: 'left'
                        }} 
                        mt="md"
                    >
                        <Group align="flex-start" wrap="nowrap">
                            <ThemeIcon color="red" variant="light" size="md" style={{ minWidth: '28px' }}>
                                <X size={16} />
                            </ThemeIcon>
                            <div style={{ flex: 1 }}>
                                <Text fw={700} c="red.9" size="sm">오류 발생</Text>
                                <Text c="red.8" size="xs" style={{ whiteSpace: 'pre-wrap' }}>{String(error)}</Text>
                            </div>
                        </Group>
                    </Paper>
                )}

                {/* 업로드 전 액션 버튼 */}
                {contentMode === 'drop' && (
                    <div style={{ 
                        marginTop: '20px',
                        border: '2px dashed rgba(255,255,255,0.4)',
                        borderRadius: '16px',
                        padding: '24px 40px',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer',
                        pointerEvents: 'auto' // 부모의 pointer-events: none을 오버라이드
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if(onOpen) onOpen();
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.8)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
                    }}
                    >
                        <Stack align="center" gap="sm">
                            <Upload size={32} color="white" />
                            <Text size="md" fw={700} c="white">
                                {loading ? '데이터 분석 중...' : '클릭하거나 파일을 드래그하여 업로드'}
                            </Text>
                        </Stack>
                    </div>
                )}
            </Stack>
        </Container>

        {/* 드래그 앤 드롭 힌트 오버레이 */}
        {contentMode === 'drop' && (
            <>
                <Dropzone.Accept>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10, backdropFilter: 'blur(4px)',
                        border: '4px dashed rgba(255,255,255,0.8)', margin: '10px', borderRadius: '12px'
                    }}>
                        <Stack align="center" style={{ pointerEvents: 'none' }}>
                            <Upload size={60} strokeWidth={2} color="white" />
                            <Title order={2} c="white">파일을 놓아서 업로드 시작</Title>
                        </Stack>
                    </div>
                </Dropzone.Accept>
                <Dropzone.Reject>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(250, 82, 82, 0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10, backdropFilter: 'blur(4px)',
                        border: '4px dashed rgba(255, 200, 200, 0.8)', margin: '10px', borderRadius: '12px'
                    }}>
                        <Stack align="center" style={{ pointerEvents: 'none' }}>
                            <X size={60} strokeWidth={2} color="white" />
                            <Title order={2} c="white">지원되지 않는 파일 형식</Title>
                        </Stack>
                    </div>
                </Dropzone.Reject>
            </>
        )}
    </Box>
);

function StepCard({ icon, title, desc }) {
    return (
        <Stack align="center" ta="center" gap="xs">
            <ThemeIcon size={60} radius="100%" variant="light" color="blue" mb={4}>
                {icon}
            </ThemeIcon>
            <Text size="md" fw={700}>{title}</Text>
            <Text c="dimmed" size="sm" lh={1.4}>{desc}</Text>
        </Stack>
    );
}

function FeatureCard({ icon, title, description, onClick }) {
    return (
        <Card
            shadow="sm"
            padding="xl"
            radius="md"
            py={30}
            withBorder
            className="feature-card"
            onClick={onClick}
            style={{
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'left'
            }}
        >
            <Group>
                <ThemeIcon size="lg" radius="md" variant="light" color="gray">
                    {icon}
                </ThemeIcon>
                <div>
                    <Text fw={700} size="md">{title}</Text>
                    <Text c="dimmed" size="xs">{description}</Text>
                </div>
            </Group>
        </Card>
    );
}

export default EgovMain;
