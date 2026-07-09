import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container, Paper, Title, Button, Stack, Text, Group,
    Table, Alert, Stepper, Tabs, Badge, Modal, Progress, Pagination, Loader,
} from '@mantine/core';
import { DatesProvider, MonthPickerInput } from '@mantine/dates';
import { Dropzone } from '@mantine/dropzone';
import '@mantine/dropzone/styles.css';
import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import { Upload, Play, LogOut, FileSpreadsheet, AlertCircle, Database, Layers, Trash2, RotateCcw, Search, AlertTriangle, Square, X, CheckCircle2, ArrowDown } from 'lucide-react';
import useAdminStore from '@/store/useAdminStore';
import adminClient from '@/api/adminClient';
import URL from '@/constants/url';
import '@/css/AdminDashboard.css';

const STEP_LABELS = ["데이터 로드", "라벨 생성", "파일 생성", "스태킹 모델 학습", "시퀀스 모델 학습", "모델 로드", "완료"];

const STEP_DESCRIPTIONS = {
    loading: '학습 데이터 로딩 진행중...',
    labeling: '라벨 생성 진행중...',
    generating_files: '학습 파일 생성 진행중...',
    training_stack: '스태킹 모델 학습 진행중...',
    training_seq: '시퀀스 모델 학습 진행중...',
    reloading_models: '모델 로딩 진행중...',
    completed: '학습이 완료되었습니다.',
    cancelled: '학습이 중단되었습니다.',
};

const STATUS_TO_STEP = {
    loading: 0,
    labeling: 1,
    generating_files: 2,
    training_stack: 3,
    training_seq: 4,
    reloading_models: 5,
    completed: 6,
    failed: -1,
    cancelled: -1,
};

const MODEL_INFO = {
    'hgb_stack_v0': { algo: 'HGB', variant: '기본모델', color: '#845ef7' },
    'hgb_stack_v1': { algo: 'HGB', variant: '튜닝모델', color: '#845ef7' },
    'xgb_stack_v0': { algo: 'XGB', variant: '기본모델', color: '#228be6' },
    'xgb_stack_v1': { algo: 'XGB', variant: '튜닝모델', color: '#228be6' },
    'cat_stack_v0': { algo: 'CAT', variant: '기본모델', color: '#f76707' },
    'cat_stack_v1': { algo: 'CAT', variant: '튜닝모델', color: '#f76707' },
    'xgb_alt':    { algo: 'XGB', variant: '대안 튜닝', color: '#228be6' },
    'seq_ensemble': { algo: 'ENS', variant: '시퀀스 모델', color: '#20c997' },
};


const TYPE_LABELS = {
    a_exam: '신규검사 데이터',
    b_exam: '자격유지검사 데이터',
    a_sago: '신규검사 사고 데이터',
    b_sago: '자격유지검사 사고 데이터',
};

const FILE_TYPE_LABELS = {
    'exam_A': '신규검사',
    'exam_B': '유지검사',
    'sago_A': '신규사고',
    'sago_B': '유지사고',
};

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        // DB는 UTC로 저장 — 'Z' 붙여서 UTC 명시 후 로컬(KST) 변환
        const utcStr = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
        const d = new Date(utcStr);
        return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
        return dateStr;
    }
}

function formatDateRange(dateFrom, dateTo) {
    if (!dateFrom && !dateTo) return '-';
    const from = dateFrom ? `${dateFrom.slice(0, 4)}-${dateFrom.slice(4)}` : '?';
    const to = dateTo ? `${dateTo.slice(0, 4)}-${dateTo.slice(4)}` : '?';
    return `${from} ~ ${to}`;
}

function AdminDashboard() {
    const navigate = useNavigate();
    const { logout } = useAdminStore();
    const [activeTab, setActiveTab] = useState('training');

    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [serverProcessing, setServerProcessing] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [uploadValidation, setUploadValidation] = useState(null);

    const [training, setTraining] = useState(false);
    const [trainingStatus, setTrainingStatus] = useState(null);
    const [trainingError, setTrainingError] = useState('');
    const [metrics, setMetrics] = useState(null);
    const [cancelling, setCancelling] = useState(false);

    const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
    const [history, setHistory] = useState([]);
    const [versions, setVersions] = useState([]);
    const [diskUsage, setDiskUsage] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ open: false, action: null, data: null });
    const [actionLoading, setActionLoading] = useState(false);

    const [datasets, setDatasets] = useState([]);
    const [bulkDateFrom, setBulkDateFrom] = useState(null);
    const [bulkDateTo, setBulkDateTo] = useState(null);
    const [bulkPreview, setBulkPreview] = useState(null);
    const [bulkLoading, setBulkLoading] = useState(false);

    const [historyPage, setHistoryPage] = useState(1);
    const [datasetsPage, setDatasetsPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    const [metricsSort, setMetricsSort] = useState({ key: 'score', dir: 'asc' });
    const [dataSummary, setDataSummary] = useState({ a_exam: 0, b_exam: 0, sago: 0 });

    const fetchDataSummary = useCallback(async () => {
        try {
            const res = await adminClient.get('/admin/datasets/summary');
            setDataSummary(res.data);
        } catch { /* non-critical */ }
    }, []);

    const activeDatasetsSummary = useMemo(() => ({
        count: datasets.length,
        aExam: dataSummary.a_exam,
        bExam: dataSummary.b_exam,
        sago: dataSummary.sago,
    }), [datasets.length, dataSummary]);

    const handleLogout = () => {
        logout();
        navigate(URL.ADMIN_LOGIN);
    };

    const handleDrop = (droppedFiles) => {
        setFiles(prev => {
            const existingNames = new Set(prev.map(f => f.name));
            const newFiles = droppedFiles.filter(f => !existingNames.has(f.name));
            return [...prev, ...newFiles];
        });
        setUploadError('');
        setUploadValidation(null);
    };

    const handleRemoveFile = (idx) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const handleUpload = async () => {
        if (files.length === 0) return;
        setUploading(true);
        setUploadProgress(0);
        setServerProcessing(false);
        setUploadError('');

        try {
            const formData = new FormData();
            files.forEach((file) => {
                formData.append('files', file);
            });

            const res = await adminClient.post('/admin/training/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (progressEvent) => {
                    const pct = progressEvent.total
                        ? Math.round((progressEvent.loaded / progressEvent.total) * 100)
                        : 0;
                    setUploadProgress(pct);
                    if (pct >= 100) {
                        setServerProcessing(true);
                    }
                },
            });
            const counts = res.data.record_counts || {};
            const hasPartialErrors = Object.values(counts).some(v => v && v.error);
            setUploadValidation({
                files: res.data.validation || res.data.files || [],
                record_counts: counts,
            });
            if (hasPartialErrors) {
                setUploadError('일부 파일 변환에 실패했습니다. 아래 세부 내용을 확인하세요.');
            }
            setFiles([]);
            fetchDatasets();
            fetchDataSummary();
        } catch (err) {
            const message = err.response?.data?.detail || '업로드에 실패했습니다.';
            setUploadError(message);
        } finally {
            setUploading(false);
            setUploadProgress(0);
            setServerProcessing(false);
        }
    };

    const handleStartTraining = () => {
        setConfirmModal({
            open: true,
            action: 'start_training',
            data: activeDatasetsSummary,
        });
    };

    const doStartTraining = async () => {
        if (training) return;
        setConfirmModal({ open: false, action: null, data: null });
        setTraining(true);
        setTrainingError('');
        setMetrics(null);
        setTrainingStatus({ status: 'starting', step_detail: '학습을 시작합니다...' });

        try {
            await adminClient.post('/admin/training/start');
        } catch (err) {
            const message = err.response?.data?.detail || '학습 시작에 실패했습니다.';
            setTrainingError(message);
            setTraining(false);
            setTrainingStatus(null);
        }
    };

    const handleCancelTraining = async () => {
        setCancelling(true);
        try {
            await adminClient.post('/admin/training/cancel');
        } catch (err) {
            // 400 = 이미 학습이 끝난 상태 → 에러가 아니라 자연스러운 종료
            if (err.response?.status === 400) {
                setTraining(false);
                setCancelling(false);
                setTrainingStatus(null);
                fetchHistory();
                return;
            }
            setTrainingError(err.response?.data?.detail || '학습 중단에 실패했습니다.');
            setCancelling(false);
        }
    };

    const fetchHistory = useCallback(async () => {
        try {
            const res = await adminClient.get('/admin/training/history');
            setHistory(res.data.runs || []);
        } catch { /* non-critical */ }
    }, []);

    const fetchVersions = useCallback(async () => {
        try {
            const res = await adminClient.get('/admin/models/versions');
            setVersions(res.data.versions || []);
        } catch { /* non-critical */ }
    }, []);

    const fetchDiskUsage = useCallback(async () => {
        try {
            const res = await adminClient.get('/admin/models/disk-usage');
            setDiskUsage(res.data);
        } catch { /* non-critical */ }
    }, []);

    const fetchDatasets = useCallback(async () => {
        try {
            const res = await adminClient.get('/admin/datasets');
            setDatasets(res.data.datasets || []);
        } catch { /* non-critical */ }
    }, []);

    useEffect(() => {
        if (!training) return;

        const interval = setInterval(async () => {
            try {
                const res = await adminClient.get('/admin/training/status');
                setTrainingStatus(res.data);

                if (res.data.status === 'completed') {
                    setTraining(false);
                    setCancelling(false);
                    try {
                        const metricsRes = await adminClient.get('/admin/training/metrics');
                        setMetrics(metricsRes.data);
                    } catch { /* non-critical */ }
                    fetchHistory();
                    fetchVersions();
                    fetchDiskUsage();
                    fetchDataSummary();
                } else if (res.data.status === 'failed') {
                    setTraining(false);
                    setCancelling(false);
                    setTrainingError(res.data.error_message || '학습 중 오류가 발생했습니다.');
                } else if (res.data.status === 'cancelled') {
                    setTraining(false);
                    setCancelling(false);
                    fetchHistory();
                }
            } catch { /* polling error, continue */ }
        }, 5000);

        return () => clearInterval(interval);
    }, [training, fetchHistory, fetchVersions, fetchDiskUsage, fetchDataSummary]);

    useEffect(() => {
        fetchHistory();
        fetchVersions();
        fetchDiskUsage();
        fetchDatasets();
        fetchDataSummary();

        // 페이지 진입 시 진행 중인 학습이 있는지 확인
        (async () => {
            try {
                const res = await adminClient.get('/admin/training/status');
                if (res.data && res.data.status === 'running') {
                    setTraining(true);
                    setTrainingStatus(res.data);
                }
            } catch { /* 첫 학습 전에는 404 가능 */ }
        })();
    }, [fetchHistory, fetchVersions, fetchDiskUsage, fetchDatasets, fetchDataSummary]);

    const showMessage = (type, text) => {
        setActionMessage({ type, text });
        setTimeout(() => setActionMessage({ type: '', text: '' }), 5000);
    };

    const handleActivateVersion = async (versionId) => {
        setActionLoading(true);
        try {
            await adminClient.post(`/admin/models/versions/${versionId}/activate`);
            fetchVersions();
            fetchDiskUsage();
            closeModal();
            showMessage('success', '모델 버전이 활성화되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '활성화에 실패했습니다.');
            closeModal();
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteVersion = async (versionId) => {
        setActionLoading(true);
        try {
            await adminClient.delete(`/admin/models/versions/${versionId}`);
            fetchVersions();
            fetchDiskUsage();
            closeModal();
            showMessage('success', '모델 버전이 삭제되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '삭제에 실패했습니다.');
            closeModal();
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteDataset = async (uploadId) => {
        setActionLoading(true);
        try {
            await adminClient.delete(`/admin/datasets/${uploadId}`);
            fetchDatasets();
            fetchDataSummary();
            closeModal();
            showMessage('success', '데이터셋이 삭제되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '삭제에 실패했습니다.');
            closeModal();
        } finally {
            setActionLoading(false);
        }
    };

    const formatMonth = (date) => date ? dayjs(date).format('YYYY-MM') : '';

    const handleBulkPreview = async () => {
        if (!bulkDateFrom || !bulkDateTo) return;
        setBulkLoading(true);
        setBulkPreview(null);
        try {
            const res = await adminClient.post('/admin/datasets/bulk-delete/preview', {
                date_from: formatMonth(bulkDateFrom),
                date_to: formatMonth(bulkDateTo),
            });
            setBulkPreview(res.data);
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '미리보기에 실패했습니다.');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        setBulkLoading(true);
        try {
            await adminClient.post('/admin/datasets/bulk-delete', {
                date_from: formatMonth(bulkDateFrom),
                date_to: formatMonth(bulkDateTo),
            });
            setBulkPreview(null);
            setBulkDateFrom(null);
            setBulkDateTo(null);
            fetchDatasets();
            fetchDataSummary();
            closeModal();
            showMessage('success', '일괄 삭제가 완료되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '삭제에 실패했습니다.');
        } finally {
            setBulkLoading(false);
        }
    };

    const handleResetAll = async () => {
        setActionLoading(true);
        try {
            await adminClient.post('/admin/datasets/reset', { confirm: true });
            fetchDatasets();
            fetchDataSummary();
            setUploadValidation(null);
            setUploadError('');
            closeModal();
            showMessage('success', '데이터가 초기화되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '초기화에 실패했습니다.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleResetHistory = async () => {
        setActionLoading(true);
        try {
            await adminClient.post('/admin/training/reset', { confirm: true });
            fetchHistory();
            closeModal();
            showMessage('success', '학습 이력이 초기화되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '이력 초기화에 실패했습니다.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleResetVersions = async () => {
        setActionLoading(true);
        try {
            await adminClient.post('/admin/models/versions/reset', { confirm: true });
            fetchVersions();
            fetchDiskUsage();
            closeModal();
            showMessage('success', '모델 버전이 초기화되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '모델 초기화에 실패했습니다.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSystemReset = async () => {
        setActionLoading(true);
        try {
            await adminClient.post('/admin/system/reset-all', { confirm: true });
            fetchHistory();
            fetchVersions();
            fetchDiskUsage();
            fetchDatasets();
            fetchDataSummary();
            setTrainingStatus(null);
            setMetrics(null);
            setUploadValidation(null);
            setUploadError('');
            closeModal();
            showMessage('success', '전체 초기화가 완료되었습니다.');
        } catch (err) {
            showMessage('error', err.response?.data?.detail || '전체 초기화에 실패했습니다.');
        } finally {
            setActionLoading(false);
        }
    };

    const currentStep = trainingStatus ? (STATUS_TO_STEP[trainingStatus.step_detail] ?? STATUS_TO_STEP[trainingStatus.status] ?? -1) : -1;

    const getMetricValue = (v, path) => {
        try {
            const m = v.metrics;
            if (!m) return '-';
            const parts = path.split('.');
            let val = m;
            for (const p of parts) {
                val = val[p];
                if (val === undefined || val === null) return '-';
            }
            return typeof val === 'number' ? val.toFixed(4) : String(val);
        } catch {
            return '-';
        }
    };

    const closeModal = () => setConfirmModal(prev => ({ ...prev, open: false }));

    const getR1CombinedScore = (m) => {
        const a = m?.stack_A?.final_ensemble?.score;
        const b = m?.stack_B?.final_ensemble?.score;
        if (a != null && b != null) return ((a + b) / 2).toFixed(4);
        if (a != null) return a.toFixed(4);
        if (b != null) return b.toFixed(4);
        return '-';
    };

    const getR7Score = (m) => {
        const s = m?.seq?.score;
        if (s != null) return s.toFixed(4);
        return '-';
    };

    const renderMetricVal = (v) => (v != null ? v.toFixed(4) : '-');

    const SORT_COLS = [
        { key: 'score', label: 'Score', hint: '↓ 낮을수록 좋음', lowerBetter: true },
        { key: 'auc', label: 'AUC', hint: '↑ 높을수록 좋음', lowerBetter: false },
        { key: 'brier', label: 'Brier', hint: '↓ 낮을수록 좋음', lowerBetter: true },
        { key: 'ece', label: 'ECE', hint: '↓ 낮을수록 좋음', lowerBetter: true },
        { key: 'mcc', label: 'MCC', hint: '↑ 높을수록 좋음', lowerBetter: false },
    ];

    const handleSortClick = (key) => {
        setMetricsSort(prev =>
            prev.key === key
                ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' }
        );
    };

    const sortIndicator = (key) => {
        if (metricsSort.key !== key) return null;
        const col = SORT_COLS.find(c => c.key === key);
        const isBest = col && ((col.lowerBetter && metricsSort.dir === 'asc') || (!col.lowerBetter && metricsSort.dir === 'desc'));
        return <span style={{ color: isBest ? '#228be6' : '#e03131', fontSize: 10 }}>{metricsSort.dir === 'asc' ? ' ▲' : ' ▼'}</span>;
    };

    const buildModelRows = (models, domain) => {
        if (!models || Object.keys(models).length === 0) return [];
        const rows = [];
        for (const [name, data] of Object.entries(models)) {
            if (data.calibrated) rows.push({ name, domain, ...data.calibrated });
        }
        return rows;
    };

    const sortRows = (rows) => {
        const { key, dir } = metricsSort;
        return [...rows].sort((a, b) => {
            const av = a[key] ?? Infinity;
            const bv = b[key] ?? Infinity;
            return dir === 'asc' ? av - bv : bv - av;
        });
    };

    const renderModelName = (name) => {
        const info = MODEL_INFO[name];
        if (!info) return <span>{name}</span>;
        return (
            <Group gap={6} wrap="nowrap">
                <Badge size="xs" variant="filled" color={info.color} style={{ minWidth: 36, textAlign: 'center' }}>{info.algo}</Badge>
                <Text size="sm" c="dimmed">{info.variant}</Text>
            </Group>
        );
    };

    const renderModelTable = (rows, showDomain) => {
        if (!rows || rows.length === 0) return null;
        const sorted = sortRows(rows);
        const sortKey = metricsSort.key;
        const sortDir = metricsSort.dir;
        const sortCol = SORT_COLS.find(c => c.key === sortKey);
        // 정렬 방향이 지표의 "좋은 방향"과 일치하면 1등=파란색, 아니면 1등=빨간색
        const isBestFirst = sortCol && (
            (sortCol.lowerBetter && sortDir === 'asc') ||
            (!sortCol.lowerBetter && sortDir === 'desc')
        );
        const topColor = isBestFirst ? '#228be6' : '#e03131';
        return (
            <Table striped highlightOnHover size="sm" className="metrics-detail-section">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>모델</Table.Th>
                        {showDomain && <Table.Th>검사</Table.Th>}
                        {SORT_COLS.map(c => (
                            <Table.Th
                                key={c.key}
                                onClick={() => handleSortClick(c.key)}
                                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                            >
                                <div>{c.label}{sortIndicator(c.key)}</div>
                                <div className="metric-col-hint">{c.hint}</div>
                            </Table.Th>
                        ))}
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {sorted.map((r, i) => (
                        <Table.Tr key={i}>
                            <Table.Td>{renderModelName(r.name)}</Table.Td>
                            {showDomain && (
                                <Table.Td>
                                    <Badge size="xs" variant="filled" color={r.domain === 'A' ? 'indigo' : 'red'}>{r.domain === 'A' ? '신규' : '유지'}</Badge>
                                </Table.Td>
                            )}
                            {SORT_COLS.map(c => (
                                <Table.Td
                                    key={c.key}
                                    fw={c.key === 'score' ? 600 : undefined}
                                    style={i === 0 && sortKey === c.key ? { color: topColor, fontWeight: 600 } : undefined}
                                >
                                    {renderMetricVal(r[c.key])}
                                </Table.Td>
                            ))}
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        );
    };

    const MODAL_TITLES = {
        activate: '모델 버전 활성화',
        delete_version: '모델 버전 삭제',
        delete_dataset: '데이터셋 삭제',
        start_training: '학습 시작 확인',
        cancel_training: '학습 중단 확인',
        bulk_delete: '일괄 삭제 확인',
        reset_datasets: '데이터 전체 삭제',
        reset_history: '학습 이력 초기화',
        reset_versions: '모델 버전 초기화',
        system_reset: '전체 초기화',
        view_metrics: '성능 요약',
    };
    const modalTitle = MODAL_TITLES[confirmModal.action] || '';

    return (
        <div className="admin-dashboard">
            <Container size="lg">
                {actionMessage.text && (
                    <Alert
                        color={actionMessage.type === 'success' ? 'green' : 'red'}
                        variant="light"
                        mb="md"
                        withCloseButton
                        onClose={() => setActionMessage({ type: '', text: '' })}
                        icon={actionMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    >
                        {actionMessage.text}
                    </Alert>
                )}
                <Group justify="space-between" mb="lg">
                    <Title order={2}>관리자 대시보드</Title>
                    <Group gap="sm">
                        <Button
                            variant="outline"
                            color="red"
                            leftSection={<AlertTriangle size={16} />}
                            onClick={() => setConfirmModal({
                                open: true,
                                action: 'system_reset',
                                data: {
                                    datasets: datasets.length,
                                    history: history.length,
                                    versions: versions.length,
                                },
                            })}
                            disabled={training}
                        >
                            전체 초기화
                        </Button>
                        <Button variant="outline" color="gray" leftSection={<LogOut size={16} />} onClick={handleLogout}>
                            로그아웃
                        </Button>
                    </Group>
                </Group>

                <Tabs value={activeTab} onChange={setActiveTab}>
                    <Tabs.List mb="lg">
                        <Tabs.Tab value="training" leftSection={<Play size={16} />} style={{ fontSize: 15, padding: '10px 20px' }}>모델 학습</Tabs.Tab>
                        <Tabs.Tab value="versions" leftSection={<Layers size={16} />} style={{ fontSize: 15, padding: '10px 20px' }}>모델 버전</Tabs.Tab>
                        <Tabs.Tab value="datasets" leftSection={<Database size={16} />} style={{ fontSize: 15, padding: '10px 20px' }}>데이터 관리</Tabs.Tab>
                    </Tabs.List>

                    {/* 탭 1: 모델 학습 */}
                    <Tabs.Panel value="training">
                        <Stack gap="lg">
                            <Paper shadow="sm" p="xl" radius="md" className="admin-section">
                                <Title order={3} mb="md">학습 데이터 업로드</Title>

                                <Dropzone
                                    onDrop={handleDrop}
                                    accept={{
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                                        'application/vnd.ms-excel': ['.xls'],
                                    }}
                                    loading={uploading}
                                >
                                    <Group justify="center" gap="xl" style={{ minHeight: 100, pointerEvents: 'none' }}>
                                        <Upload size={36} color="#868e96" />
                                        <div>
                                            <Text size="md" inline fw={500}>
                                                Excel 파일을 드래그하거나 클릭하여 선택하세요
                                            </Text>
                                            <Text size="sm" c="dimmed" mt={6}>
                                                아래 4종의 파일을 한 번에 또는 나누어 업로드할 수 있습니다
                                            </Text>
                                        </div>
                                    </Group>
                                </Dropzone>

                                <div className="upload-file-types-guide">
                                    <div className="file-type-chip"><Badge size="sm" variant="light" color="indigo" circle>A</Badge><Text size="xs">신규검사</Text></div>
                                    <div className="file-type-chip"><Badge size="sm" variant="light" color="red" circle>B</Badge><Text size="xs">자격유지검사</Text></div>
                                    <div className="file-type-chip"><Badge size="sm" variant="light" color="indigo" circle>A</Badge><Text size="xs">신규 사고</Text></div>
                                    <div className="file-type-chip"><Badge size="sm" variant="light" color="red" circle>B</Badge><Text size="xs">자격유지 사고</Text></div>
                                </div>

                                {files.length > 0 && (
                                    <div className="file-list">
                                        {files.map((file, idx) => (
                                            <div className="file-item" key={idx}>
                                                <FileSpreadsheet size={16} color="#495057" />
                                                <Text size="sm" style={{ flex: 1 }}>{file.name}</Text>
                                                <Text size="xs" c="dimmed">
                                                    {file.size >= 1024 * 1024
                                                        ? (file.size / (1024 * 1024)).toFixed(1) + ' MB'
                                                        : (file.size / 1024).toFixed(1) + ' KB'}
                                                </Text>
                                                <X
                                                    size={14}
                                                    color="#adb5bd"
                                                    style={{ cursor: 'pointer', flexShrink: 0 }}
                                                    onClick={() => handleRemoveFile(idx)}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {uploading && (
                                    <div style={{ marginTop: 16 }}>
                                        <Group justify="space-between" mb={4}>
                                            <Text size="sm" fw={500}>
                                                {serverProcessing ? '서버에서 파일 검증 중...' : '업로드 중...'}
                                            </Text>
                                            <Text size="sm" c="dimmed">{uploadProgress}%</Text>
                                        </Group>
                                        <Progress
                                            value={uploadProgress}
                                            size="lg"
                                            radius="md"
                                            animated={serverProcessing}
                                            striped={serverProcessing}
                                        />
                                    </div>
                                )}

                                {uploadError && (
                                    <Alert color="red" mt="md" icon={<AlertCircle size={16} />}>
                                        {uploadError.split('\n').map((line, i) => (
                                            <Text key={i} size="sm" style={line.startsWith('  ') ? { paddingLeft: 8, color: 'var(--mantine-color-dimmed)' } : { fontWeight: 500 }}>
                                                {line}
                                            </Text>
                                        ))}
                                    </Alert>
                                )}

                                {uploadValidation && uploadValidation.files?.length > 0 && (
                                    <Alert color="green" mt="md" title={`${uploadValidation.files.length}개 파일 업로드 완료`} icon={<CheckCircle2 size={16} />}>
                                        <div className="upload-result-list">
                                            {uploadValidation.files.map((v, i) => {
                                                const rc = uploadValidation.record_counts?.[v.type];
                                                const hasError = rc && rc.error;
                                                return (
                                                    <div key={i} className={`upload-result-row ${hasError ? 'error' : ''}`}>
                                                        <Badge size="sm" variant="filled"
                                                            color={v.type?.startsWith('a') ? 'indigo' : 'red'}
                                                        >
                                                            {v.type?.startsWith('a') ? 'A' : 'B'}
                                                        </Badge>
                                                        <Text size="sm" fw={500}>
                                                            {TYPE_LABELS[v.type] || v.type}
                                                        </Text>
                                                        {hasError ? (
                                                            <Badge size="sm" variant="light" color="red">변환 실패</Badge>
                                                        ) : rc && (
                                                            <Text size="sm" c="dimmed">
                                                                {rc.total.toLocaleString()}건 (신규 {rc.new.toLocaleString()}{rc.existing > 0 ? `, 기존 ${rc.existing.toLocaleString()}` : ''}{rc.duplicates_in_file > 0 ? `, 파일 내 중복 ${rc.duplicates_in_file.toLocaleString()}` : ''}{rc.skipped_empty_pk > 0 ? `, 주민번호 누락 ${rc.skipped_empty_pk}건 제외` : ''})
                                                            </Text>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {!training && (activeDatasetsSummary.aExam > 0 || activeDatasetsSummary.bExam > 0) && (
                                            <Button
                                                variant="light" color="green" size="xs" mt="sm"
                                                leftSection={<ArrowDown size={14} />}
                                                onClick={() => document.getElementById('training-section')?.scrollIntoView({ behavior: 'smooth' })}
                                            >
                                                아래에서 학습 시작
                                            </Button>
                                        )}
                                    </Alert>
                                )}

                                <Button
                                    mt="md"
                                    leftSection={<Upload size={16} />}
                                    onClick={handleUpload}
                                    loading={uploading}
                                    disabled={files.length === 0}
                                >
                                    업로드
                                </Button>
                            </Paper>

                            <Paper shadow="sm" p="xl" radius="md" className="admin-section" id="training-section">
                                <Group justify="space-between" mb="md">
                                    <Title order={3}>모델 학습</Title>
                                    {training && (
                                        <Button
                                            size="xs"
                                            variant="light"
                                            color="red"
                                            leftSection={<Square size={12} fill="currentColor" strokeWidth={0} />}
                                            loading={cancelling}
                                            onClick={() => setConfirmModal({
                                                open: true,
                                                action: 'cancel_training',
                                                data: null,
                                            })}
                                        >
                                            학습 중단
                                        </Button>
                                    )}
                                </Group>

                                {(activeDatasetsSummary.aExam > 0 || activeDatasetsSummary.bExam > 0 || activeDatasetsSummary.sago > 0) && (
                                    <Alert color="blue" variant="light" mb="md">
                                        <Text size="sm" fw={500} mb={4}>학습 데이터 현황</Text>
                                        <Group gap="lg">
                                            {activeDatasetsSummary.aExam > 0 && (
                                                <Text size="sm">신규검사: <strong>{activeDatasetsSummary.aExam.toLocaleString()}</strong>건</Text>
                                            )}
                                            {activeDatasetsSummary.bExam > 0 && (
                                                <Text size="sm">자격유지검사: <strong>{activeDatasetsSummary.bExam.toLocaleString()}</strong>건</Text>
                                            )}
                                            {activeDatasetsSummary.sago > 0 && (
                                                <Text size="sm">사고 데이터: <strong>{activeDatasetsSummary.sago.toLocaleString()}</strong>건</Text>
                                            )}
                                        </Group>
                                    </Alert>
                                )}

                                {!training && (
                                    <Button
                                        leftSection={<Play size={16} />}
                                        onClick={handleStartTraining}
                                        disabled={activeDatasetsSummary.aExam === 0 && activeDatasetsSummary.bExam === 0}
                                    >
                                        학습 시작
                                    </Button>
                                )}

                                {activeDatasetsSummary.aExam === 0 && activeDatasetsSummary.bExam === 0 && !training && (
                                    <Text size="sm" c="dimmed" mt="xs">
                                        검사 데이터가 없습니다. 데이터를 먼저 업로드해주세요.
                                    </Text>
                                )}

                                {trainingStatus && (
                                    <div style={{ marginTop: 24 }}>
                                        <Stepper active={currentStep} size="sm">
                                            {STEP_LABELS.map((label, idx) => (
                                                <Stepper.Step key={idx} label={label} />
                                            ))}
                                        </Stepper>
                                        {training && trainingStatus.step_detail && trainingStatus.status !== 'completed' && (
                                            <Group gap="xs" mt="md" justify="center">
                                                <Loader size={16} color="blue" />
                                                <Text size="sm" c="blue" fw={500}>
                                                    {STEP_DESCRIPTIONS[trainingStatus.step_detail] || trainingStatus.step_detail}
                                                </Text>
                                            </Group>
                                        )}
                                    </div>
                                )}

                                {trainingError && (
                                    <Alert color="red" mt="md" icon={<AlertCircle size={16} />}>
                                        {trainingError}
                                    </Alert>
                                )}

                                {trainingStatus?.status === 'cancelled' && (
                                    <Alert color="yellow" mt="md" title="학습 중단" icon={<Square size={16} fill="currentColor" strokeWidth={0} />}>
                                        <Text size="sm">학습이 중단되었습니다.</Text>
                                    </Alert>
                                )}

                                {trainingStatus?.status === 'completed' && (
                                    <Alert color="green" mt="md" title="학습 완료" icon={<CheckCircle2 size={16} />}>
                                        <Group justify="space-between" align="center">
                                            <Text size="sm">모델 학습이 성공적으로 완료되었습니다.</Text>
                                            <Button
                                                variant="white"
                                                color="green"
                                                size="sm"
                                                leftSection={<Search size={14} />}
                                                onClick={() => setConfirmModal({ open: true, action: 'view_metrics', data: { metrics: metrics?.metrics } })}
                                            >
                                                성능 확인
                                            </Button>
                                        </Group>
                                    </Alert>
                                )}
                            </Paper>

                            <Paper shadow="sm" p="xl" radius="md" className="admin-section">
                                <Group justify="space-between" mb="md">
                                    <Group gap="sm">
                                        <Title order={3}>학습 이력</Title>
                                        {history.length > 0 && (
                                            <Text size="sm" c="dimmed">총 {history.length}건</Text>
                                        )}
                                    </Group>
                                    {history.length > 0 && (
                                        <Button
                                            size="xs"
                                            variant="light"
                                            color="red"
                                            leftSection={<Trash2 size={12} />}
                                            disabled={training}
                                            onClick={() => setConfirmModal({
                                                open: true,
                                                action: 'reset_history',
                                                data: { count: history.length },
                                            })}
                                        >
                                            이력 초기화
                                        </Button>
                                    )}
                                </Group>

                                <Table striped highlightOnHover>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>번호</Table.Th>
                                            <Table.Th>시작일시</Table.Th>
                                            <Table.Th>소요시간</Table.Th>
                                            <Table.Th>상태</Table.Th>
                                            <Table.Th>모델 버전</Table.Th>
                                            <Table.Th>성능</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {history.length === 0 ? (
                                            <Table.Tr>
                                                <Table.Td colSpan={6}>
                                                    <Text ta="center" c="dimmed" py="md">학습 이력이 없습니다. 데이터를 업로드하고 학습을 시작해주세요.</Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        ) : (
                                            history
                                                .slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE)
                                                .map((run) => {
                                                const ver = versions.find(v => v.run_id === run.id);
                                                return (
                                                    <Table.Tr key={run.id}>
                                                        <Table.Td>{run.id}</Table.Td>
                                                        <Table.Td>{formatDate(run.started_at)}</Table.Td>
                                                        <Table.Td>
                                                            {run.started_at && run.completed_at ? (() => {
                                                                const sec = Math.round((new Date(run.completed_at + 'Z') - new Date(run.started_at + 'Z')) / 1000);
                                                                return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
                                                            })() : run.status === 'running' ? '진행중' : '-'}
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Badge color={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : run.status === 'cancelled' ? 'yellow' : 'blue'} variant="light"
                                                                style={run.status === 'failed' && run.error_message ? { cursor: 'pointer' } : undefined}
                                                                title={run.status === 'failed' && run.error_message ? run.error_message : undefined}
                                                            >
                                                                {run.status === 'completed' ? '완료' : run.status === 'failed' ? '실패' : run.status === 'cancelled' ? '중단' : run.status === 'pending' ? '대기' : '진행중'}
                                                            </Badge>
                                                            {run.status === 'failed' && run.error_message && (
                                                                <Text size="xs" c="red" mt={2} lineClamp={1}>{run.error_message}</Text>
                                                            )}
                                                        </Table.Td>
                                                        <Table.Td>{ver ? ver.version_label : '-'}</Table.Td>
                                                        <Table.Td>
                                                            {run.metrics_json ? (() => {
                                                                try {
                                                                    const m = JSON.parse(run.metrics_json);
                                                                    const r1 = getR1CombinedScore(m);
                                                                    const r7 = getR7Score(m);
                                                                    if (r1 === '-' && r7 === '-') return '-';
                                                                    return (
                                                                        <Group gap={6} wrap="nowrap">
                                                                            {r1 !== '-' && <Badge size="sm" variant="light" color="blue">스태킹 {r1}</Badge>}
                                                                            {r7 !== '-' && <Badge size="sm" variant="light" color="violet">시퀀스 {r7}</Badge>}
                                                                        </Group>
                                                                    );
                                                                } catch { return '-'; }
                                                            })() : '-'}
                                                        </Table.Td>
                                                    </Table.Tr>
                                                );
                                            })
                                        )}
                                    </Table.Tbody>
                                </Table>
                                {history.length > ITEMS_PER_PAGE && (
                                    <Group justify="center" mt="md">
                                        <Pagination
                                            total={Math.ceil(history.length / ITEMS_PER_PAGE)}
                                            value={historyPage}
                                            onChange={setHistoryPage}
                                            size="sm"
                                        />
                                    </Group>
                                )}
                            </Paper>
                        </Stack>
                    </Tabs.Panel>

                    {/* 탭 2: 모델 버전 */}
                    <Tabs.Panel value="versions">
                        <Paper shadow="sm" p="xl" radius="md" className="admin-section">
                            <Group justify="space-between" mb="md">
                                <Title order={3}>모델 버전 관리</Title>
                                {versions.length > 0 && (
                                    <Button
                                        size="xs"
                                        variant="light"
                                        color="red"
                                        leftSection={<Trash2 size={12} />}
                                        disabled={training}
                                        onClick={() => setConfirmModal({
                                            open: true,
                                            action: 'reset_versions',
                                            data: { count: versions.length },
                                        })}
                                    >
                                        모델 초기화
                                    </Button>
                                )}
                            </Group>

                            <Table striped highlightOnHover className="version-table">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>버전</Table.Th>
                                        <Table.Th>학습일시</Table.Th>
                                        <Table.Th>스태킹 모델 Score</Table.Th>
                                        <Table.Th>시퀀스 모델 Score</Table.Th>
                                        <Table.Th>용량</Table.Th>
                                        <Table.Th>상태</Table.Th>
                                        <Table.Th>관리</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {versions.length === 0 ? (
                                        <Table.Tr>
                                            <Table.Td colSpan={7}>
                                                <Text ta="center" c="dimmed" py="md">등록된 모델 버전이 없습니다. 학습을 완료하면 자동으로 등록됩니다.</Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ) : (
                                        versions.map((v) => (
                                            <Table.Tr key={v.id}
                                                style={{ cursor: 'pointer', backgroundColor: v.is_active ? 'var(--mantine-color-green-0)' : undefined }}
                                                onClick={() => setConfirmModal({ open: true, action: 'view_metrics', data: { metrics: v.metrics, version_label: v.version_label, created_at: v.created_at } })}
                                            >
                                                <Table.Td fw={600}>{v.version_label}</Table.Td>
                                                <Table.Td>{formatDate(v.created_at)}</Table.Td>
                                                <Table.Td fw={600}>{getR1CombinedScore(v.metrics)}</Table.Td>
                                                <Table.Td>{getMetricValue(v, 'seq.score')}</Table.Td>
                                                <Table.Td>{formatBytes(v.size_bytes)}</Table.Td>
                                                <Table.Td>
                                                    <span className={`version-active-badge ${v.is_active ? 'active' : 'inactive'}`}>
                                                        {v.is_active ? '활성' : '비활성'}
                                                    </span>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Group gap="xs" onClick={(e) => e.stopPropagation()}>
                                                        {!v.is_active && (
                                                            <Button
                                                                size="xs"
                                                                variant="light"
                                                                color="blue"
                                                                leftSection={<RotateCcw size={12} />}
                                                                onClick={() => setConfirmModal({
                                                                    open: true,
                                                                    action: 'activate',
                                                                    data: v,
                                                                })}
                                                            >
                                                                활성화
                                                            </Button>
                                                        )}
                                                        {!v.is_active && (
                                                            <Button
                                                                size="xs"
                                                                variant="light"
                                                                color="red"
                                                                leftSection={<Trash2 size={12} />}
                                                                disabled={training}
                                                                onClick={() => setConfirmModal({
                                                                    open: true,
                                                                    action: 'delete_version',
                                                                    data: v,
                                                                })}
                                                            >
                                                                삭제
                                                            </Button>
                                                        )}
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))
                                    )}
                                </Table.Tbody>
                            </Table>

                            {diskUsage && (
                                <div className="disk-usage-bar">
                                    <div className="disk-label">
                                        <span>전체 디스크 사용량</span>
                                        <span className="disk-value">{formatBytes(diskUsage.total)}</span>
                                    </div>
                                    {diskUsage.total > 0 ? (
                                        <>
                                            <Progress.Root size="lg">
                                                {diskUsage.original > 0 && (
                                                    <Progress.Section value={diskUsage.original / diskUsage.total * 100} color="blue">
                                                        <Progress.Label>기타</Progress.Label>
                                                    </Progress.Section>
                                                )}
                                                <Progress.Section value={diskUsage.versions ? (diskUsage.versions / diskUsage.total * 100) : 0} color="cyan">
                                                    <Progress.Label>버전 합계</Progress.Label>
                                                </Progress.Section>
                                            </Progress.Root>
                                            <Group gap="lg" mt="xs">
                                                {diskUsage.original > 0 && (
                                                    <Text size="xs" c="dimmed">기타 파일: {formatBytes(diskUsage.original)}</Text>
                                                )}
                                                <Text size="xs" c="dimmed">버전 합계: {formatBytes(diskUsage.versions || 0)}</Text>
                                            </Group>
                                        </>
                                    ) : (
                                        <Text size="sm" c="dimmed" mt="xs">저장된 모델이 없습니다.</Text>
                                    )}
                                </div>
                            )}
                        </Paper>
                    </Tabs.Panel>

                    {/* 탭 3: 데이터 관리 */}
                    <Tabs.Panel value="datasets">
                        <Paper shadow="sm" p="xl" radius="md" className="admin-section">
                            <Group justify="space-between" mb="md">
                                <Title order={3}>학습 데이터 관리</Title>
                                {datasets.length > 0 && (
                                    <Badge color="blue" variant="light" size="lg">{datasets.length}건</Badge>
                                )}
                            </Group>

                            <Alert color="blue" variant="light" mb="md" icon={<Database size={16} />}>
                                <Text size="sm" fw={500} mb={4}>전체 학습 데이터 현황</Text>
                                <Group gap="lg">
                                    <Text size="sm">신규검사: <strong>{dataSummary.a_exam.toLocaleString()}</strong>건</Text>
                                    <Text size="sm">자격유지검사: <strong>{dataSummary.b_exam.toLocaleString()}</strong>건</Text>
                                    <Text size="sm">사고 데이터: <strong>{dataSummary.sago.toLocaleString()}</strong>건</Text>
                                </Group>
                            </Alert>

                            {/* 일괄 삭제 도구 (업로드 일자 기준) */}
                            <DatesProvider settings={{ locale: 'ko' }}>
                                <div className="bulk-toolbar">
                                    <div className="bulk-toolbar-row">
                                        <Group gap="sm" align="flex-end">
                                            <MonthPickerInput
                                                label="시작월 선택"
                                                placeholder="선택"
                                                value={bulkDateFrom}
                                                onChange={(v) => { setBulkDateFrom(v); setBulkPreview(null); }}
                                                valueFormat="YYYY년 MM월"
                                                size="sm"
                                                w={160}
                                                clearable
                                                maxDate={bulkDateTo || undefined}
                                                numberOfColumns={1}
                                            />
                                            <Text c="dimmed" size="lg" style={{ lineHeight: '36px', paddingTop: 22 }}>~</Text>
                                            <MonthPickerInput
                                                label="종료월 선택"
                                                placeholder="선택"
                                                value={bulkDateTo}
                                                onChange={(v) => { setBulkDateTo(v); setBulkPreview(null); }}
                                                valueFormat="YYYY년 MM월"
                                                size="sm"
                                                w={160}
                                                clearable
                                                minDate={bulkDateFrom || undefined}
                                                numberOfColumns={1}
                                            />
                                            <Button
                                                size="sm"
                                                variant="light"
                                                leftSection={<Search size={14} />}
                                                loading={bulkLoading}
                                                disabled={!bulkDateFrom || !bulkDateTo}
                                                onClick={handleBulkPreview}
                                                style={{ marginTop: 22 }}
                                            >
                                                조회
                                            </Button>
                                            {bulkPreview && bulkPreview.count > 0 && (
                                                <Button
                                                    size="sm"
                                                    color="red"
                                                    leftSection={<Trash2 size={14} />}
                                                    disabled={training}
                                                    onClick={() => setConfirmModal({
                                                        open: true,
                                                        action: 'bulk_delete',
                                                        data: bulkPreview,
                                                    })}
                                                    style={{ marginTop: 22 }}
                                                >
                                                    {bulkPreview.count}건 삭제
                                                </Button>
                                            )}
                                        </Group>
                                        <Button
                                            size="sm"
                                            color="red"
                                            variant="outline"
                                            leftSection={<Trash2 size={14} />}
                                            disabled={datasets.length === 0 || training}
                                            onClick={() => setConfirmModal({
                                                open: true,
                                                action: 'reset_datasets',
                                                data: { count: datasets.length },
                                            })}
                                            style={{ marginTop: 22 }}
                                        >
                                            데이터 전체 삭제
                                        </Button>
                                    </div>
                                    {bulkPreview && bulkPreview.count === 0 && (
                                        <Text size="sm" c="dimmed" mt="xs">해당 기간에 삭제할 데이터가 없습니다.</Text>
                                    )}
                                </div>
                            </DatesProvider>

                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>번호</Table.Th>
                                        <Table.Th>업로드일</Table.Th>
                                        <Table.Th>검사 데이터</Table.Th>
                                        <Table.Th>사고 데이터</Table.Th>
                                        <Table.Th>데이터 기간</Table.Th>
                                        <Table.Th w={80}>삭제</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {datasets.length === 0 ? (
                                        <Table.Tr>
                                            <Table.Td colSpan={6}>
                                                <Text ta="center" c="dimmed" py="md">업로드된 데이터가 없습니다. 위에서 파일을 업로드해주세요.</Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ) : (
                                        datasets
                                            .slice((datasetsPage - 1) * ITEMS_PER_PAGE, datasetsPage * ITEMS_PER_PAGE)
                                            .map((ds) => {
                                            const meta = ds.metadata || [];
                                            const examMeta = meta.filter(m => m.file_type === 'exam');
                                            const sagoMeta = meta.filter(m => m.file_type === 'sago');

                                            return (
                                                <Table.Tr key={ds.id}>
                                                    <Table.Td>{ds.id}</Table.Td>
                                                    <Table.Td>{formatDate(ds.created_at)}</Table.Td>
                                                    <Table.Td>
                                                        <div className="dataset-meta-cell">
                                                            {examMeta.map((m, i) => (
                                                                <div className="meta-row" key={i}>
                                                                    <span className={`meta-domain domain-${m.domain.toLowerCase()}`}>{m.domain}</span>
                                                                    <span>{m.domain === 'A' ? '신규' : '유지'} {m.record_count?.toLocaleString() || 0}건</span>
                                                                </div>
                                                            ))}
                                                            {examMeta.length === 0 && <Text size="xs" c="dimmed">-</Text>}
                                                        </div>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <div className="dataset-meta-cell">
                                                            {sagoMeta.map((m, i) => (
                                                                <div className="meta-row" key={i}>
                                                                    <span className={`meta-domain domain-${m.domain.toLowerCase()}`}>{m.domain}</span>
                                                                    <span>{m.domain === 'A' ? '신규' : '유지'} {m.record_count?.toLocaleString() || 0}건</span>
                                                                </div>
                                                            ))}
                                                            {sagoMeta.length === 0 && <Text size="xs" c="dimmed">-</Text>}
                                                        </div>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <div className="dataset-meta-cell">
                                                            {meta.filter(m => m.date_from || m.date_to).map((m, i) => (
                                                                <div className="meta-row" key={i}>
                                                                    <span className={`meta-type-badge type-${m.file_type}-${m.domain.toLowerCase()}`}>{FILE_TYPE_LABELS[`${m.file_type}_${m.domain}`] || `${m.domain} ${m.file_type}`}</span>
                                                                    <span>{formatDateRange(m.date_from, m.date_to)}</span>
                                                                </div>
                                                            ))}
                                                            {meta.filter(m => m.date_from || m.date_to).length === 0 && <Text size="xs" c="dimmed">-</Text>}
                                                        </div>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Button
                                                            size="xs"
                                                            variant="light"
                                                            color="red"
                                                            leftSection={<Trash2 size={12} />}
                                                            disabled={training}
                                                            onClick={() => setConfirmModal({
                                                                open: true,
                                                                action: 'delete_dataset',
                                                                data: ds,
                                                            })}
                                                        >
                                                            삭제
                                                        </Button>
                                                    </Table.Td>
                                                </Table.Tr>
                                            );
                                        })
                                    )}
                                </Table.Tbody>
                            </Table>
                            {datasets.length > ITEMS_PER_PAGE && (
                                <Group justify="center" mt="md">
                                    <Pagination
                                        total={Math.ceil(datasets.length / ITEMS_PER_PAGE)}
                                        value={datasetsPage}
                                        onChange={setDatasetsPage}
                                        size="sm"
                                    />
                                </Group>
                            )}
                        </Paper>
                    </Tabs.Panel>
                </Tabs>

                {/* 확인 모달 */}
                <Modal
                    opened={confirmModal.open}
                    onClose={closeModal}
                    onExitTransitionEnd={() => setConfirmModal({ open: false, action: null, data: null })}
                    title={confirmModal.open && confirmModal.action !== 'view_metrics' ? modalTitle : ''}
                    centered
                    trapFocus={false}
                    size={confirmModal.action === 'view_metrics' ? 'xl' : 'md'}
                >
                    {!confirmModal.open ? null : (<>
                    {confirmModal.action === 'activate' && (() => {
                        const activeVer = versions.find(v => v.is_active === 1);
                        return (
                            <div>
                                <Text>
                                    <strong>{confirmModal.data?.version_label}</strong> 버전을 활성화하시겠습니까?
                                </Text>
                                {activeVer && (
                                    <Text size="sm" c="dimmed" mt="xs">
                                        현재 활성: {activeVer.version_label} → 변경: {confirmModal.data?.version_label}
                                    </Text>
                                )}
                            </div>
                        );
                    })()}
                    {confirmModal.action === 'delete_version' && (
                        <Text>
                            <strong>{confirmModal.data?.version_label}</strong> 버전을 삭제하시겠습니까?
                            삭제된 모델은 복구할 수 없습니다.
                        </Text>
                    )}
                    {confirmModal.action === 'delete_dataset' && (
                        <Text>
                            {confirmModal.data?.created_at ? formatDate(confirmModal.data.created_at) : `${confirmModal.data?.id}번`} 업로드 데이터를 삭제하시겠습니까?
                            업로드된 데이터가 모두 삭제됩니다.
                        </Text>
                    )}
                    {confirmModal.action === 'start_training' && (
                        <div>
                            <Text mb="sm">다음 데이터로 학습을 시작합니다.</Text>
                            <div className="training-confirm-summary">
                                <Text size="sm" c="dimmed">현재 학습 데이터 현황</Text>
                                {confirmModal.data?.aExam > 0 && (
                                    <Text size="sm">신규검사: <strong>{confirmModal.data.aExam.toLocaleString()}</strong>건</Text>
                                )}
                                {confirmModal.data?.bExam > 0 && (
                                    <Text size="sm">자격유지검사: <strong>{confirmModal.data.bExam.toLocaleString()}</strong>건</Text>
                                )}
                                {confirmModal.data?.sago > 0 ? (
                                    <Text size="sm">사고 데이터: <strong>{confirmModal.data.sago.toLocaleString()}</strong>건</Text>
                                ) : (
                                    <Alert color="orange" variant="light" mt="xs" icon={<AlertTriangle size={16} />}>
                                        사고 데이터가 없습니다. 모델 성능이 저하될 수 있습니다.
                                    </Alert>
                                )}
                            </div>
                            <Text size="sm" c="dimmed" mt="sm">학습에는 시간이 소요될 수 있습니다.</Text>
                        </div>
                    )}
                    {confirmModal.action === 'cancel_training' && (
                        <Text>
                            진행 중인 학습을 중단하시겠습니까?
                            중단된 학습은 재개할 수 없으며, 처음부터 다시 시작해야 합니다.
                        </Text>
                    )}
                    {confirmModal.action === 'bulk_delete' && (
                        <Text>
                            <strong>{confirmModal.data?.count}건</strong>의 데이터를 삭제하시겠습니까?
                            삭제된 데이터는 복구할 수 없습니다.
                        </Text>
                    )}
                    {confirmModal.action === 'reset_datasets' && (
                        <div>
                            <Text mt="sm">
                                업로드된 <strong>{confirmModal.data?.count}건</strong>의 학습 데이터를 모두 삭제합니다.
                                이 작업은 되돌릴 수 없습니다.
                            </Text>
                        </div>
                    )}
                    {confirmModal.action === 'reset_versions' && (
                        <div>
                            <Text mt="sm">
                                등록된 모델 버전 <strong>{confirmModal.data?.count}건</strong>과 모델 파일을 모두 삭제합니다.
                                이 작업은 되돌릴 수 없습니다.
                            </Text>
                        </div>
                    )}
                    {confirmModal.action === 'system_reset' && (
                        <div>
                            <Alert color="red" variant="light" icon={<AlertTriangle size={16} />} mb="md">
                                이 작업은 모든 데이터를 영구적으로 삭제합니다. 되돌릴 수 없습니다.
                            </Alert>
                            <Stack gap="xs">
                                <Text size="sm">삭제 대상:</Text>
                                <Text size="sm" c="dimmed">• 학습 데이터: <strong>{confirmModal.data?.datasets || 0}회 업로드</strong></Text>
                                <Text size="sm" c="dimmed">• 학습 이력: <strong>{confirmModal.data?.history || 0}건</strong></Text>
                                <Text size="sm" c="dimmed">• 모델 버전: <strong>{confirmModal.data?.versions || 0}건</strong></Text>
                            </Stack>
                        </div>
                    )}
                    {confirmModal.action === 'reset_history' && (
                        <div>
                            <Text mt="sm">
                                학습 이력 <strong>{confirmModal.data?.count}건</strong>을 모두 삭제합니다.
                                모델 버전에는 영향이 없습니다.
                            </Text>
                        </div>
                    )}
                    {confirmModal.action === 'view_metrics' && (() => {
                        const mData = confirmModal.data;
                        const m = mData?.metrics ?? mData;
                        if (!m) return <Text c="dimmed">성능 데이터가 없습니다.</Text>;
                        const r1A = m.stack_A?.final_ensemble;
                        const r1B = m.stack_B?.final_ensemble;
                        const r7 = m.seq;
                        const r1Combined = r1A && r1B ? {
                            score: (r1A.score + r1B.score) / 2,
                            auc: (r1A.auc + r1B.auc) / 2,
                        } : null;
                        const renderDetailRow = (label, val, hint) => (
                            <div className="metrics-row">
                                <span className="metric-label">{label} <small className="metric-hint">{hint}</small></span>
                                <span style={{ fontWeight: 600 }}>{renderMetricVal(val)}</span>
                            </div>
                        );
                        return (
                            <Stack gap="lg">
                                {/* 커스텀 헤더 */}
                                <div className="metrics-modal-header">
                                    <Text className="metrics-modal-title">모델 성능 리포트</Text>
                                    {mData?.version_label && (
                                        <Text size="sm" c="dimmed" mt={4}>
                                            모델 버전: {mData.version_label}{mData.created_at ? ` | 학습일시: ${formatDate(mData.created_at)}` : ''}
                                        </Text>
                                    )}
                                </div>

                                {/* 1. 종합 성능 — Score 메인 */}
                                <div className="metrics-summary-cards">
                                    {r1Combined && (
                                        <div className="metrics-summary-card stack">
                                            <div className="metrics-summary-card-header">
                                                <span className="metrics-summary-dot stack" />
                                                <Text fw={600} size="sm">스태킹 모델</Text>
                                            </div>
                                            <div className="metrics-summary-big">{renderMetricVal(r1Combined.score)}</div>
                                            <Text size="xs" c="dimmed">Score</Text>
                                            <div className="metrics-summary-sub">
                                                <span>AUC <strong>{renderMetricVal(r1Combined.auc)}</strong></span>
                                                <span className="metrics-summary-sep" />
                                                <span>Brier <strong>{renderMetricVal((r1A.brier + r1B.brier) / 2)}</strong></span>
                                                <span className="metrics-summary-sep" />
                                                <span>MCC <strong>{renderMetricVal((r1A.mcc + r1B.mcc) / 2)}</strong></span>
                                            </div>
                                        </div>
                                    )}
                                    {r7 && r7.score != null && (
                                        <div className="metrics-summary-card seq">
                                            <div className="metrics-summary-card-header">
                                                <span className="metrics-summary-dot seq" />
                                                <Text fw={600} size="sm">시퀀스 모델</Text>
                                            </div>
                                            <div className="metrics-summary-big">{renderMetricVal(r7.score)}</div>
                                            <Text size="xs" c="dimmed">Score</Text>
                                            <div className="metrics-summary-sub">
                                                <span>AUC <strong>{renderMetricVal(r7.auc ?? r7.oof_auc)}</strong></span>
                                                {r7.brier != null && <><span className="metrics-summary-sep" /><span>Brier <strong>{renderMetricVal(r7.brier)}</strong></span></>}
                                                {r7.mcc != null && <><span className="metrics-summary-sep" /><span>MCC <strong>{renderMetricVal(r7.mcc)}</strong></span></>}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 2. 스태킹 모델 검사별 상세 */}
                                {(r1A || r1B) && (
                                    <div className="metrics-detail-section">
                                        <Text fw={700} size="md" mb="sm" className="metrics-section-title">스태킹 모델 검사별 상세</Text>
                                        <div className="metrics-ensemble-grid">
                                            {r1A && (
                                                <div className="metrics-domain-card">
                                                    <Text fw={600} mb="xs" size="sm"><Badge size="sm" variant="filled" color="indigo" mr={6}>A</Badge>신규검사</Text>
                                                    {renderDetailRow('Score', r1A.score, '↓')}
                                                    {renderDetailRow('AUC', r1A.auc, '↑')}
                                                    {renderDetailRow('Brier', r1A.brier, '↓')}
                                                    {renderDetailRow('ECE', r1A.ece, '↓')}
                                                    {renderDetailRow('MCC', r1A.mcc, '↑')}
                                                </div>
                                            )}
                                            {r1B && (
                                                <div className="metrics-domain-card">
                                                    <Text fw={600} mb="xs" size="sm"><Badge size="sm" variant="filled" color="red" mr={6}>B</Badge>자격유지검사</Text>
                                                    {renderDetailRow('Score', r1B.score, '↓')}
                                                    {renderDetailRow('AUC', r1B.auc, '↑')}
                                                    {renderDetailRow('Brier', r1B.brier, '↓')}
                                                    {renderDetailRow('ECE', r1B.ece, '↓')}
                                                    {renderDetailRow('MCC', r1B.mcc, '↑')}
                                                </div>
                                            )}
                                            {r1Combined && (
                                                <div className="metrics-domain-card">
                                                    <Text fw={600} mb="xs" size="sm"><Badge size="sm" variant="light" color="gray" mr={6}>A+B</Badge>통합 평균</Text>
                                                    {renderDetailRow('Score', r1Combined.score, '↓')}
                                                    {renderDetailRow('AUC', (r1A.auc + r1B.auc) / 2, '↑')}
                                                    {renderDetailRow('Brier', (r1A.brier + r1B.brier) / 2, '↓')}
                                                    {renderDetailRow('ECE', (r1A.ece + r1B.ece) / 2, '↓')}
                                                    {renderDetailRow('MCC', (r1A.mcc + r1B.mcc) / 2, '↑')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* 3. 개별 모델 성능 — 항상 표시 */}
                                {(() => {
                                    const rowsA = buildModelRows(m.stack_A?.models, 'A');
                                    const rowsB = buildModelRows(m.stack_B?.models, 'B');
                                    const combined = [...rowsA, ...rowsB];
                                    if (combined.length === 0) return null;
                                    return (
                                        <div className="metrics-detail-section">
                                            <Text fw={700} size="md" mb="sm" className="metrics-section-title">
                                                개별 모델 성능 <Badge size="sm" variant="light" color="gray" ml={6}>{combined.length}개</Badge>
                                            </Text>
                                            {renderModelTable(combined, true)}
                                        </div>
                                    );
                                })()}
                            </Stack>
                        );
                    })()}
                    {confirmModal.action === 'view_metrics' ? (
                        <div className="confirm-actions">
                            <Button variant="light" onClick={closeModal}>닫기</Button>
                        </div>
                    ) : (
                        <div className="confirm-actions">
                            <Button variant="outline" onClick={closeModal}>
                                취소
                            </Button>
                            <Button
                                autoFocus
                                color="red"
                                loading={actionLoading || bulkLoading}
                                onClick={() => {
                                    if (confirmModal.action === 'activate') handleActivateVersion(confirmModal.data.id);
                                    else if (confirmModal.action === 'delete_version') handleDeleteVersion(confirmModal.data.id);
                                    else if (confirmModal.action === 'delete_dataset') handleDeleteDataset(confirmModal.data.id);
                                    else if (confirmModal.action === 'start_training') doStartTraining();
                                    else if (confirmModal.action === 'cancel_training') { closeModal(); handleCancelTraining(); }
                                    else if (confirmModal.action === 'bulk_delete') handleBulkDelete();
                                    else if (confirmModal.action === 'reset_datasets') handleResetAll();
                                    else if (confirmModal.action === 'reset_history') handleResetHistory();
                                    else if (confirmModal.action === 'reset_versions') handleResetVersions();
                                    else if (confirmModal.action === 'system_reset') handleSystemReset();
                                }}
                            >
                                {confirmModal.action === 'activate' ? '활성화' :
                                 confirmModal.action === 'start_training' ? '학습 시작' :
                                 confirmModal.action === 'cancel_training' ? '학습 중단' :
                                 confirmModal.action === 'system_reset' ? '전체 초기화' :
                                 confirmModal.action === 'reset_datasets' ? '전체 삭제' :
                                 confirmModal.action === 'reset_history' ? '초기화' :
                                 confirmModal.action === 'reset_versions' ? '초기화' :
                                 '삭제'}
                            </Button>
                        </div>
                    )}
                    </>)}
                </Modal>
            </Container>
        </div>
    );
}

export default AdminDashboard;
