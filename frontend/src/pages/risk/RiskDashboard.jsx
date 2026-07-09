import { useEffect, useState } from 'react';
import useAnalysisStore from '@/store/useAnalysisStore';
import riskClient from '@/api/riskClient';

import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area
} from 'recharts';
import { User, AlertTriangle, ShieldAlert, Target, FileText } from 'lucide-react';
import { Title, Text, Stack, Group, Button, ThemeIcon } from '@mantine/core';

import { RISK_COLORS } from '@/constants/risk';
import '@/css/risk_dashboard.css';

const formatSmallPct = (value, total) => {
    if (total === 0 || value === 0) return '0%';
    const pct = (value / total) * 100;
    if (pct < 0.01) return '<0.01%';
    if (pct < 0.1) return pct.toFixed(2) + '%';
    return pct.toFixed(1) + '%';
};

// Age 코드 파싱 ("30a" → 30, "30b" → 35)
function parseAge(code) {
    if (!code) return null;
    const str = String(code);
    const match = str.match(/^(\d+)/);
    if (!match) return null;
    const base = parseInt(match[1], 10);
    return str.endsWith('b') ? base + 5 : base;
}

const RiskDashboard = () => {
    const { isUploaded, analysisResults, appendAnalysisResults } = useAnalysisStore();
    const [stats, setStats] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);


    const processFiles = async (files) => {
        if (!files || files.length === 0) return;

        setUploading(true);

        const formData = new FormData();
        Array.from(files).forEach(file => formData.append("files", file));

        try {
            const response = await riskClient.post("/analysis/predict/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });

            // 스토어 액션으로 중복 검사 및 데이터 병합
            appendAnalysisResults(response.data);
        } catch (error) {
            const detail = error.response?.data?.detail;
            if (detail) {
                alert(`업로드 실패: ${detail}`);
            } else {
                alert(`업로드 중 오류가 발생했습니다:\n${error.message || JSON.stringify(error)}`);
            }
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (event) => {
        processFiles(event.target.files);
        event.target.value = ''; // 같은 파일 재선택 허용
    };

    const handleDrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            processFiles(files);
        }
    };

    const handleDragOver = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer && event.dataTransfer.types && Array.from(event.dataTransfer.types).includes("Files")) {
            event.dataTransfer.dropEffect = 'copy';
            setIsDragOver(true);
        }
    };

    const handleDragLeave = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setIsDragOver(false);
    };

    // analysisResults 변경 시 통계 재계산
    useEffect(() => {
        if (isUploaded && analysisResults && analysisResults.length > 0) {
            const newStats = calculateStats(analysisResults);
            setStats(newStats);
        } else {
            setStats(null);
        }
    }, [isUploaded, analysisResults]);

    const calculateStats = (data) => {
        if (!data || data.length === 0) return null;

        // 사람(PrimaryKey) 단위로 최신 검사 1건만 집계한다 — 운전자 목록/다운로드와 동일 기준.
        // 한 사람이 검사를 여러 번 받아도 1명으로 세어 페이지 간 "N명"이 일치하도록 한다.
        const byPK = {};
        for (const r of data) {
            const pk = r.PrimaryKey;
            if (!pk) continue;
            if (!byPK[pk] || String(r.TestDate || '') > String(byPK[pk].TestDate || '')) byPK[pk] = r;
        }
        const persons = Object.values(byPK);

        let totalDrivers = persons.length;
        let highRiskCount = 0;
        let totalScore = 0;
        let riskGroupCounts = { '저위험': 0, '중위험': 0, '고위험': 0 };
        let ageRiskMap = {};   // "20대" -> { sum, count }
        let domainCountMap = { 'A': 0, 'B': 0 };
        let domainRiskMap = { 'A': { sum: 0, count: 0 }, 'B': { sum: 0, count: 0 } };

        // 사람 단위 집계 (운전자 수 / 위험등급 분포 / 평균 / 연령 / 검사유형)
        persons.forEach(item => {
            const score = Number(item.result) || 0;
            totalScore += score;

            const rg = item.riskGroup || '저위험';
            if (rg === '고위험') highRiskCount++;
            if (riskGroupCounts[rg] !== undefined) riskGroupCounts[rg]++;
            else riskGroupCounts['저위험']++;

            let age = parseAge(item.exam_age);
            if (age !== null) {
                let ageGroup = Math.floor(age / 10) * 10 + "대";
                if (!ageRiskMap[ageGroup]) ageRiskMap[ageGroup] = { sum: 0, count: 0 };
                ageRiskMap[ageGroup].sum += score;
                ageRiskMap[ageGroup].count++;
            }

            const domain = item.domain || 'Unknown';
            if (domainCountMap[domain] !== undefined) {
                domainCountMap[domain]++;
                domainRiskMap[domain].sum += score;
                domainRiskMap[domain].count++;
            }
        });

        // 추세(시계열)는 전체 검사 기준으로 둔다 — 과거 검사 흐름을 보존해야 월별 추세가 의미를 가진다.
        let riskTrendMap = {}; // "YYYY-MM" -> { sum, count }
        data.forEach(item => {
            const score = Number(item.result) || 0;
            if (!item.TestDate) return;
            let year, month;
            const s = String(item.TestDate).replace(/[^0-9]/g, '');
            if (s.length === 8) {
                year = parseInt(s.substring(0, 4));
                month = parseInt(s.substring(4, 6)) - 1; // 0부터 시작
            } else {
                const d = new Date(item.TestDate);
                if (!isNaN(d)) { year = d.getFullYear(); month = d.getMonth(); }
            }
            if (year !== undefined) {
                const key = `${year}-${String(month + 1).padStart(2, '0')}`;
                if (!riskTrendMap[key]) riskTrendMap[key] = { sum: 0, count: 0 };
                riskTrendMap[key].sum += score;
                riskTrendMap[key].count++;
            }
        });

        const averageRiskScore = totalScore / totalDrivers;

        const riskTrend = {};
        Object.keys(riskTrendMap).forEach(key => {
            const { sum, count } = riskTrendMap[key];
            riskTrend[key] = count > 0 ? sum / count : 0;
        });

        const riskByAge = {};
        Object.keys(ageRiskMap).forEach(key => {
            const { sum, count } = ageRiskMap[key];
            riskByAge[key] = count > 0 ? sum / count : 0;
        });

        const riskByDomain = {};
        Object.keys(domainRiskMap).forEach(key => {
             if (domainRiskMap[key].count > 0) {
                 riskByDomain[key] = domainRiskMap[key].sum / domainRiskMap[key].count;
             } else {
                 riskByDomain[key] = 0;
             }
        });

        return {
            totalDrivers,
            highRiskDrivers: highRiskCount,
            averageRiskScore,
            riskGroupCounts,
            riskTrend,
            riskByAge,
            countByDomain: domainCountMap,
            riskByDomain
        };
    };


    let content = null;

    if (uploading) {
        content = (
            <div className="risk-loading">
                <Stack align="center" gap="md">
                    <div className="spinner"></div>
                    <Text size="lg" fw={700}>업로드 및 분석 중...</Text>
                    <Text c="dimmed" size="sm">잠시만 기다려주세요.</Text>
                </Stack>
            </div>
        );
    } else if (!stats) {
        content = (
            <div
                className="risk-loading"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                style={{
                border: isDragOver ? '3px dashed #339af0' : '3px dashed transparent',
                backgroundColor: isDragOver ? 'rgba(51, 154, 240, 0.1)' : 'transparent',
                transition: 'all 0.2s ease',
            }}
            >
                <Stack align="center" style={{ pointerEvents: 'none' }}>
                    <ThemeIcon size={60} radius="md" variant={isDragOver ? "light" : "outline"} color="gray" mb="sm">
                        <FileText size={32} />
                    </ThemeIcon>
                    <Text size="lg" fw={500}>
                        {isDragOver ? '파일을 여기에 놓으세요' : '파일을 업로드하여 분석을 시작하세요'}
                    </Text>
                    <Text size="sm" c="dimmed">
                        또는 아래 버튼을 클릭하여 선택 (xlsx, xls, csv)
                    </Text>
                    <div style={{ pointerEvents: 'auto' }}>
                        <label htmlFor="empty-state-file-upload">
                            <Button component="span" variant="filled" color="blue" mt="md" size="md">
                                파일 업로드 (새 분석)
                            </Button>
                        </label>
                        <input
                             id="empty-state-file-upload"
                             type="file"
                             multiple
                             accept=".xlsx,.xls,.csv"
                             style={{ display: "none" }}
                             onChange={handleFileChange}
                          />
                    </div>
                </Stack>
            </div>
        );
    } else {
        const {
            totalDrivers, 
            highRiskDrivers: highRiskCount, 
            averageRiskScore: currentRiskScore, 
            riskGroupCounts, 
            riskTrend, 
            riskByAge, 
            countByDomain, 
            riskByDomain 
        } = stats;

        const trendData = Object.keys(riskTrend).map(date => ({
            date,
            riskScore: riskTrend[date]
        })).sort((a, b) => new Date(a.date) - new Date(b.date));

        const riskPieData = [
            { name: '저위험', value: riskGroupCounts['저위험'] || 0 },
            { name: '중위험', value: riskGroupCounts['중위험'] || 0 },
            { name: '고위험', value: riskGroupCounts['고위험'] || 0 }
        ];
        const riskPieDataFiltered = riskPieData.filter(d => d.value > 0);

        const ageRiskData = Object.keys(riskByAge).map(age => ({
            ageLabel: age,
            riskScore: riskByAge[age]
        })).sort((a, b) => parseInt(a.ageLabel, 10) - parseInt(b.ageLabel, 10));

        const domainData = Object.keys(countByDomain).map(d => ({
            domain: d === 'A' ? '신규 검사' : '자격유지 검사',
            count: countByDomain[d],
            riskScore: riskByDomain[d] || 0
        }));

        const highRiskPct = formatSmallPct(highRiskCount, totalDrivers);

        content = (
            <div className="container" style={{paddingTop: '2rem'}}>
                <div className="c_wrap">
    
                    <div className="layout">
                        <Group justify="space-between" align="flex-end" mb="lg">
                            <Stack gap="xs">
                                <Title order={2} c="dark.8">AI 기반 운수종사자 사고 위험도 예측 시스템</Title>
                                <Text c="dimmed">사고 위험도 종합 현황 및 통계</Text>
                            </Stack>
                        </Group>
    
                        <div className="risk-dashboard-grid-v2">
                            
                            {/* 핵심 지표 카드 */}
                            <div className="grid-col-4">
                                <div className="mantine-card">
                                    <div className="stat-header">
                                        <div className="stat-label">전체 운전자 수</div>
                                        <div className="stat-icon bg-blue-light text-blue">
                                            <User size={18} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                    <div className="stat-value">{totalDrivers.toLocaleString()}</div>
                                    <div className="stat-diff text-blue">
                                        <Target size={14} />
                                        <span>전체 분석 대상</span>
                                    </div>
                                </div>
                            </div>
    
                            <div className="grid-col-4">
                                <div className="mantine-card">
                                    <div className="stat-header">
                                        <div className="stat-label">평균 사고 위험도</div>
                                        <div className="stat-icon bg-orange-light text-orange">
                                            <ShieldAlert size={18} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                    <div className="stat-value">{(currentRiskScore * 100).toFixed(1)}%</div>
                                    <div className="stat-diff" style={{ color: '#868e96' }}>
                                        <Target size={14} />
                                        <span>현재 데이터 기준</span>
                                    </div>
                                </div>
                            </div>
    
                            <div className="grid-col-4">
                                <div className="mantine-card" style={{borderColor: highRiskCount > 0 ? '#ffc9c9' : ''}}>
                                    <div className="stat-header">
                                        <div className="stat-label">고위험군 운전자 수</div>
                                        <div className="stat-icon bg-red-light text-red">
                                            <AlertTriangle size={18} strokeWidth={2.5} />
                                        </div>
                                    </div>
                                    <div className="stat-value" style={{color: '#fa5252'}}>
                                        {highRiskCount.toLocaleString()}
                                    </div>
                                    <div className="stat-diff text-red">
                                        <span>{highRiskCount}명 ({highRiskPct}) 집중 관리 필요</span>
                                    </div>
                                </div>
                            </div>
    
                            {/* 메인 차트: 사고 위험도 추이 */}
                            <div className="grid-col-8">
                                <div className="mantine-card">
                                    <div className="chart-header-row">
                                        <h3 className="chart-title">월별 평균 사고 위험도 추이</h3>
                                        <span className="chart-badge">추이</span>
                                    </div>
                                    <div className="chart-container" style={{height: '320px'}}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={trendData}>
                                                <defs>
                                                    <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#fa5252" stopOpacity={0.2}/>
                                                        <stop offset="95%" stopColor="#fa5252" stopOpacity={0}/>
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
                                                <XAxis 
                                                    dataKey="date" 
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{fill: '#868e96', fontSize: 12}}
                                                    dy={10}
                                                />
    
                                                <YAxis 
                                                    domain={['auto', 'auto']}  // 상대적 스케일링
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{fill: '#868e96', fontSize: 12}}
                                                    tickFormatter={(value) => (value * 100).toFixed(1) + '%'}
                                                />
                                                <ReTooltip
                                                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}}
                                                    formatter={(value) => [(value * 100).toFixed(1) + '%', '평균 사고 위험도']}
                                                />
                                                <Area 
                                                    type="monotone" 
                                                    dataKey="riskScore" 
                                                    stroke="#fa5252" 
                                                    strokeWidth={3}
                                                    fillOpacity={1} 
                                                    fill="url(#colorRisk)" 
                                                    name="사고 위험도"
                                                    activeDot={{r: 6, strokeWidth: 0}}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
    
                            {/* 사이드 차트: 위험 등급 분포 */}
                            <div className="grid-col-4">
                                <div className="mantine-card">
                                    <div className="chart-header-row">
                                        <h3 className="chart-title">위험 등급 분포</h3>
                                        <span className="chart-badge">분포</span>
                                    </div>
                                    <div className="chart-container" style={{height: '260px'}}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={riskPieDataFiltered}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={80}
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                    stroke="none"
                                                    minAngle={15}
                                                >
                                                    {riskPieDataFiltered.map((entry) => (
                                                        <Cell key={entry.name} fill={RISK_COLORS[entry.name] || '#868e96'} />
                                                    ))}
                                                </Pie>
                                                <ReTooltip />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="custom-legend">
                                            {riskPieData.map((entry) => (
                                                <div key={entry.name} className="legend-item">
                                                    <div className="legend-dot" style={{backgroundColor: RISK_COLORS[entry.name]}}></div>
                                                    <span>{entry.name}: {entry.value.toLocaleString()}명 ({formatSmallPct(entry.value, totalDrivers)})</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
    
                            {/* 하단 행 */}
                            <div className="grid-col-6">
                                <div className="mantine-card">
                                    <div className="chart-header-row">
                                        <h3 className="chart-title">연령대별 평균 사고 위험도</h3>
                                        <span className="chart-badge">연령</span>
                                    </div>
                                    <div className="chart-container" style={{height: '250px'}}>
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={ageRiskData} layout="vertical" margin={{ left: 10, right: 60 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f3f5" />
                                                <XAxis type="number" domain={['auto', 'auto']} hide />
                                                <YAxis 
                                                    dataKey="ageLabel" 
                                                    type="category" 
                                                    width={60} 
                                                    axisLine={false} 
                                                    tickLine={false}
                                                    tick={{fill: '#495057', fontSize: 13, fontWeight: 500}}
                                                    interval={0}
                                                />
                                                <ReTooltip cursor={{fill: '#f8f9fa'}} formatter={(val)=>[(val * 100).toFixed(1) + '%', '평균 사고 위험도']}/>
                                                <Bar
                                                    dataKey="riskScore"
                                                    fill="#fa5252"
                                                    radius={[0, 4, 4, 0]}
                                                    barSize={15}
                                                    name="사고 위험도"
                                                    label={{ position: 'right', fill: '#868e96', fontSize: 11, formatter: (v) => (v * 100).toFixed(1) + '%' }}
                                                />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
    
                            {/* 검사 유형별 비교 */}
                            <div className="grid-col-6">
                                 <div className="mantine-card">
                                    <div className="chart-header-row">
                                        <h3 className="chart-title">검사 유형별 비교</h3>
                                        <span className="chart-badge">유형</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                        {domainData.map((d, i) => {
                                            const maxCount = Math.max(...domainData.map(x => x.count), 1);
                                            const barPct = (d.count / maxCount) * 100;
                                            const barColor = i === 0 ? '#339af0' : '#20c997';
                                            return (
                                                <div key={d.domain} style={{ padding: 16, borderRadius: 8, background: '#f8f9fa', border: '1px solid #e9ecef' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: barColor }} />
                                                            <span style={{ fontWeight: 700, fontSize: 15, color: '#343a40' }}>{d.domain}</span>
                                                        </div>
                                                        <span style={{ fontSize: 20, fontWeight: 700, color: '#343a40' }}>{d.count.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 500, color: '#868e96' }}>건</span></span>
                                                    </div>
                                                    <div style={{ height: 6, background: '#e9ecef', borderRadius: 3, marginBottom: 12 }}>
                                                        <div style={{ height: '100%', width: `${barPct}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                                        <span style={{ fontSize: 12, color: '#868e96', fontWeight: 500 }}>평균 사고 위험도</span>
                                                        <span style={{ fontSize: 18, fontWeight: 700, color: '#fa5252' }}>{(d.riskScore * 100).toFixed(1)}%</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
    
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            {content}
        </>
    );
};

export default RiskDashboard;
