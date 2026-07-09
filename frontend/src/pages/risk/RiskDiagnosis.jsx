import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { FEATURE_MAPPINGS, aggregateShapByCategory } from './featureMappings';
import URL from '@/constants/url';
import { RISK_THRESHOLDS, getRiskLevel } from '@/constants/risk';
import riskClient from '@/api/riskClient';
import {
    Container, Title, Text, Group, Stack, Badge, Paper, Grid, Table,
    RingProgress, Center, Skeleton, Button, Box, ActionIcon, Tooltip as MantineTooltip
} from '@mantine/core';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from 'recharts';
import { User, Calendar, MapPin, FileText, ArrowLeft, Eye, EyeOff, Download, ChevronRight } from "lucide-react";
import useAnalysisStore from '@/store/useAnalysisStore';
import useAdminStore from '@/store/useAdminStore';
// 단건 진단 PDF는 다운로드 페이지와 동일한 벡터 생성기를 동적 import로 사용



const RiskDiagnosis = () => {
    const { primaryKey } = useParams();
    const location = useLocation();
    const listSearch = location.state?.listSearch;
    const backTo = listSearch ? `${URL.RISK_LIST}?${listSearch}` : URL.RISK_LIST;
    const { analysisResults } = useAnalysisStore();
    const { isAdmin } = useAdminStore();
    const [showUnmasked, setShowUnmasked] = useState(false);
    const [driverData, setDriverData] = useState(null);
    const [driverHistory, setDriverHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisPerformed, setAnalysisPerformed] = useState(false);
    const [features, setFeatures] = useState([]);
    const [pdfExporting, setPdfExporting] = useState(false);
    const [selectedRecordKey, setSelectedRecordKey] = useState(null);

    // 날짜 포맷 변환 (YYYYMMDD 8자리 고정)
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const s = String(dateStr).replace(/[^0-9]/g, '');
        if (s.length >= 8) return `${s.substring(0,4)}년 ${s.substring(4,6)}월 ${s.substring(6,8)}일`;
        return dateStr;
    };

    // Store에서 즉시 프로필 + 업로드 이력 세팅 (동기)
    useEffect(() => {
        if (!primaryKey) {
            setDriverData(null);
            setDriverHistory([]);
            return;
        }

        const personRecords = analysisResults?.filter(d => d.PrimaryKey === primaryKey) || [];

        if (personRecords.length > 0) {
            const sorted = [...personRecords].sort((a, b) =>
                String(b.TestDate || '').localeCompare(String(a.TestDate || ''))
            );
            setDriverData(sorted[0]);
            setSelectedRecordKey(sorted[0].Test_id || `${sorted[0].domain || ''}_${sorted[0].TestDate || ''}`);

            const uploadHistory = personRecords.map((h, idx) => {
                const key = h.Test_id || `${h.domain || ''}_${h.TestDate || ''}_${idx}`;
                return {
                    testDate: formatDate(h.TestDate),
                    rawDate: h.TestDate,
                    score: h.result || 0,
                    riskGroup: getRiskLevel(h.result),
                    key,
                    domain: h.domain,
                    source: "upload",
                    Test_id: h.Test_id,
                };
            });
            setDriverHistory(uploadHistory);
        } else {
            setDriverData(null);
            setDriverHistory([]);
        }
    }, [primaryKey, analysisResults]);

    // DB 이력 백그라운드 로드 (비동기)
    useEffect(() => {
        if (!primaryKey || !analysisResults?.length) return;

        const personRecords = analysisResults.filter(d => d.PrimaryKey === primaryKey);
        if (personRecords.length === 0) return;

        const uploadedKeys = new Set(personRecords.map(h => h.Test_id).filter(Boolean));
        const uploadHistory = personRecords.map((h, idx) => {
            const key = h.Test_id || `${h.domain || ''}_${h.TestDate || ''}_${idx}`;
            return {
                testDate: formatDate(h.TestDate),
                rawDate: h.TestDate,
                score: h.result || 0,
                riskGroup: getRiskLevel(h.result),
                key,
                domain: h.domain,
                source: "upload",
                Test_id: h.Test_id,
            };
        });

        let cancelled = false;
        const fetchDbHistory = async () => {
            setHistoryLoading(true);
            try {
                const res = await riskClient.get(`/predict/history/${primaryKey}`);
                if (cancelled) return;
                if (res.data && Array.isArray(res.data)) {
                    const dbHistory = res.data
                        .filter(r => !uploadedKeys.has(r.Test_id))
                        .map(r => {
                            const key = r.Test_id || `${r.domain || ''}_${r.TestDate || ''}`;
                            // OOF 점수가 없으면 임의 점수(0.7/0.3) 대입 금지 — 허위 % 방지. 점수는 null, 등급은 사고 라벨로 정성 표기.
                            const score = r.score != null ? r.score : null;
                            return {
                                testDate: formatDate(r.TestDate),
                                rawDate: r.TestDate,
                                score,
                                riskGroup: score != null ? getRiskLevel(score) : (r.label === 1 ? '사고 이력' : r.label === 0 ? '무사고' : '-'),
                                key,
                                domain: r.domain,
                                source: "db",
                                features: r.features || null,
                                Test_id: r.Test_id,
                                Age: r.Age,
                                exam_age: r.exam_age || null,
                                current_age: r.current_age || null,
                            };
                        });

                    const combined = [...dbHistory, ...uploadHistory]
                        .sort((a, b) => String(a.rawDate).localeCompare(String(b.rawDate)));

                    if (combined.length > 0) {
                        setDriverHistory(combined);
                    }
                }
            } catch {
            } finally {
                if (!cancelled) setHistoryLoading(false);
            }
        };
        fetchDbHistory();
        return () => { cancelled = true; };
    }, [primaryKey, analysisResults]);

    // ── 검사 이력에서 다른 기록 선택 ──
    const switchToRecord = useCallback((historyItem) => {
        if (historyItem.source === 'upload' && analysisResults) {
            const match = (historyItem.Test_id && analysisResults.find(d =>
                d.PrimaryKey === primaryKey &&
                d.Test_id === historyItem.Test_id
            )) || analysisResults.find(d =>
                d.PrimaryKey === primaryKey &&
                d.domain === historyItem.domain &&
                String(d.TestDate) === String(historyItem.rawDate)
            );
            if (match) {
                setDriverData(match);
                setSelectedRecordKey(historyItem.key);
                setAnalysisPerformed(false);
                setFeatures([]);
            }
        } else if (historyItem.source === 'db') {
            setDriverData(prev => {
                // original_dob("1960-06-15")가 있으면 정밀 계산, 없으면 API 값 사용
                const dob = String(prev.original_dob || '');
                const birthYear = parseInt(dob.substring(0, 4));
                const birthMonth = parseInt(dob.substring(5, 7));
                const birthDay = parseInt(dob.substring(8, 10));
                const hasDob = birthYear > 0 && birthMonth > 0 && birthDay > 0;

                const raw = String(historyItem.rawDate || '').replace(/[^\d]/g, '');
                const testYear = parseInt(raw.substring(0, 4));
                const testMonth = parseInt(raw.substring(4, 6));
                const testDay = parseInt(raw.substring(6, 8)) || 15;

                let examAge = historyItem.exam_age || prev.exam_age;
                let currentAge = prev.current_age;

                if (hasDob) {
                    // 수검 당시 만나이: original_dob + 수검일
                    if (testYear) {
                        let age = testYear - birthYear;
                        if (testMonth * 100 + testDay < birthMonth * 100 + birthDay) age -= 1;
                        examAge = String(Math.max(0, age));
                    }
                    // 현재 만나이: original_dob + 오늘
                    const now = new Date();
                    let curAge = now.getFullYear() - birthYear;
                    if ((now.getMonth() + 1) * 100 + now.getDate() < birthMonth * 100 + birthDay) curAge -= 1;
                    currentAge = String(Math.max(0, curAge));
                }

                return {
                    ...prev,
                    domain: historyItem.domain,
                    TestDate: historyItem.rawDate,
                    result: historyItem.score,
                    riskGroup: historyItem.score != null ? getRiskLevel(historyItem.score) : historyItem.riskGroup,
                    features: historyItem.features || null,
                    Test_id: historyItem.Test_id || prev.Test_id,
                    Age: historyItem.Age || prev.Age,
                    exam_age: examAge,
                    current_age: currentAge,
                    _isDbRecord: !historyItem.features,
                };
            });
            setSelectedRecordKey(historyItem.key);
            setAnalysisPerformed(false);
            setFeatures([]);
        }
    }, [analysisResults, primaryKey]);

    const runAnalysis = async () => {
        if (!driverData) return;
        setAnalyzing(true);

        try {
            const payload = {
                Test_id: driverData.Test_id,
                TestDate: driverData.TestDate || "20230101",
                // Age는 "30a" 같은 코드 문자열 — Number()로 변환하면 NaN→0이 되어
                // 예측/비교분석과 다른 입력으로 SHAP이 계산되는 버그가 있었음. 문자열 그대로 전송.
                Age: String(driverData.Age ?? ""),
                PrimaryKey: driverData.PrimaryKey || "UNKNOWN",
                domain: driverData.domain || "A",
                features: driverData.features || {}
            };

            const response = await riskClient.post('/analysis/explain', payload);

            if (response.data && response.data.shap_values) {
                setFeatures(response.data.shap_values);
            } else {
                throw new Error("No SHAP values returned");
            }
            setAnalysisPerformed(true);

        } catch(e) {
            const errMsg = e.response?.data?.detail || e.message;
            alert(`AI 분석 중 오류가 발생했습니다: ${errMsg}`);
        } finally {
            setAnalyzing(false);
        }
    };

    // ── SHAP 카테고리 집계 ──
    const categoryData = useMemo(() => {
        if (!features || features.length === 0) return { increase: [], decrease: [] };
        const aggregated = aggregateShapByCategory(features);
        return {
            increase: aggregated.filter(d => d.value > 0).sort((a, b) => b.value - a.value),
            decrease: aggregated.filter(d => d.value < 0).sort((a, b) => a.value - b.value),
        };
    }, [features]);

    // ── 인사이트 자동 생성 ──
    const insightTexts = useMemo(() => {
        if (!analysisPerformed || !features || features.length === 0 || !driverData) return [];
        const result = [];
        const score = driverData.result || 0;
        const riskLevel = score >= RISK_THRESHOLDS.HIGH ? '고' : score >= RISK_THRESHOLDS.MEDIUM ? '중' : '저';

        result.push({
            type: riskLevel === '고' ? 'danger' : riskLevel === '중' ? 'warning' : 'success',
            badge: '사고 위험도 해석',
            text: `종합 사고 위험도 ${(score * 100).toFixed(1)}%로 ${riskLevel}위험군에 해당합니다.`,
        });

        if (categoryData.increase.length > 0) {
            const top = categoryData.increase[0];
            result.push({
                type: 'danger',
                badge: '주요 위험 요인',
                text: `${top.label} 결과가 사고 위험도를 가장 크게 높이고 있습니다. (사고 위험 영향도: +${(top.value * 100).toFixed(2)}%p)`,
            });
        }

        if (categoryData.decrease.length > 0) {
            const top = categoryData.decrease[0];
            result.push({
                type: 'info',
                badge: '주요 감소 요인',
                text: `${top.label} 결과가 사고 위험도를 낮추는 데 기여하고 있습니다. (사고 위험 영향도: ${(top.value * 100).toFixed(2)}%p)`,
            });
        }

        return result;
    }, [analysisPerformed, features, driverData, categoryData]);

    // ── 검사 항목 SHAP (PDF용) — A/B 검사 피처만, 메타 피처(drv,coh,age 등) 제외 ──
    const testFeatureShap = useMemo(() => {
        if (!features || features.length === 0) return [];
        return features
            .filter(({ feature }) => /^[AB]\d+/.test(feature) && FEATURE_MAPPINGS[feature])
            .map(({ feature, value }) => ({
                feature,
                label: FEATURE_MAPPINGS[feature],
                value,
            }))
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    }, [features]);

    // ── PDF 내보내기 (벡터 — 다운로드 페이지와 동일 생성기. html2canvas 미사용) ──
    const handlePdfExport = useCallback(async () => {
        if (!driverData || !features || features.length === 0) return;
        setPdfExporting(true);
        try {
            const [{ loadNanumFonts }, { saveDriverPdfVector }] = await Promise.all([
                import('@/utils/pdfFonts'),
                import('@/utils/pdfReportVector'),
            ]);
            const fonts = await loadNanumFonts();
            const name = (driverData?.masked_name || 'driver').replace(/\*/g, '○');
            const dobYear = String(driverData?.masked_dob || '').substring(0, 4);
            const date = driverData?.TestDate || 'unknown';
            saveDriverPdfVector(
                driverData, features, fonts,
                `진단보고서_${dobYear}년생_${name}_${date}.pdf`,
                driverHistory,
            );
        } catch (e) {
            alert('PDF 다운로드 중 오류가 발생했습니다.');
        } finally {
            setPdfExporting(false);
        }
    }, [driverData, features, driverHistory]);

    if (!driverData) return <Container>운전자 정보를 찾을 수 없습니다.</Container>;

    const getRiskColor = (group) => {
        if (group?.includes('고위험') || group?.includes('사고 이력')) return 'red';
        if (group?.includes('중위험')) return 'orange';
        if (group?.includes('저위험')) return 'green';
        return 'gray'; // 무사고 / 점수 없음 / '-'
    };

    const riskLabel = getRiskLevel;

    return (
        <>
            <Box style={{ backgroundColor: '#F8F9FA', minHeight: '100vh', padding: '2rem 0' }}>
            <Container size="xl">
                <Stack gap="lg">
                    {/* 페이지 헤더 — 뒤로가기 + PDF 다운로드 */}
                    <Group align="flex-start" gap="md" justify="space-between">
                        <Group>
                        <ActionIcon
                            component={Link}
                            to={backTo}
                            variant="subtle"
                            color="gray"
                            size="xl"
                            radius="xl"
                            aria-label="운전자 목록으로 돌아가기"
                        >
                            <ArrowLeft size={24} />
                        </ActionIcon>
                        <Stack gap={0}>
                             <Title order={2} c="dark.8">개별 정밀 진단</Title>
                             <Text c="dimmed">AI 분석을 통해 사고 위험 요인을 상세히 진단합니다.</Text>
                        </Stack>
                        </Group>
                        {analysisPerformed && (
                            <Button
                                leftSection={<Download size={16} />}
                                variant="light"
                                color="indigo"
                                loading={pdfExporting}
                                onClick={handlePdfExport}
                            >
                                PDF 다운로드
                            </Button>
                        )}
                    </Group>
                    {/* 프로필 카드 */}
                    {driverData && (
                        <Paper p="lg" radius="md" shadow="sm" withBorder>
                             <Grid gutter="xl" align="center">
                                <Grid.Col span={{ base: 12, md: 8 }}>
                                    <Stack gap="xs">
                                        <Group align="center">
                                            <Title order={2}>{showUnmasked && driverData.original_name ? driverData.original_name : (driverData.masked_name || '이름 없음')}</Title>
                                            <Badge size="lg" color={driverData.result >= RISK_THRESHOLDS.HIGH ? "red" : (driverData.result >= RISK_THRESHOLDS.MEDIUM ? "orange" : "teal")}>
                                                {getRiskLevel(driverData.result)} ({driverData.result != null ? (driverData.result * 100).toFixed(1) : 0}%)
                                            </Badge>
                                            {isAdmin && (
                                                <MantineTooltip label={showUnmasked ? "개인정보 마스킹" : "개인정보 마스킹 해제"} withArrow>
                                                    <ActionIcon variant="subtle" color="gray" size="lg" ml={-6} onClick={() => setShowUnmasked(v => !v)}>
                                                        {showUnmasked ? <EyeOff size={18} /> : <Eye size={18} />}
                                                    </ActionIcon>
                                                </MantineTooltip>
                                            )}
                                        </Group>

                                        <Grid mt="md">
                                            <Grid.Col span={{ base: 6, md: 3 }}>
                                                <Group gap="xs">
                                                    <Calendar size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">생년월일</Text>
                                                    <Text size="sm" fw={500}>
                                                        {showUnmasked && driverData.original_dob
                                                            ? (() => {
                                                                const parts = String(driverData.original_dob).split('-');
                                                                return parts.length === 3 ? `${parts[0]}년 ${parts[1]}월 ${parts[2]}일` : driverData.original_dob;
                                                            })()
                                                            : (driverData.masked_dob
                                                                ? `${String(driverData.masked_dob).substring(0,4)}년 **월 **일`
                                                                : '-')
                                                        }
                                                    </Text>
                                                </Group>
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 6, md: 3 }}>
                                                <Group gap="xs">
                                                    <User size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">성별</Text>
                                                    <Text size="sm" fw={500}>{driverData.gender || '-'}</Text>
                                                </Group>
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 6, md: 3 }}>
                                                <Group gap="xs">
                                                    <MapPin size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">지역본부</Text>
                                                    <Text size="sm" fw={500}>{driverData.branch || '-'}</Text>
                                                </Group>
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 6, md: 3 }}>
                                                <Group gap="xs">
                                                    <FileText size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">검사유형</Text>
                                                    <Text size="sm" fw={500}>{driverData.domain === 'A' ? '신규 검사' : '자격유지 검사'}</Text>
                                                </Group>
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 6, md: 3 }}>
                                                 <Group gap="xs">
                                                    <Calendar size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">검사일자</Text>
                                                    <Text size="sm" fw={500}>{formatDate(driverData.TestDate)}</Text>
                                                </Group>
                                            </Grid.Col>
                                             <Grid.Col span={{ base: 6, md: 3 }}>
                                                 <Stack gap={2}>
                                                    <Group gap="xs">
                                                        <User size={16} className="text-gray-500" />
                                                        <Text size="sm" c="dimmed">연령</Text>
                                                        <Text size="sm" fw={500}>{driverData.current_age ? driverData.current_age + '세' : '-'}</Text>
                                                    </Group>
                                                    <Text size="xs" c="dimmed" ml={24}>(수검 당시 연령 : {driverData.exam_age ? driverData.exam_age + '세' : '-'})</Text>
                                                </Stack>
                                            </Grid.Col>
                                            <Grid.Col span={{ base: 12, md: 6 }}>
                                                 <Group gap="xs">
                                                    <FileText size={16} className="text-gray-500" />
                                                    <Text size="sm" c="dimmed">업종</Text>
                                                    <Text size="sm" fw={500}>
                                                        {driverData.industry ? `${driverData.industry} (${driverData.industry_detail || '-'})` : '-'}
                                                    </Text>
                                                </Group>
                                            </Grid.Col>
                                        </Grid>
                                    </Stack>
                                </Grid.Col>
                                <Grid.Col span={{ base: 12, md: 4 }}>
                                    <Center>
                                        <Stack align="center" gap={0}>
                                            <RingProgress
                                                size={140}
                                                roundCaps
                                                thickness={14}
                                                sections={[{ value: driverData.result * 100, color: getRiskColor(driverData.riskGroup) }]}
                                                label={
                                                    <Text ta="center" fz="xl" fw={700}>
                                                        {driverData.result != null ? (driverData.result * 100).toFixed(1) + '%' : '-'}
                                                    </Text>
                                                }
                                            />
                                            <Text size="sm" c="dimmed" mt={5}>종합 사고 위험도</Text>
                                        </Stack>
                                    </Center>
                                </Grid.Col>
                            </Grid>
                        </Paper>
                    )}

                    <Grid>
                        {/* 검사 이력 섹션 */}
                        <Grid.Col span={{ base: 12, md: 6 }}>
                             <Paper p="md" radius="md" shadow="sm" withBorder h="100%">
                                <Title order={4} mb="md">검사 이력</Title>
                                <Text size="sm" c="dimmed" mb="md">
                                    {historyLoading
                                        ? '검사 이력을 불러오는 중...'
                                        : `누적 ${driverHistory.length}건의 검사 이력이 존재합니다.`
                                    }
                                </Text>

                                {historyLoading ? (
                                    <>
                                        <Skeleton height={200} mb={20} radius="sm" />
                                        <Stack gap="xs">
                                            <Skeleton height={32} radius="sm" />
                                            <Skeleton height={28} radius="sm" />
                                            <Skeleton height={28} radius="sm" />
                                            <Skeleton height={28} radius="sm" />
                                        </Stack>
                                    </>
                                ) : (
                                    <>
                                        {/* 추이 차트 */}
                                        <div style={{ height: 200, marginBottom: 20 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={driverHistory}>
                                                    <CartesianGrid strokeDasharray="3 3" />
                                                    <XAxis dataKey="testDate" tick={{fill: '#868e96', fontSize: 11}} />
                                                    <YAxis tick={{fill: '#868e96', fontSize: 11}} tickFormatter={(v) => (v * 100).toFixed(0) + '%'} />
                                                    <Tooltip formatter={(val) => [(val * 100).toFixed(1) + '%', '사고 위험도']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                                    <Line type="monotone" dataKey="score" stroke="#fa5252" strokeWidth={2} dot={{r: 4}} connectNulls name="사고 위험도" />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <Table striped highlightOnHover>
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th style={{ textAlign: 'center' }}>일자</Table.Th>
                                                    <Table.Th style={{ textAlign: 'center' }}>사고 위험도</Table.Th>
                                                    <Table.Th style={{ textAlign: 'center' }}>등급</Table.Th>
                                                    <Table.Th style={{ textAlign: 'center', width: 50 }}></Table.Th>
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {driverHistory.map((h, idx) => {
                                                    const isSelected = h.key === selectedRecordKey;
                                                    return (
                                                        <Table.Tr
                                                            key={h.Test_id || h.key || idx}
                                                            style={{
                                                                cursor: 'pointer',
                                                                background: isSelected ? '#e7f5ff' : undefined,
                                                            }}
                                                            onClick={() => switchToRecord(h)}
                                                        >
                                                            <Table.Td style={{ textAlign: 'center' }}>{h.testDate}</Table.Td>
                                                            <Table.Td style={{ textAlign: 'center' }}>{h.score != null ? (h.score * 100).toFixed(1) + '%' : '-'}</Table.Td>
                                                            <Table.Td style={{ textAlign: 'center' }}>
                                                                <Badge size="sm" color={getRiskColor(h.riskGroup)}>{h.riskGroup}</Badge>
                                                            </Table.Td>
                                                            <Table.Td style={{ textAlign: 'center', padding: '4px' }}>
                                                                <Group gap={2} justify="center" style={{ color: isSelected ? '#228be6' : '#adb5bd' }}>
                                                                    <Text size="xs" fw={isSelected ? 600 : 400}>상세</Text>
                                                                    <ChevronRight size={14} />
                                                                </Group>
                                                            </Table.Td>
                                                        </Table.Tr>
                                                    );
                                                })}
                                            </Table.Tbody>
                                        </Table>
                                    </>
                                )}
                             </Paper>
                        </Grid.Col>

                        {/* AI 분석 섹션 */}
                        <Grid.Col span={{ base: 12, md: 6 }}>
                            <Paper p="md" radius="md" shadow="sm" withBorder h="100%" pos="relative">
                                <Group justify="space-between" align="flex-start" mb="md">
                                    <Title order={4}>AI 사고 위험 요인 상세 진단</Title>
                                    {driverData && (
                                        <Badge variant="light" color="gray" size="sm">
                                            {driverData.domain === 'A' ? '신규' : '자격유지'} · {formatDate(driverData.TestDate)}
                                        </Badge>
                                    )}
                                </Group>
                                <Text size="sm" c="dimmed" mb="lg">
                                    개별 운전자의 사고 위험을 높이거나 낮추는 주요 요인을 분석합니다.
                                </Text>

                                {!analysisPerformed ? (
                                    <Center style={{ height: 400 }}>
                                        {driverData._isDbRecord ? (
                                            <Stack align="center">
                                                <Text c="dimmed" fw={500}>DB 이력 데이터</Text>
                                                <Text size="sm" c="dimmed" maw={320} ta="center">
                                                    DB에 저장된 이력은 사고 위험도와 등급만 확인 가능합니다.
                                                    AI 정밀 분석은 업로드된 검사 데이터에서만 실행할 수 있습니다.
                                                </Text>
                                            </Stack>
                                        ) : (
                                            <Stack align="center">
                                                <Text c="dimmed">AI 정밀 분석을 실행하여 위험 요인을 파악하세요.</Text>
                                                <Text size="xs" c="dimmed" mb="md">AI 모델 기반으로 분석합니다.</Text>
                                                <Button
                                                    onClick={runAnalysis}
                                                    loading={analyzing}
                                                    size="md"
                                                    color="blue"
                                                    variant="light"
                                                >
                                                    AI 정밀분석 실행
                                                </Button>
                                            </Stack>
                                        )}
                                    </Center>
                                ) : (
                                    <Grid>
                                        <Grid.Col span={12}>
                                             <Title order={5} c="red" mb="sm">위험 증가 요인</Title>
                                             {categoryData.increase.length > 0 ? (
                                                <div style={{ height: Math.max(categoryData.increase.length * 40, 120) }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart
                                                            layout="vertical"
                                                            data={categoryData.increase.map(f => ({
                                                                ...f,
                                                                name: f.label,
                                                            }))}
                                                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                                        >
                                                            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f3f5" />
                                                            <XAxis type="number" tick={{fill: '#868e96', fontSize: 11}} tickFormatter={(v) => `+${(v * 100).toFixed(1)}%p`} />
                                                            <YAxis type="category" dataKey="name" width={180} tick={{fill: '#495057', fontSize: 11}} />
                                                            <Tooltip formatter={(val) => `+${(val * 100).toFixed(2)}%p`} contentStyle={{borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                                                            <Bar dataKey="value" fill="#fa5252" radius={[0, 4, 4, 0]} barSize={14} name="영향도" />
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                             ) : (
                                                <Text c="dimmed" size="sm" ta="center" py="xl">특이 사항 없음</Text>
                                             )}
                                        </Grid.Col>

                                        <Grid.Col span={12}>
                                             <Title order={5} c="blue" mb="sm">위험 감소 요인</Title>
                                             {categoryData.decrease.length > 0 ? (
                                                <div style={{ height: Math.max(categoryData.decrease.length * 40, 120) }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart
                                                            layout="vertical"
                                                            data={categoryData.decrease.map(f => ({
                                                                ...f,
                                                                name: f.label,
                                                            }))}
                                                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                                        >
                                                            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f3f5" />
                                                            <XAxis type="number" tick={{fill: '#868e96', fontSize: 11}} tickFormatter={(v) => `${(v * 100).toFixed(1)}%p`} />
                                                            <YAxis type="category" dataKey="name" width={180} tick={{fill: '#495057', fontSize: 11}} />
                                                            <Tooltip formatter={(val) => `${(val * 100).toFixed(2)}%p`} contentStyle={{borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                                                            <Bar dataKey="value" fill="#228be6" radius={[0, 4, 4, 0]} barSize={14} name="영향도" />
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                             ) : (
                                                <Text c="dimmed" size="sm" ta="center" py="xl">특이 사항 없음</Text>
                                             )}
                                        </Grid.Col>
                                    </Grid>
                                )}
                            </Paper>
                        </Grid.Col>
                    </Grid>

                    {/* ── 주요 발견 사항 ── */}
                    {analysisPerformed && insightTexts.length > 0 && (
                        <Paper p="md" radius="md" shadow="sm" withBorder>
                            <Title order={4} mb="md">주요 발견 사항</Title>
                            <Stack gap="sm">
                                {insightTexts.map((insight, i) => (
                                    <Group key={i} gap="sm" align="flex-start" style={{
                                        padding: '10px 14px',
                                        borderRadius: 8,
                                        background: insight.type === 'danger' ? '#fff5f5' :
                                                    insight.type === 'warning' ? '#fff9db' :
                                                    insight.type === 'success' ? '#ebfbee' : '#e7f5ff',
                                    }}>
                                        <Badge
                                            size="sm"
                                            variant="light"
                                            color={
                                                insight.type === 'danger' ? 'red' :
                                                insight.type === 'warning' ? 'orange' :
                                                insight.type === 'success' ? 'green' : 'blue'
                                            }
                                            style={{ flexShrink: 0 }}
                                        >
                                            {insight.badge}
                                        </Badge>
                                        <Text size="sm" c="dark.6" style={{ lineHeight: 1.5 }}>{insight.text}</Text>
                                    </Group>
                                ))}
                            </Stack>
                        </Paper>
                    )}
                </Stack>
            </Container>
            </Box>

        </>
    );
};

export default RiskDiagnosis;
