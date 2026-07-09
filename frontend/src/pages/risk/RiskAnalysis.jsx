import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Container,
  Title,
  Text,
  Paper,
  Select,
  Group,
  Stack,
  Badge,
  Alert,
  Button,
  SimpleGrid,
  Box
} from '@mantine/core';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { CircleAlert, Scale, Loader, Download } from 'lucide-react';
import riskClient from '@/api/riskClient';
import { aggregateShapByCategory } from './featureMappings';
import useAnalysisStore from '@/store/useAnalysisStore';
import { exportElementToPdf } from '@/utils/pdfExport';
import { RISK_COLORS, getRiskLevel } from '@/constants/risk';
import '@/css/risk_dashboard.css';

// ── 연령 코드 파서 ("30a"=30~34세, "30b"=35~39세, 숫자만이면 실제 나이) ──
const parseAgeCode = (ageStr) => {
  if (!ageStr) return null;
  const s = String(ageStr).trim().toLowerCase();
  const match = s.match(/^(\d+)(a|b)?$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const suffix = match[2];
  if (suffix) {
    return { decade: num, isLate: suffix === 'b' };
  }
  return { decade: Math.floor(num / 10) * 10, isLate: (num % 10) >= 5 };
};

const ageLabel = (decade) => `${decade}대`;

// ── 커스텀 툴팁 ──
const formatTooltipValue = (value, suffix) => {
  if (typeof value !== 'number') return value;
  if (suffix === '명') return value.toLocaleString();
  if (suffix === '%') return value.toFixed(1);
  return (value * 100).toFixed(1) + '%';
};

const CustomTooltip = ({ active, payload, label, suffix = '' }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: '#fff',
      borderRadius: 8,
      border: 'none',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      padding: '10px 14px',
      fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#343a40' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#495057' }}>{p.name}: </span>
          <span style={{ fontWeight: 600, color: '#212529' }}>
            {formatTooltipValue(p.value, suffix)}{suffix}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── 공통 축 스타일 ──
const AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  tick: { fill: '#868e96', fontSize: 12 },
};

const GRID_PROPS = {
  strokeDasharray: '3 3',
  vertical: false,
  stroke: '#f1f3f5',
};

const LEGEND_PROPS = {
  iconType: 'circle',
  iconSize: 8,
  align: 'center',
  wrapperStyle: { fontSize: 11 },
  formatter: (v, entry) => <span style={{ color: entry.color, fontWeight: 500 }}>{v}</span>,
};

/**
 * 그룹 바 차트 중앙 정렬 Shape (barGap 포함 보정)
 * - 상대 바 데이터가 있으면: 기본 그룹 위치 유지 (간격 있음)
 * - 상대 바 데이터가 없으면: 라벨 중앙으로 이동
 *
 * barGap=G, barSize=S 일 때:
 *   barA 좌측 = center - S - G/2  → 중앙까지 shift = S/2 + G/2
 *   barB 좌측 = center + G/2      → 중앙까지 shift = -(S/2 + G/2)
 */
const BAR_GAP = 4;
const centeredBarShape = (siblingKey, isFirst, horizontal = false) => (props) => {
  const { x, y, width, height, fill, payload } = props;
  const hasSibling = payload?.[siblingKey] != null;
  if (horizontal) {
    if (!width || width <= 0) return null;
    const shift = hasSibling ? 0 : (isFirst ? (height + BAR_GAP) / 2 : -(height + BAR_GAP) / 2);
    return <rect x={x} y={y + shift} width={width} height={height} fill={fill} rx={4} />;
  }
  if (!height || height <= 0) return null;
  const shift = hasSibling ? 0 : (isFirst ? (width + BAR_GAP) / 2 : -(width + BAR_GAP) / 2);
  return <rect x={x + shift} y={y} width={width} height={height} fill={fill} rx={4} />;
};

// ── 필터 헬퍼 ──
const filterBySelection = (fullData, type, optionVal) => {
  if (!optionVal) return fullData;
  if (type === 'age') {
    const [decadeStr, sub] = optionVal.split('_');
    const decade = parseInt(decadeStr, 10);
    return fullData.filter(d => {
      const parsed = parseAgeCode(d.Age);
      if (!parsed) return false;
      if (parsed.decade !== decade) return false;
      if (!sub) return true;
      if (sub === 'early') return !parsed.isLate;
      if (sub === 'late') return parsed.isLate;
      return false;
    });
  }
  if (type === 'risk') {
    return fullData.filter(d => {
      const s = d.result || d.score || 0;
      let g = '저위험';
      g = getRiskLevel(s);
      return optionVal.includes(g);
    });
  }
  if (type === 'domain') {
    return fullData.filter(d => d.domain === optionVal);
  }
  if (type === 'gender') {
    return fullData.filter(d => String(d.Gender || d.gender || '') === optionVal);
  }
  if (type === 'branch') {
    return fullData.filter(d => String(d.Branch || d.branch || '') === optionVal);
  }
  if (type === 'industry') {
    return fullData.filter(d => String(d.Industry || d.industry || '') === optionVal);
  }
  return fullData;
};

// ── 옵션 라벨 변환 헬퍼 ──
const getOptionLabel = (type, val) => {
  if (!val) return val;
  if (type === 'domain') return val === 'A' ? '신규검사' : '자격유지검사';
  if (type === 'risk') return val;
  if (type === 'age') {
    const [decade, sub] = val.split('_');
    if (!sub) return `${decade}대 전체`;
    return sub === 'early' ? `${decade}대 초반` : `${decade}대 후반`;
  }
  return val;
};

// ── SHAP 데이터 전처리 헬퍼 ──
const getShapIncDec = (shapData) => {
  const all = [...(shapData?.domainA || []), ...(shapData?.domainB || [])];
  const inc = all.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const dec = all.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
  return { all, inc, dec };
};

const renderShapBarChart = (data, name, color) => (
  <ResponsiveContainer width="100%" height={Math.max(data.length * 36, 60)}>
    <BarChart layout="vertical" data={data} margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
      <CartesianGrid {...GRID_PROPS} vertical={true} horizontal={false} stroke="#f1f3f5" />
      <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => (v * 100).toFixed(1) + '%p'} />
      <YAxis dataKey="name" type="category" width={130} {...AXIS_PROPS} tick={{ fill: '#495057', fontSize: 11 }} />
      <ReTooltip formatter={(val) => `${val >= 0 ? '+' : ''}${(val * 100).toFixed(2)}%p`} contentStyle={{borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
      <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} barSize={14} />
    </BarChart>
  </ResponsiveContainer>
);

// ── SHAP 비교 차트 (그룹 A/B 줄맞춤) ──
const ShapComparisonGrid = ({ shapDataA, shapDataB, labelA, labelB }) => {
  const a = getShapIncDec(shapDataA);
  const b = getShapIncDec(shapDataB);

  const maxIncRows = Math.max(a.inc.length, b.inc.length);
  const maxDecRows = Math.max(a.dec.length, b.dec.length);
  const incHeight = Math.max(maxIncRows * 44, 80);
  const decHeight = Math.max(maxDecRows * 44, 80);

  const renderGroupHeader = (label, badgeColor, badgeLetter) => (
    <Group gap={8} mb="sm">
      <Badge size="sm" color={badgeColor} variant="filled">{badgeLetter}</Badge>
      <Text size="sm" fw={700}>{label}</Text>
    </Group>
  );

  const renderSection = (data, name, color, fixedHeight) => (
    <div style={{ height: fixedHeight }}>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 8, right: 20, left: 10, bottom: 8 }}>
            <CartesianGrid {...GRID_PROPS} vertical={true} horizontal={false} stroke="#f1f3f5" />
            <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => (v * 100).toFixed(1) + '%p'} />
            <YAxis dataKey="name" type="category" width={130} {...AXIS_PROPS} tick={{ fill: '#495057', fontSize: 11 }} interval={0} />
            <ReTooltip formatter={(val) => `${val >= 0 ? '+' : ''}${(val * 100).toFixed(2)}%p`} contentStyle={{borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
            <Bar dataKey="value" name={name} fill={color} radius={[0, 4, 4, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text c="dimmed" size="xs">특이 사항 없음</Text>
        </div>
      )}
    </div>
  );

  if (a.all.length === 0 && b.all.length === 0) {
    return <Text c="dimmed" size="sm" ta="center" py="xl">분석 가능한 데이터가 없습니다.</Text>;
  }

  return (
    <div>
      {/* 그룹 헤더 */}
      <SimpleGrid cols={2} spacing="xl">
        {renderGroupHeader(labelA, 'blue', 'A')}
        {renderGroupHeader(labelB, 'red', 'B')}
      </SimpleGrid>

      {/* 위험 증가 요인 - 같은 줄 */}
      <Text size="xs" fw={600} c="red.6" mb={4}>위험 증가 요인</Text>
      <SimpleGrid cols={2} spacing="xl" mb="md">
        {renderSection(a.inc, '위험 증가', '#fa5252', incHeight)}
        {renderSection(b.inc, '위험 증가', '#fa5252', incHeight)}
      </SimpleGrid>

      {/* 위험 감소 요인 - 같은 줄 */}
      <Text size="xs" fw={600} c="blue.6" mb={4}>위험 감소 요인</Text>
      <SimpleGrid cols={2} spacing="xl">
        {renderSection(a.dec, '위험 감소', '#228be6', decHeight)}
        {renderSection(b.dec, '위험 감소', '#228be6', decHeight)}
      </SimpleGrid>
    </div>
  );
};

// ── 단일 그룹 SHAP 차트 (폴백용) ──
const ShapGroupChart = ({ shapData, label, badgeColor }) => {
  const { all, inc, dec } = getShapIncDec(shapData);

  if (all.length === 0) {
    return (
      <Box>
        <Group gap={8} mb="md">
          <Badge size="sm" color={badgeColor} variant="filled">{badgeColor === 'blue' ? 'A' : 'B'}</Badge>
          <Text size="sm" fw={700}>{label}</Text>
        </Group>
        <Text c="dimmed" size="sm" ta="center" py="xl">분석 가능한 데이터가 없습니다.</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Group gap={8} mb="md">
        <Badge size="sm" color={badgeColor} variant="filled">{badgeColor === 'blue' ? 'A' : 'B'}</Badge>
        <Text size="sm" fw={700}>{label}</Text>
      </Group>
      <Text size="xs" fw={600} c="red.6" mb={4}>위험 증가 요인</Text>
      {inc.length > 0 ? renderShapBarChart(inc, '위험 증가', '#fa5252') : (
        <Text c="dimmed" size="xs" ta="center" py="sm">특이 사항 없음</Text>
      )}
      <Text size="xs" fw={600} c="blue.6" mb={4} mt="md">위험 감소 요인</Text>
      {dec.length > 0 ? renderShapBarChart(dec, '위험 감소', '#228be6') : (
        <Text c="dimmed" size="xs" ta="center" py="sm">특이 사항 없음</Text>
      )}
    </Box>
  );
};

const RiskAnalysis = () => {
  const { analysisResults } = useAnalysisStore();

  const [ageData, setAgeData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [distData, setDistData] = useState([]);
  const [distDataB, setDistDataB] = useState([]);
  const [histogramData, setHistogramData] = useState([]);
  const [compositionData, setCompositionData] = useState([]);

  const [statsA, setStatsA] = useState(null);
  const [statsB, setStatsB] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [compared, setCompared] = useState(false);

  const [compareType, setCompareType] = useState('domain');
  const [groupA, setGroupA] = useState('');
  const [groupB, setGroupB] = useState('');

  const [committedA, setCommittedA] = useState('');
  const [committedB, setCommittedB] = useState('');
  const [committedType, setCommittedType] = useState('');

  useEffect(() => {
    setGroupA('');
    setGroupB('');
  }, [compareType]);

  const [ageOptions, setAgeOptions] = useState([]);
  const [riskOptions, setRiskOptions] = useState([]);
  const [domainOptions, setDomainOptions] = useState([]);
  const [genderOptions, setGenderOptions] = useState([]);
  const [branchOptions, setBranchOptions] = useState([]);
  const [industryOptions, setIndustryOptions] = useState([]);

  const [shapDataA, setShapDataA] = useState(null);
  const [shapDataB, setShapDataB] = useState(null);
  const [shapLoading, setShapLoading] = useState(false);

  const [insights, setInsights] = useState([]);
  const [pdfExporting, setPdfExporting] = useState(false);
  const pdfRef = useRef(null);

  const groupALabel = useMemo(() => {
    if (!committedA) return '그룹 A';
    return `그룹 A (${getOptionLabel(committedType, committedA)})`;
  }, [committedType, committedA]);

  const groupBLabel = useMemo(() => {
    if (!committedB) return '그룹 B';
    return `그룹 B (${getOptionLabel(committedType, committedB)})`;
  }, [committedType, committedB]);

  // ── 데이터에서 옵션 초기화 ──
  const initOptions = useCallback((data) => {
    // 연령대 옵션
    const decadeSet = new Set();
    const earlySet = new Set();
    const lateSet = new Set();

    data.forEach(item => {
      const parsed = parseAgeCode(item.Age);
      if (!parsed) return;
      decadeSet.add(parsed.decade);
      if (parsed.isLate) lateSet.add(parsed.decade);
      else earlySet.add(parsed.decade);
    });

    const decades = Array.from(decadeSet).sort((a, b) => a - b);
    const finalOptions = [];
    decades.forEach(decade => {
      finalOptions.push({ value: String(decade), label: `${decade}대 전체` });
      if (earlySet.has(decade)) {
        finalOptions.push({ value: `${decade}_early`, label: `${decade}대 초반` });
      }
      if (lateSet.has(decade)) {
        finalOptions.push({ value: `${decade}_late`, label: `${decade}대 후반` });
      }
    });

    const RISK_ORDER = ['고위험', '중위험', '저위험'];
    const presentRisks = new Set(data.map(item => {
      const s = item.result || item.score || 0;
      return getRiskLevel(s);
    }));
    const uniqueRisks = RISK_ORDER.filter(r => presentRisks.has(r));

    const domainLabels = { A: '신규검사', B: '자격유지검사' };
    const domains = Array.from(new Set(data.map(d => d.domain).filter(Boolean))).sort()
      .map(d => ({ value: d, label: domainLabels[d] || d }));
    const genders = Array.from(new Set(data.map(d => String(d.Gender || d.gender || '')).filter(Boolean))).sort();
    const branches = Array.from(new Set(data.map(d => String(d.Branch || d.branch || '')).filter(Boolean))).sort();
    const industries = Array.from(new Set(data.map(d => String(d.Industry || d.industry || '')).filter(Boolean))).sort();

    setAgeOptions(finalOptions);
    setRiskOptions(uniqueRisks);
    setDomainOptions(domains);
    setGenderOptions(genders);
    setBranchOptions(branches);
    setIndustryOptions(industries);
  }, []);

  // ── 통계 계산기 (표준편차 포함) ──
  const calculateStatsHelper = useCallback((data) => {
    if (!data || data.length === 0) return { summary: null, distData: [], ageData: [], trendData: [] };

    let sumRisk = 0, maxRisk = 0, highCount = 0, midCount = 0;
    const distCount = { '저위험': 0, '중위험': 0, '고위험': 0 };
    const ageGroups = {};
    const trendMap = {};
    const scores = [];

    data.forEach(item => {
      const score = item.result || item.score || 0;
      scores.push(score);
      sumRisk += score;
      if (score > maxRisk) maxRisk = score;

      let group = '저위험';
      group = getRiskLevel(score);
      if (group === '고위험') highCount++;
      else if (group === '중위험') midCount++;
      distCount[group]++;

      const parsed = parseAgeCode(item.Age);
      const ageLbl = parsed ? ageLabel(parsed.decade) : '기타';
      if (!ageGroups[ageLbl]) ageGroups[ageLbl] = { sum: 0, count: 0 };
      ageGroups[ageLbl].sum += score;
      ageGroups[ageLbl].count += 1;

      const dateStr = String(item.TestDate || '');
      if (dateStr.length >= 6) {
        const month = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6);
        if (!trendMap[month]) trendMap[month] = { sum: 0, count: 0 };
        trendMap[month].sum += score;
        trendMap[month].count += 1;
      }
    });

    const total = data.length;
    const avgRisk = total > 0 ? sumRisk / total : 0;
    const highRatio = total > 0 ? (highCount / total) * 100 : 0;
    const midRatio = total > 0 ? (midCount / total) * 100 : 0;

    const variance = total > 0 ? scores.reduce((acc, s) => acc + Math.pow(s - avgRisk, 2), 0) / total : 0;
    const stdDev = Math.sqrt(variance);

    const distArray = [
      { name: '저위험', value: distCount['저위험'] },
      { name: '중위험', value: distCount['중위험'] },
      { name: '고위험', value: distCount['고위험'] },
    ].filter(d => d.value > 0);

    const ageArray = Object.keys(ageGroups).map(key => ({
      name: key,
      riskScore: parseFloat((ageGroups[key].sum / ageGroups[key].count).toFixed(4))
    })).sort((a, b) => a.name.localeCompare(b.name));

    const trendArray = Object.keys(trendMap).sort().map(key => ({
      date: key,
      avgScore: parseFloat((trendMap[key].sum / trendMap[key].count).toFixed(4))
    }));

    return {
      summary: { count: total, avgRisk, maxRisk, highRatio, midRatio, stdDev },
      distData: distArray,
      ageData: ageArray,
      trendData: trendArray,
    };
  }, []);

  const generateHistogram = useCallback((dataA, dataB) => {
    const bins = Array(10).fill(0).map((_, i) => ({
      range: `${i * 10}~${(i + 1) * 10}%`,
      cntA: 0,
      cntB: 0,
    }));

    dataA.forEach(d => {
      const val = d.result || d.score || 0;
      bins[Math.min(Math.floor(val * 10), 9)].cntA++;
    });

    if (dataB && dataB.length > 0) {
      dataB.forEach(d => {
        const val = d.result || d.score || 0;
        bins[Math.min(Math.floor(val * 10), 9)].cntB++;
      });
    }
    return bins;
  }, []);

  // ── 구성 비교 데이터 생성 ──
  const buildCompositionData = useCallback((listA, listB, type) => {
    if (type === 'domain') {
      const riskA = { '저위험': 0, '중위험': 0, '고위험': 0 };
      const riskB = { '저위험': 0, '중위험': 0, '고위험': 0 };
      listA.forEach(d => {
        riskA[getRiskLevel(d.result || d.score || 0)]++;
      });
      listB.forEach(d => {
        riskB[getRiskLevel(d.result || d.score || 0)]++;
      });
      const totalA = listA.length || 1;
      const totalB = listB.length || 1;
      return [
        { name: '저위험', groupA: parseFloat(((riskA['저위험'] / totalA) * 100).toFixed(1)), groupB: parseFloat(((riskB['저위험'] / totalB) * 100).toFixed(1)), countA: riskA['저위험'], countB: riskB['저위험'] },
        { name: '중위험', groupA: parseFloat(((riskA['중위험'] / totalA) * 100).toFixed(1)), groupB: parseFloat(((riskB['중위험'] / totalB) * 100).toFixed(1)), countA: riskA['중위험'], countB: riskB['중위험'] },
        { name: '고위험', groupA: parseFloat(((riskA['고위험'] / totalA) * 100).toFixed(1)), groupB: parseFloat(((riskB['고위험'] / totalB) * 100).toFixed(1)), countA: riskA['고위험'], countB: riskB['고위험'] },
      ];
    } else {
      const domA = { A: 0, B: 0 };
      const domB = { A: 0, B: 0 };
      listA.forEach(d => { domA[d.domain === 'A' ? 'A' : 'B']++; });
      listB.forEach(d => { domB[d.domain === 'A' ? 'A' : 'B']++; });
      const totalA = listA.length || 1;
      const totalB = listB.length || 1;
      return [
        { name: '신규검사', groupA: parseFloat(((domA['A'] / totalA) * 100).toFixed(1)), groupB: parseFloat(((domB['A'] / totalB) * 100).toFixed(1)), countA: domA['A'], countB: domB['A'] },
        { name: '자격유지검사', groupA: parseFloat(((domA['B'] / totalA) * 100).toFixed(1)), groupB: parseFloat(((domB['B'] / totalB) * 100).toFixed(1)), countA: domA['B'], countB: domB['B'] },
      ];
    }
  }, []);

  // ── 초기화 ──
  useEffect(() => {
    if (analysisResults && analysisResults.length > 0) {
      initOptions(analysisResults);
    }
  }, [analysisResults, initOptions]);

  // 도메인 옵션이 2개 미만이고 현재 비교 기준이면 유효한 기본값으로 전환
  useEffect(() => {
    if (compareType === 'domain' && domainOptions.length < 2 && ageOptions.length >= 2) {
      setCompareType('age');
    }
  }, [domainOptions, ageOptions, compareType]);

  const getSelectOptions = useCallback((type) => {
    if (type === 'domain') return domainOptions;
    if (type === 'age') return ageOptions;
    if (type === 'risk') return riskOptions;
    if (type === 'gender') return genderOptions.map(g => ({ value: g, label: g }));
    if (type === 'branch') return branchOptions.map(b => ({ value: b, label: b }));
    if (type === 'industry') return industryOptions.map(i => ({ value: i, label: i }));
    return [];
  }, [domainOptions, ageOptions, riskOptions, genderOptions, branchOptions, industryOptions]);

  // ── SHAP 글로벌 분석 API 호출 ──
  // 1차: test_ids만 전달 → 서버 캐시 경유 (빠름, 1회 호출)
  // 2차 fallback: 캐시 miss 시 기존 chunk 방식 (느리지만 동작)
  const fetchGlobalShap = useCallback(async (data, domain) => {
    if (!data || data.length === 0) return [];

    const parseResult = (response) => {
      if (response.data?.shap_values?.length > 0 && response.data?.feature_names) {
        const rawShap = response.data.feature_names.map((key, idx) => ({
          feature: key,
          value: response.data.shap_values[idx],
        }));
        const aggregated = aggregateShapByCategory(rawShap);
        return aggregated.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      }
      return null;
    };

    // 1차: 서버 캐시 경유 (test_ids만 전달 → 네트워크 최소)
    const testIds = data.filter(d => d.Test_id).map(d => d.Test_id);
    if (testIds.length > 0) {
      try {
        const response = await riskClient.post('/predict/explain_global_by_ids', {
          domain,
          test_ids: testIds,
        });
        const result = parseResult(response);
        if (result) return result;
      } catch {
        // 캐시 miss 또는 서버 재시작 → fallback
      }
    }

    // 2차 fallback: 기존 chunk 방식 (CHUNK 크게 → chunk 수 최소화)
    const CHUNK = 50000;
    const allItems = data.map(d => ({
      Test_id: d.Test_id,
      TestDate: d.TestDate || '20230101',
      Age: d.Age || '0',
      PrimaryKey: d.PrimaryKey || 'UNKNOWN',
      domain: d.domain || domain,
      features: d.features || {},
    }));

    let mergedShap = null;
    let mergedNames = null;
    let chunkCount = 0;

    for (let i = 0; i < allItems.length; i += CHUNK) {
      const items = allItems.slice(i, i + CHUNK);
      const response = await riskClient.post('/predict/explain_global', {
        domain,
        items,
        detailed: false,
      });

      if (response.data?.shap_values && response.data?.feature_names) {
        const { shap_values, feature_names } = response.data;
        if (!mergedShap) {
          mergedShap = shap_values.slice();
          mergedNames = feature_names;
        } else {
          for (let j = 0; j < mergedShap.length; j++) {
            mergedShap[j] = (mergedShap[j] * chunkCount + shap_values[j]) / (chunkCount + 1);
          }
        }
        chunkCount++;
      }
    }

    if (mergedShap && mergedNames) {
      const rawShap = mergedNames.map((key, idx) => ({
        feature: key,
        value: mergedShap[idx],
      }));
      const aggregated = aggregateShapByCategory(rawShap);
      return aggregated.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    }
    return [];
  }, []);

  // ── 비교 분석 시 SHAP 자동 실행 ──
  const runShapAnalysis = useCallback(async (listA, listB) => {
    setShapLoading(true);
    setShapDataA(null);
    setShapDataB(null);

    try {
      const domAinA = listA.filter(d => d.domain === 'A');
      const domBinA = listA.filter(d => d.domain === 'B');
      const domAinB = listB.filter(d => d.domain === 'A');
      const domBinB = listB.filter(d => d.domain === 'B');

      const promises = [
        domAinA.length > 0 ? fetchGlobalShap(domAinA, 'A') : Promise.resolve([]),
        domBinA.length > 0 ? fetchGlobalShap(domBinA, 'B') : Promise.resolve([]),
        domAinB.length > 0 ? fetchGlobalShap(domAinB, 'A') : Promise.resolve([]),
        domBinB.length > 0 ? fetchGlobalShap(domBinB, 'B') : Promise.resolve([]),
      ];

      const [shapA_domA, shapA_domB, shapB_domA, shapB_domB] = await Promise.all(promises);

      setShapDataA({
        domainA: shapA_domA.map(f => ({ name: f.label, value: f.value, category: f.category })),
        domainB: shapA_domB.map(f => ({ name: f.label, value: f.value, category: f.category })),
      });
      setShapDataB({
        domainA: shapB_domA.map(f => ({ name: f.label, value: f.value, category: f.category })),
        domainB: shapB_domB.map(f => ({ name: f.label, value: f.value, category: f.category })),
      });
    } catch (e) {
      setError('AI 분석 중 오류가 발생했습니다: ' + (e.response?.data?.detail || e.message));
    } finally {
      setShapLoading(false);
    }
  }, [fetchGlobalShap]);

  // ── 인사이트 생성 ──
  const generateInsights = useCallback((sA, sB, shapA, shapB, labelA, labelB) => {
    const list = [];

    if (!sA || !sB) return list;

    const avgDiff = sA.avgRisk - sB.avgRisk;
    if (Math.abs(avgDiff) > 0.01) {
      const higher = avgDiff > 0 ? labelA : labelB;
      list.push({
        type: avgDiff > 0 ? 'danger' : 'warning',
        badge: '사고 위험도 차이',
        text: `${higher}의 평균 사고 위험도가 ${(Math.abs(avgDiff) * 100).toFixed(1)}%p 더 높습니다. (${labelA}: ${(sA.avgRisk * 100).toFixed(1)}%, ${labelB}: ${(sB.avgRisk * 100).toFixed(1)}%)`,
      });
    }

    const highDiff = sA.highRatio - sB.highRatio;
    if (Math.abs(highDiff) > 2) {
      const higher = highDiff > 0 ? labelA : labelB;
      list.push({
        type: 'danger',
        badge: '고위험 비율',
        text: `${higher}의 고위험 비율이 ${Math.abs(highDiff).toFixed(1)}%p 더 높습니다. (${labelA}: ${sA.highRatio.toFixed(1)}%, ${labelB}: ${sB.highRatio.toFixed(1)}%)`,
      });
    }

    if (sA.count < 30 || sB.count < 30) {
      const small = sA.count < 30 ? labelA : labelB;
      const cnt = sA.count < 30 ? sA.count : sB.count;
      list.push({
        type: 'warning',
        badge: '표본 크기',
        text: `${small}의 표본 크기가 ${cnt}명으로 적습니다. 분석 결과 해석에 주의가 필요합니다.`,
      });
    }

    if (sA.stdDev > 0 && sB.stdDev > 0) {
      const ratio = Math.max(sA.stdDev, sB.stdDev) / Math.min(sA.stdDev, sB.stdDev);
      if (ratio > 1.5) {
        const more = sA.stdDev > sB.stdDev ? labelA : labelB;
        list.push({
          type: 'info',
          badge: '변동성 비교',
          text: `${more}의 사고 위험도 표준편차가 ${ratio.toFixed(1)}배 더 큽니다. 그룹 내 위험도 분포가 더 넓다는 의미입니다.`,
        });
      }
    }

    if (shapA && shapB) {
      // 통합(A+B) 목록을 절대 영향도 내림차순 정렬 후 1위 선택 — domainA 1위만 고르던 버그 수정
      const allShapA = [...(shapA.domainA || []), ...(shapA.domainB || [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const allShapB = [...(shapB.domainA || []), ...(shapB.domainB || [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      if (allShapA.length > 0 && allShapB.length > 0) {
        const topA = allShapA[0];
        const topB = allShapB[0];
        if (topA && topB && topA.name !== topB.name) {
          list.push({
            type: 'ai',
            badge: 'AI 분석',
            text: `두 그룹의 주요 위험 요인이 다릅니다. ${labelA}는 "${topA.name}", ${labelB}는 "${topB.name}"이 가장 큰 영향을 미칩니다.`,
          });
        }
      }
    }

    if (list.length === 0) {
      list.push({
        type: 'success',
        badge: '요약',
        text: '두 그룹 간 유의미한 차이가 관찰되지 않았습니다.',
      });
    }

    return list;
  }, []);

  // ── 비교 실행 핸들러 ──
  const handleCompare = async () => {
    if (!groupA || !groupB) {
      alert('비교할 그룹을 선택해주세요.');
      return;
    }
    if (groupA === groupB) {
      alert('서로 다른 그룹을 선택해주세요.');
      return;
    }

    setCommittedA(groupA);
    setCommittedB(groupB);
    setCommittedType(compareType);

    const labelA = `그룹 A (${getOptionLabel(compareType, groupA)})`;
    const labelB = `그룹 B (${getOptionLabel(compareType, groupB)})`;

    setLoading(true);
    setCompared(false);

    const listA = filterBySelection(analysisResults, compareType, groupA);
    const listB = filterBySelection(analysisResults, compareType, groupB);

    if (listA.length === 0 || listB.length === 0) {
      const emptyGroups = [];
      if (listA.length === 0) emptyGroups.push(labelA);
      if (listB.length === 0) emptyGroups.push(labelB);
      setError(`${emptyGroups.join(', ')}에 해당하는 데이터가 없습니다. 업로드된 데이터에 해당 항목이 포함되어 있는지 확인해주세요.`);
      setLoading(false);
      return;
    }

    const resA = calculateStatsHelper(listA);
    const resB = calculateStatsHelper(listB);

    setStatsA(resA.summary);
    setStatsB(resB.summary);
    setDistData(resA.distData);
    setDistDataB(resB.distData);
    setHistogramData(generateHistogram(listA, listB));
    setCompositionData(buildCompositionData(listA, listB, compareType));

    const allDates = new Set([...resA.trendData.map(d => d.date), ...resB.trendData.map(d => d.date)]);
    setTrendData(Array.from(allDates).sort().map(date => ({
      date,
      scoreA: resA.trendData.find(d => d.date === date)?.avgScore ?? null,
      scoreB: resB.trendData.find(d => d.date === date)?.avgScore ?? null,
    })));

    const allAges = new Set([...resA.ageData.map(d => d.name), ...resB.ageData.map(d => d.name)]);
    setAgeData(Array.from(allAges).sort().map(name => ({
      name,
      valA: resA.ageData.find(d => d.name === name)?.riskScore ?? null,
      valB: resB.ageData.find(d => d.name === name)?.riskScore ?? null,
    })));

    setCompared(true);
    setLoading(false);

    runShapAnalysis(listA, listB);
    setInsights(generateInsights(resA.summary, resB.summary, null, null, labelA, labelB));
  };

  useEffect(() => {
    if (compared && statsA && statsB && !shapLoading && (shapDataA || shapDataB)) {
      setInsights(generateInsights(statsA, statsB, shapDataA, shapDataB, groupALabel, groupBLabel));
    }
  }, [shapLoading, shapDataA, shapDataB, compared, statsA, statsB, groupALabel, groupBLabel, generateInsights]);

  // ── SHAP 차이 계산 (버터플라이 차트용) ──
  const shapDiffData = useMemo(() => {
    if (!shapDataA || !shapDataB) return [];

    const mapA = new Map();
    const mapB = new Map();

    [...(shapDataA.domainA || []), ...(shapDataA.domainB || [])].forEach(f => {
      const existing = mapA.get(f.name);
      if (!existing || Math.abs(f.value) > Math.abs(existing)) {
        mapA.set(f.name, f.value);
      }
    });
    [...(shapDataB.domainA || []), ...(shapDataB.domainB || [])].forEach(f => {
      const existing = mapB.get(f.name);
      if (!existing || Math.abs(f.value) > Math.abs(existing)) {
        mapB.set(f.name, f.value);
      }
    });

    const allFeatures = new Set([...mapA.keys(), ...mapB.keys()]);
    const diffArr = [];
    allFeatures.forEach(name => {
      const valA = mapA.get(name) || 0;
      const valB = mapB.get(name) || 0;
      diffArr.push({ name, valA, valB, diff: valA - valB });
    });

    return diffArr
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 10);
  }, [shapDataA, shapDataB]);

  // ── 도넛 차트 ──
  const formatSmallPct = (value, total) => {
    if (total === 0 || value === 0) return '0%';
    const pct = (value / total) * 100;
    if (pct < 0.01) return '<0.01%';
    if (pct < 0.1) return pct.toFixed(2) + '%';
    return pct.toFixed(1) + '%';
  };

  const renderDonut = (data, title) => {
    const total = data.reduce((s, d) => s + d.value, 0);
    const allCategories = [
      { name: '저위험', value: 0 },
      { name: '중위험', value: 0 },
      { name: '고위험', value: 0 },
    ].map(cat => {
      const found = data.find(d => d.name === cat.name);
      return found || cat;
    });
    const chartData = allCategories.filter(d => d.value > 0);

    return (
      <Box>
        <Text ta="center" size="sm" fw={700} mb="sm">{title}</Text>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%" cy="50%"
              innerRadius={45} outerRadius={70}
              paddingAngle={5}
              dataKey="value"
              stroke="none"
              minAngle={15}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={RISK_COLORS[entry.name] || '#868e96'} />
              ))}
            </Pie>
            <ReTooltip content={<CustomTooltip suffix="명" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="custom-legend">
          {allCategories.map((entry) => (
            <div key={entry.name} className="legend-item">
              <div className="legend-dot" style={{ backgroundColor: RISK_COLORS[entry.name] }} />
              <span>{entry.name}: {entry.value.toLocaleString()}명 ({formatSmallPct(entry.value, total)})</span>
            </div>
          ))}
        </div>
      </Box>
    );
  };

  // ── 핵심 통계 비교 테이블 ──
  const renderComparisonTable = () => {
    if (!statsA || !statsB) return null;

    const fmtPct = (v) => {
      if (v === 0) return '0%';
      if (v < 0.01) return '<0.01%';
      if (v < 0.1) return v.toFixed(2) + '%';
      return v.toFixed(1) + '%';
    };
    const fmtPctDiff = (v) => {
      const prefix = v > 0 ? '+' : '';
      const abs = Math.abs(v);
      if (abs === 0) return '0%p';
      if (abs < 0.01) return `${prefix}<0.01%p`;
      if (abs < 0.1) return `${prefix}${v.toFixed(2)}%p`;
      return `${prefix}${v.toFixed(1)}%p`;
    };

    // 색상 규칙 (이전 인라인 텍스트 디자인 유지):
    //  - category 'risk' + 임계값 초과: 양수=#fa5252(A 위험↑), 음수=#40c057(A 양호)
    //  - category 'neutral' 또는 |diff| < threshold: #adb5bd(옅은 회색, 거의 동일)
    // 임계값을 도입해 0.001%p 같은 미미한 차이가 빨강/초록으로 강조되는 것을 방지.
    const PCT_THRESHOLD = 0.005; // 0.5%p (소수 비율 단위)

    const rows = [
      {
        label: '분석 대상 수',
        valA: `${statsA.count.toLocaleString()}명`,
        valB: `${statsB.count.toLocaleString()}명`,
        diff: statsA.count - statsB.count,
        fmt: v => `${v > 0 ? '+' : ''}${v.toLocaleString()}명`,
        category: 'neutral',
        threshold: 0,
      },
      {
        label: '평균 사고 위험도',
        valA: (statsA.avgRisk * 100).toFixed(1) + '%',
        valB: (statsB.avgRisk * 100).toFixed(1) + '%',
        diff: statsA.avgRisk - statsB.avgRisk,
        fmt: v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`,
        category: 'risk',
        threshold: PCT_THRESHOLD,
      },
      {
        label: '최대 사고 위험도',
        valA: (statsA.maxRisk * 100).toFixed(1) + '%',
        valB: (statsB.maxRisk * 100).toFixed(1) + '%',
        diff: statsA.maxRisk - statsB.maxRisk,
        fmt: v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`,
        category: 'risk',
        threshold: PCT_THRESHOLD,
      },
      {
        label: '고위험 비율',
        valA: fmtPct(statsA.highRatio),
        valB: fmtPct(statsB.highRatio),
        diff: statsA.highRatio - statsB.highRatio,
        fmt: fmtPctDiff,
        category: 'risk',
        threshold: 0.5, // highRatio는 % 단위 (0~100)
      },
      {
        label: '중위험 비율',
        valA: fmtPct(statsA.midRatio),
        valB: fmtPct(statsB.midRatio),
        diff: statsA.midRatio - statsB.midRatio,
        fmt: fmtPctDiff,
        // 중위험 ↑↓는 좋고 나쁨이 모호하므로 중립 처리
        category: 'neutral',
        threshold: 0.5,
      },
      {
        label: '표준편차',
        valA: (statsA.stdDev * 100).toFixed(1) + '%',
        valB: (statsB.stdDev * 100).toFixed(1) + '%',
        diff: statsA.stdDev - statsB.stdDev,
        fmt: v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`,
        category: 'neutral',
        threshold: PCT_THRESHOLD,
      },
    ];

    // 차이 색상 결정
    const getDiffColor = (row) => {
      const abs = Math.abs(row.diff);
      const isMinor = row.threshold > 0 && abs < row.threshold;
      if (row.category === 'neutral' || isMinor) return '#adb5bd';
      return row.diff > 0 ? '#fa5252' : '#40c057';
    };

    return (
      <div className="mantine-card">
        <div className="chart-header-row">
          <h3 className="chart-title">핵심 통계 비교</h3>
          <span className="chart-badge">비교</span>
        </div>
        <table className="comparison-table">
          <thead>
            <tr>
              <th className="group-header-a" style={{ width: '30%' }}>
                {groupALabel}
                <Badge size="xs" color="blue" variant="filled" ml={6}>{statsA.count.toLocaleString()}명</Badge>
              </th>
              <th className="comparison-diff-header" style={{ width: '20%' }}>지표</th>
              <th className="comparison-diff-header" style={{ width: '20%' }}>차이</th>
              <th className="group-header-b" style={{ width: '30%' }}>
                {groupBLabel}
                <Badge size="xs" color="red" variant="filled" ml={6}>{statsB.count.toLocaleString()}명</Badge>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="comparison-cell" style={{ color: '#228be6' }}>{row.valA}</td>
                <td className="comparison-label">{row.label}</td>
                <td className="comparison-cell" style={{ color: getDiffColor(row), fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                  {row.fmt(row.diff)}
                </td>
                <td className="comparison-cell" style={{ color: '#fa5252' }}>{row.valB}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '6px 8px 2px', opacity: 0.55 }}>
          <Text size="xs"><span style={{ color: '#fa5252' }}>&#9679;</span> A가 더 높음</Text>
          <Text size="xs"><span style={{ color: '#40c057' }}>&#9679;</span> A가 더 낮음</Text>
          <Text size="xs"><span style={{ color: '#adb5bd' }}>&#9679;</span> 유사</Text>
        </div>
      </div>
    );
  };

  // 비교 가능 여부
  const canCompare = groupA && groupB && groupA !== groupB;

  return (
    <>
      <div style={{ backgroundColor: '#F8F9FA', minHeight: '100vh', padding: '2rem 0' }}>
        <Container size="xl">
          <Stack gap="lg">

            {/* 헤더 */}
            <Group justify="space-between" align="flex-start">
              <Stack gap="xs">
                <Title order={2} c="dark.8">비교 분석</Title>
                <Text c="dimmed">그룹 간 사고 위험도 차이를 비교하고 AI로 요인을 분석합니다.</Text>
              </Stack>
              {compared && (
                <Button
                  leftSection={<Download size={16} />}
                  variant="light"
                  color="indigo"
                  loading={pdfExporting}
                  disabled={shapLoading}
                  onClick={async () => {
                    if (!pdfRef.current) return;
                    setPdfExporting(true);
                    try {
                      await exportElementToPdf(pdfRef.current, `비교분석_${groupALabel}_vs_${groupBLabel}.pdf`);
                    } catch (e) {
                      alert('PDF 다운로드 중 오류가 발생했습니다.');
                    } finally {
                      setPdfExporting(false);
                    }
                  }}
                >
                  PDF 다운로드
                </Button>
              )}
            </Group>

            {error && (
              <Alert variant="light" color="red" title="오류" icon={<CircleAlert />} withCloseButton onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {/* ── 비교 컨트롤 ── */}
            <Paper p="md" withBorder radius="md" style={{ borderColor: '#e9ecef' }}>
              <Group align="flex-end" gap="md" wrap="wrap">
                <Select
                  label="비교 기준"
                  placeholder="선택하세요"
                  data={[
                    { value: 'domain', label: `검사유형별 비교${domainOptions.length < 2 ? ' — 데이터 1종만 있음' : ''}`, disabled: domainOptions.length < 2 },
                    { value: 'age', label: '연령대별 비교' },
                    { value: 'risk', label: '위험군별 비교' },
                    { value: 'gender', label: '성별 비교', disabled: genderOptions.length < 2 },
                    { value: 'branch', label: '지역본부별 비교', disabled: branchOptions.length < 2 },
                    { value: 'industry', label: '업종별 비교', disabled: industryOptions.length < 2 },
                  ]}
                  value={compareType}
                  onChange={setCompareType}
                  allowDeselect={false}
                  style={{ width: 220 }}
                />
                <Select
                  key={`group-a-${compareType}`}
                  label="그룹 A"
                  placeholder="선택하세요"
                  data={getSelectOptions(compareType)}
                  value={groupA}
                  onChange={setGroupA}
                  allowDeselect={false}
                  style={{ minWidth: 160 }}
                />
                <Text pb="sm" fw={600} c="dimmed">vs</Text>
                <Select
                  key={`group-b-${compareType}`}
                  label="그룹 B"
                  placeholder="선택하세요"
                  data={getSelectOptions(compareType)}
                  value={groupB}
                  onChange={setGroupB}
                  allowDeselect={false}
                  style={{ minWidth: 160 }}
                />
                <Button
                  onClick={handleCompare}
                  disabled={loading || !canCompare}
                  variant="filled"
                  loading={loading}
                >
                  비교 분석 실행
                </Button>
              </Group>
              {groupA && groupB && groupA === groupB && (
                <Text size="xs" c="red" mt={8}>같은 그룹을 선택할 수 없습니다. 서로 다른 그룹을 선택해주세요.</Text>
              )}
            </Paper>

            {/* ── 빈 상태 ── */}
            {!compared && (
              <div className="empty-state">
                <Scale size={48} color="#adb5bd" strokeWidth={1.5} />
                <Title order={4} c="dimmed">비교 분석을 시작하세요</Title>
                <Text c="dimmed" size="sm" maw={400}>
                  위에서 비교 기준과 두 그룹을 선택한 후 &ldquo;비교 분석 실행&rdquo; 버튼을 클릭하면
                  통계, 차트, AI 분석 결과를 한눈에 비교할 수 있습니다.
                </Text>
              </div>
            )}

            {/* ── 결과 ── */}
            {compared && statsA && statsB && (
              <>
                {/* ── Head-to-Head Table ── */}
                {renderComparisonTable()}

                {/* ── 1행: 분포 차트(8) + 도넛(4) ── */}
                <div className="risk-dashboard-grid-v2">
                  <div className="grid-col-8">
                    <div className="mantine-card">
                      <div className="chart-header-row">
                        <h3 className="chart-title">사고 위험도 분포 비교</h3>
                        <span className="chart-badge">분포</span>
                      </div>
                      <div className="chart-container" style={{ flex: 1, minHeight: 320 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={histogramData} margin={{ left: -20, right: 20, bottom: 10 }}>
                            <defs>
                              <linearGradient id="gradDistA" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#228be6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#228be6" stopOpacity={0.05} />
                              </linearGradient>
                              <linearGradient id="gradDistB" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fa5252" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#fa5252" stopOpacity={0.05} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid {...GRID_PROPS} />
                            <XAxis dataKey="range" {...AXIS_PROPS} tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                            <YAxis {...AXIS_PROPS} />
                            <ReTooltip content={<CustomTooltip suffix="명" />} />
                            <Legend {...LEGEND_PROPS} />
                            <Area type="monotone" dataKey="cntA" name={groupALabel} stroke="#228be6" strokeWidth={2} fillOpacity={1} fill="url(#gradDistA)" />
                            <Area type="monotone" dataKey="cntB" name={groupBLabel} stroke="#fa5252" strokeWidth={2} fillOpacity={1} fill="url(#gradDistB)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  <div className="grid-col-4">
                    <div className="mantine-card">
                      <div className="chart-header-row">
                        <h3 className="chart-title">위험 등급 구성</h3>
                        <span className="chart-badge">등급</span>
                      </div>
                      <Stack gap="md">
                        {renderDonut(distData, groupALabel)}
                        {renderDonut(distDataB, groupBLabel)}
                      </Stack>
                    </div>
                  </div>
                </div>

                {/* ── 2행: 연령대(4) + 추이(4) + 구성(4) ── */}
                <div className="risk-dashboard-grid-v2">
                  {/* 연령대별 막대 차트 */}
                  <div className="grid-col-4">
                    <div className="mantine-card">
                      <div className="chart-header-row">
                        <h3 className="chart-title">연령대별 사고 위험도</h3>
                        <span className="chart-badge">연령</span>
                      </div>
                      <div className="chart-container" style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ageData} margin={{ top: 20, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid {...GRID_PROPS} />
                            <XAxis dataKey="name" {...AXIS_PROPS} tick={{ fontSize: 11 }} />
                            <YAxis domain={[0, 'auto']} {...AXIS_PROPS} tickFormatter={v => (v * 100).toFixed(1) + '%'} />
                            <ReTooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                            <Legend {...LEGEND_PROPS} />
                            <Bar dataKey="valA" name={groupALabel} fill="#228be6" barSize={16} shape={centeredBarShape('valB', true)} />
                            <Bar dataKey="valB" name={groupBLabel} fill="#fa5252" barSize={16} shape={centeredBarShape('valA', false)} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* 월별 추이 */}
                  <div className="grid-col-4">
                    <div className="mantine-card">
                      <div className="chart-header-row">
                        <h3 className="chart-title">월별 사고 위험도 추이</h3>
                        <span className="chart-badge">추이</span>
                      </div>
                      <div className="chart-container" style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <defs>
                              <linearGradient id="gradTrendA" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#228be6" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#228be6" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="gradTrendB" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fa5252" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#fa5252" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid {...GRID_PROPS} />
                            <XAxis dataKey="date" {...AXIS_PROPS} tick={{ fontSize: 10 }} dy={10} />
                            <YAxis domain={['auto', 'auto']} {...AXIS_PROPS} tickFormatter={v => (v * 100).toFixed(1) + '%'} />
                            <ReTooltip content={<CustomTooltip />} />
                            <Legend {...LEGEND_PROPS} />
                            <Area type="monotone" dataKey="scoreA" name={groupALabel} stroke="#228be6" strokeWidth={2} fillOpacity={1} fill="url(#gradTrendA)" activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
                            <Area type="monotone" dataKey="scoreB" name={groupBLabel} stroke="#fa5252" strokeWidth={2} fillOpacity={1} fill="url(#gradTrendB)" activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* 그룹 내 구성 */}
                  <div className="grid-col-4">
                    <div className="mantine-card">
                      <div className="chart-header-row">
                        <h3 className="chart-title">그룹 내 구성 비교</h3>
                        <span className="chart-badge">구성</span>
                      </div>
                      <div className="chart-container" style={{ height: 300 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compositionData} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid {...GRID_PROPS} vertical={true} horizontal={false} />
                            <XAxis type="number" {...AXIS_PROPS} unit="%" />
                            <YAxis dataKey="name" type="category" width={70} {...AXIS_PROPS} tick={{ fill: '#495057', fontSize: 11 }} />
                            <ReTooltip content={<CustomTooltip suffix="%" />} />
                            <Legend {...LEGEND_PROPS} />
                            <Bar dataKey="groupA" name={groupALabel} fill="#228be6" barSize={16} shape={centeredBarShape('groupB', true, true)} />
                            <Bar dataKey="groupB" name={groupBLabel} fill="#fa5252" barSize={16} shape={centeredBarShape('groupA', false, true)} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── AI 비교 분석 (SHAP) ── */}
                <div className="mantine-card" style={{ marginTop: 8 }}>
                  <div className="chart-header-row" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div>
                        <h3 className="chart-title" style={{ marginBottom: 2 }}>AI 비교 분석</h3>
                        <Text size="xs" c="dimmed">
                          AI 기반으로 그룹 간 주요 위험 요인 차이를 분석합니다.
                        </Text>
                      </div>
                    </div>
                    {shapLoading && (
                      <Badge color="grape" variant="light" leftSection={<Loader size={12} className="spinner" />}>
                        분석 중...
                      </Badge>
                    )}
                  </div>

                  {shapLoading ? (
                    <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', borderRadius: 8, marginTop: 16, gap: 12 }}>
                      <Loader size={12} className="spinner" style={{ width: 28, height: 28, color: '#be4bdb' }} />
                      <Text c="dimmed" size="sm">AI 모델이 그룹별 위험 요인을 분석하고 있습니다...</Text>
                    </div>
                  ) : (shapDataA || shapDataB) ? (
                    <Box mt="md">
                      <ShapComparisonGrid
                        shapDataA={shapDataA}
                        shapDataB={shapDataB}
                        labelA={groupALabel}
                        labelB={groupBLabel}
                      />
                    </Box>
                  ) : (
                    <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', borderRadius: 8, marginTop: 16 }}>
                      <Text c="dimmed" size="sm">비교 분석 실행 시 AI 분석이 자동으로 시작됩니다.</Text>
                    </div>
                  )}
                </div>

                {/* ── 인사이트 ── */}
                {insights.length > 0 && (
                  <div className="mantine-card">
                    <div className="chart-header-row">
                      <h3 className="chart-title">주요 발견 사항</h3>
                      <span className="chart-badge">인사이트</span>
                    </div>
                    <Stack gap="sm">
                      {insights.map((insight, i) => {
                        const colorMap = {
                          danger: 'red',
                          warning: 'orange',
                          success: 'teal',
                          ai: 'violet',
                          info: 'blue',
                        };
                        const bgMap = {
                          danger: '#fff5f5',
                          warning: '#fff9db',
                          success: '#ebfbee',
                          ai: '#f3f0ff',
                          info: '#e7f5ff',
                        };
                        const badgeColor = colorMap[insight.type] || 'blue';
                        return (
                          <Group key={i} gap="sm" align="flex-start" wrap="nowrap" style={{
                            padding: '10px 14px',
                            borderRadius: 8,
                            background: bgMap[insight.type] || '#f8f9fa',
                          }}>
                            <Badge size="sm" variant="light" color={badgeColor} style={{ flexShrink: 0 }}>
                              {insight.badge}
                            </Badge>
                            <Text size="sm" c="dark.6" style={{ lineHeight: 1.5 }}>{insight.text}</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  </div>
                )}
              </>
            )}

          </Stack>
        </Container>
      </div>

      {/* ── PDF 전용 Hidden Div ── */}
      {compared && statsA && statsB && (
        <div
          ref={pdfRef}
          style={{
            position: 'absolute',
            left: '-9999px',
            top: 0,
            width: '800px',
            background: '#fff',
            padding: '40px',
            fontFamily: 'Noto Sans KR, sans-serif',
          }}
        >
          {/* 1. 헤더 */}
          <div style={{ textAlign: 'center', marginBottom: 32, paddingBottom: 20, borderBottom: '3px solid #228be6' }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#212529' }}>비교 분석 보고서</h1>
            <p style={{ color: '#868e96', fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              생성일시: {new Date().toLocaleString('ko-KR')}
            </p>
          </div>

          {/* 2. 비교 조건 */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>비교 조건</h3>
            <div style={{ textAlign: 'center', padding: '10px 0 14px', fontSize: 13, color: '#495057' }}>
              <span style={{ fontWeight: 700, color: '#212529' }}>
                {committedType === 'domain' ? '검사유형' : committedType === 'age' ? '연령대' : committedType === 'risk' ? '위험군' : committedType === 'gender' ? '성별' : committedType === 'branch' ? '지역본부' : '업종'}
              </span>
              {' '}기준 비교 · 총 <span style={{ fontWeight: 700 }}>{(statsA.count + statsB.count).toLocaleString()}</span>명
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, borderTop: '3px solid #228be6', background: '#f8f9fa', borderRadius: '0 0 8px 8px', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: '#228be6', fontWeight: 700, marginBottom: 4 }}>그룹 A</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#212529' }}>{groupALabel.replace(/^그룹 A \(/, '').replace(/\)$/, '')}</div>
                <div style={{ fontSize: 12, color: '#868e96', marginTop: 2 }}>{statsA.count.toLocaleString()}명</div>
              </div>
              <div style={{ flex: 1, borderTop: '3px solid #fa5252', background: '#f8f9fa', borderRadius: '0 0 8px 8px', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, color: '#fa5252', fontWeight: 700, marginBottom: 4 }}>그룹 B</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#212529' }}>{groupBLabel.replace(/^그룹 B \(/, '').replace(/\)$/, '')}</div>
                <div style={{ fontSize: 12, color: '#868e96', marginTop: 2 }}>{statsB.count.toLocaleString()}명</div>
              </div>
            </div>
          </div>

          {/* 3. 핵심 통계 비교 */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>핵심 통계 비교</h3>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f1f3f5' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '2px solid #dee2e6', width: '22%' }}>지표</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#228be6', fontWeight: 600, borderBottom: '2px solid #dee2e6', whiteSpace: 'nowrap' }}>{groupALabel}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#fa5252', fontWeight: 600, borderBottom: '2px solid #dee2e6', whiteSpace: 'nowrap' }}>{groupBLabel}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#495057', fontWeight: 600, borderBottom: '2px solid #dee2e6', width: '16%' }}>차이</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: '분석 대상 수', valA: `${statsA.count.toLocaleString()}명`, valB: `${statsB.count.toLocaleString()}명`, diff: `${(statsA.count - statsB.count) > 0 ? '+' : ''}${(statsA.count - statsB.count).toLocaleString()}명` },
                  { label: '평균 사고 위험도', valA: (statsA.avgRisk * 100).toFixed(1) + '%', valB: (statsB.avgRisk * 100).toFixed(1) + '%', diff: `${(statsA.avgRisk - statsB.avgRisk) > 0 ? '+' : ''}${((statsA.avgRisk - statsB.avgRisk) * 100).toFixed(1)}%p` },
                  { label: '최대 사고 위험도', valA: (statsA.maxRisk * 100).toFixed(1) + '%', valB: (statsB.maxRisk * 100).toFixed(1) + '%', diff: `${(statsA.maxRisk - statsB.maxRisk) > 0 ? '+' : ''}${((statsA.maxRisk - statsB.maxRisk) * 100).toFixed(1)}%p` },
                  { label: '고위험 비율', valA: `${statsA.highRatio.toFixed(1)}%`, valB: `${statsB.highRatio.toFixed(1)}%`, diff: `${(statsA.highRatio - statsB.highRatio) > 0 ? '+' : ''}${(statsA.highRatio - statsB.highRatio).toFixed(1)}%p` },
                  { label: '표준편차', valA: (statsA.stdDev * 100).toFixed(1) + '%', valB: (statsB.stdDev * 100).toFixed(1) + '%', diff: `${(statsA.stdDev - statsB.stdDev) > 0 ? '+' : ''}${((statsA.stdDev - statsB.stdDev) * 100).toFixed(1)}%p` },
                ].map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', fontWeight: 500, borderBottom: '1px solid #f1f3f5' }}>{row.label}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5' }}>{row.valA}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5' }}>{row.valB}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5' }}>{row.diff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 4. AI SHAP 분석 — 검사별 사고 위험 영향도 비교 */}
          {(shapDataA || shapDataB) && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>AI 요인 분석 (검사별 사고 위험 영향도)</h3>
              {shapDiffData.length > 0 && (() => {
                const maxAbsDiff = Math.max(...shapDiffData.map(r => Math.abs(r.diff)), 0.0001);
                return (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 8 }}>
                  <thead>
                    <tr style={{ background: '#f1f3f5' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #dee2e6', color: '#495057', fontWeight: 600, width: '28%' }}>검사 항목</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '2px solid #dee2e6', color: '#495057', fontWeight: 600, width: '40%' }}>그룹 간 차이</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '2px solid #dee2e6', color: '#228be6', fontWeight: 600, whiteSpace: 'nowrap' }}>{groupALabel.replace(/^그룹 /, '')}</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '2px solid #dee2e6', color: '#fa5252', fontWeight: 600, whiteSpace: 'nowrap' }}>{groupBLabel.replace(/^그룹 /, '')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shapDiffData.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 500, borderBottom: '1px solid #f1f3f5', fontSize: 11 }}>{row.name}</td>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f3f5' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ height: 8, width: `${Math.round((Math.abs(row.diff) / maxAbsDiff) * 100)}%`, background: row.diff >= 0 ? '#ffa8a8' : '#a5d8ff', borderRadius: 4, minWidth: 3 }} />
                            </div>
                            <span style={{ fontWeight: 700, color: row.diff > 0 ? '#fa5252' : row.diff < 0 ? '#228be6' : '#868e96', whiteSpace: 'nowrap', fontSize: 11, minWidth: 55, textAlign: 'right' }}>
                              {row.diff >= 0 ? '+' : ''}{(row.diff * 100).toFixed(2)}%p
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid #f1f3f5', fontSize: 11, fontWeight: 500, color: row.valA >= 0 ? '#fa5252' : '#228be6' }}>
                          {row.valA >= 0 ? '+' : ''}{(row.valA * 100).toFixed(1)}%p
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center', borderBottom: '1px solid #f1f3f5', fontSize: 11, fontWeight: 500, color: row.valB >= 0 ? '#fa5252' : '#228be6' }}>
                          {row.valB >= 0 ? '+' : ''}{(row.valB * 100).toFixed(1)}%p
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                );
              })()}

              {/* 그룹별 위험 요인 상세 — 카드 스타일 */}
              <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
                {[
                  { data: shapDataA, label: groupALabel, headerBg: '#228be6', borderColor: '#d0ebff' },
                  { data: shapDataB, label: groupBLabel, headerBg: '#fa5252', borderColor: '#ffc9c9' },
                ].map(({ data, label, headerBg, borderColor }) => {
                  if (!data) return null;
                  const all = [...(data.domainA || []), ...(data.domainB || [])];
                  const inc = all.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
                  const dec = all.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
                  const maxVal = Math.max(...all.map(d => Math.abs(d.value)), 0.0001);
                  return (
                    <div key={label} style={{ flex: 1, border: `1px solid ${borderColor}`, borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: headerBg, color: '#fff', padding: '8px 14px', fontSize: 13, fontWeight: 700 }}>
                        {label}
                      </div>
                      <div style={{ padding: '12px 14px' }}>
                        {inc.length > 0 && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#e03131', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>▲</span> 위험 증가 요인
                            </div>
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginBottom: dec.length > 0 ? 14 : 0 }}>
                              <tbody>
                                {inc.map((f, i) => (
                                  <tr key={i}>
                                    <td style={{ padding: '3px 0', color: '#495057', width: '50%' }}>{f.name}</td>
                                    <td style={{ padding: '3px 4px', width: '30%' }}>
                                      <div style={{ height: 5, width: `${Math.round((f.value / maxVal) * 100)}%`, background: '#ffa8a8', borderRadius: 3, minWidth: 3 }} />
                                    </td>
                                    <td style={{ padding: '3px 4px', textAlign: 'right', fontWeight: 700, color: '#fa5252', whiteSpace: 'nowrap', fontSize: 10 }}>
                                      +{(f.value * 100).toFixed(2)}%p
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        )}
                        {dec.length > 0 && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#1864ab', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>▼</span> 위험 감소 요인
                            </div>
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <tbody>
                                {dec.map((f, i) => (
                                  <tr key={i}>
                                    <td style={{ padding: '3px 0', color: '#495057', width: '50%' }}>{f.name}</td>
                                    <td style={{ padding: '3px 4px', width: '30%' }}>
                                      <div style={{ height: 5, width: `${Math.round((Math.abs(f.value) / maxVal) * 100)}%`, background: '#a5d8ff', borderRadius: 3, minWidth: 3 }} />
                                    </td>
                                    <td style={{ padding: '3px 4px', textAlign: 'right', fontWeight: 700, color: '#228be6', whiteSpace: 'nowrap', fontSize: 10 }}>
                                      {(f.value * 100).toFixed(2)}%p
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        )}
                        {inc.length === 0 && dec.length === 0 && (
                          <div style={{ textAlign: 'center', color: '#adb5bd', fontSize: 11, padding: 16 }}>
                            분석 데이터 없음
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. 주요 발견 사항 (PDF용 상세) */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>주요 발견 사항</h3>

            {/* 기본 인사이트 */}
            {insights.map((insight, i) => {
              const colorMap = {
                danger:  { bg: '#fff5f5', border: '#fa5252', badge: '#fa5252' },
                warning: { bg: '#fff9db', border: '#fd7e14', badge: '#fd7e14' },
                success: { bg: '#ebfbee', border: '#40c057', badge: '#40c057' },
                ai:      { bg: '#f3f0ff', border: '#7950f2', badge: '#7950f2' },
                info:    { bg: '#e7f5ff', border: '#228be6', badge: '#228be6' },
              };
              const c = colorMap[insight.type] || colorMap.info;
              return (
              <div key={i} style={{
                padding: '10px 14px',
                marginBottom: 8,
                borderRadius: 8,
                background: c.bg,
                fontSize: 12,
                borderLeft: `3px solid ${c.border}`,
              }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  marginRight: 8,
                  color: '#fff',
                  background: c.badge,
                }}>
                  {insight.badge}
                </span>
                {insight.text}
              </div>
              );
            })}

            {/* SHAP 그룹별 주요 위험 영향 요인 */}
            {[
              { data: shapDataA, label: groupALabel, bg: '#e7f5ff', border: '#228be6', titleColor: '#1864ab' },
              { data: shapDataB, label: groupBLabel, bg: '#fff5f5', border: '#fa5252', titleColor: '#c92a2a' },
            ].map(({ data, label, bg, border, titleColor }) => {
              if (!data) return null;
              const items = [...(data.domainA || []), ...(data.domainB || [])]
                .sort((a, b) => {
                  // +먼저(내림차순) → -나중(오름차순)
                  if (a.value >= 0 && b.value < 0) return -1;
                  if (a.value < 0 && b.value >= 0) return 1;
                  return Math.abs(b.value) - Math.abs(a.value);
                })
                .slice(0, 8);
              const maxVal = items.length > 0 ? Math.max(...items.map(d => Math.abs(d.value)), 0.0001) : 1;
              return (
                <div key={label} style={{ padding: '12px 14px', marginTop: 10, background: bg, borderRadius: 8, fontSize: 12, borderLeft: `3px solid ${border}` }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: titleColor }}>{label} 주요 위험 영향 요인</div>
                  {items.map((f, i) => (
                    <div key={i} style={{ padding: '3px 0', color: '#495057', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#868e96', minWidth: 16, fontSize: 11 }}>{i + 1}.</span>
                      <span style={{ minWidth: 100, fontSize: 11 }}>{f.name}</span>
                      <div style={{ flex: 1, padding: '0 4px' }}>
                        <div style={{ height: 6, width: `${Math.round((Math.abs(f.value) / maxVal) * 100)}%`, background: f.value >= 0 ? '#ffa8a8' : '#a5d8ff', borderRadius: 3, minWidth: 3 }} />
                      </div>
                      <span style={{ fontWeight: 600, color: f.value >= 0 ? '#fa5252' : '#228be6', whiteSpace: 'nowrap', fontSize: 11, minWidth: 65, textAlign: 'right' }}>
                        {f.value >= 0 ? '+' : ''}{(f.value * 100).toFixed(2)}%p
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* 종합 해석 */}
            {statsA && statsB && (
              <div style={{ padding: '10px 12px', marginTop: 10, background: '#f8f9fa', borderRadius: 6, fontSize: 12, color: '#495057', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: '#343a40' }}>종합 해석</div>
                {groupALabel}({statsA.count.toLocaleString()}명)과 {groupBLabel}({statsB.count.toLocaleString()}명)을 비교 분석한 결과,
                평균 사고 위험도는 각각 {(statsA.avgRisk * 100).toFixed(1)}%와 {(statsB.avgRisk * 100).toFixed(1)}%로
                {Math.abs(statsA.avgRisk - statsB.avgRisk) > 0.01
                  ? ` ${statsA.avgRisk > statsB.avgRisk ? groupALabel : groupBLabel}이(가) ${(Math.abs(statsA.avgRisk - statsB.avgRisk) * 100).toFixed(1)}%p 더 높습니다.`
                  : ' 유의미한 차이가 없습니다.'}
                {` 고위험 비율은 ${groupALabel} ${statsA.highRatio.toFixed(1)}%, ${groupBLabel} ${statsB.highRatio.toFixed(1)}%입니다.`}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'center', fontSize: 10, color: '#adb5bd', marginTop: 30, borderTop: '1px solid #dee2e6', paddingTop: 10 }}>
            본 보고서는 AI 분석 결과를 기반으로 자동 생성되었으며, 참고 자료로만 활용하시기 바랍니다.
          </div>
        </div>
      )}
    </>
  );
};

export default RiskAnalysis;
