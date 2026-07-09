import { forwardRef, useMemo } from 'react';
import { FEATURE_MAPPINGS, aggregateShapByCategory } from '@/pages/risk/featureMappings';
import { RISK_THRESHOLDS, getRiskLevel } from '@/constants/risk';

const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const s = String(dateStr).replace(/[^0-9]/g, '');
    if (s.length >= 8) return `${s.substring(0,4)}년 ${s.substring(4,6)}월 ${s.substring(6,8)}일`;
    return dateStr;
};

/**
 * PDF 렌더링용 진단 보고서 컴포넌트.
 * RiskDiagnosis (단건) 및 RiskList (일괄) 에서 재사용.
 *
 * @param {Object} props
 * @param {Object} props.driver - 운전자 데이터
 * @param {Array}  props.shapValues - SHAP 값 배열 [{feature, value, code}]
 * @param {Array}  [props.history] - 검사 이력 (선택)
 */
const DiagnosisReport = forwardRef(({ driver, shapValues, history }, ref) => {
    const categoryData = useMemo(() => {
        if (!shapValues || shapValues.length === 0) return { increase: [], decrease: [] };
        const aggregated = aggregateShapByCategory(shapValues);
        return {
            increase: aggregated.filter(d => d.value > 0).sort((a, b) => b.value - a.value),
            decrease: aggregated.filter(d => d.value < 0).sort((a, b) => a.value - b.value),
        };
    }, [shapValues]);

    const testFeatureShap = useMemo(() => {
        if (!shapValues || shapValues.length === 0) return [];
        return shapValues
            .filter(({ feature }) => /^[AB]\d+/.test(feature) && FEATURE_MAPPINGS[feature])
            .map(({ feature, value }) => ({ feature, label: FEATURE_MAPPINGS[feature], value }))
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    }, [shapValues]);

    const score = driver?.result || 0;
    const riskLevel = score >= RISK_THRESHOLDS.HIGH ? '고' : score >= RISK_THRESHOLDS.MEDIUM ? '중' : '저';

    const insightTexts = useMemo(() => {
        if (!shapValues?.length || !driver) return [];
        const result = [];
        result.push({
            type: riskLevel === '고' ? 'danger' : riskLevel === '중' ? 'warning' : 'success',
            badge: '사고 위험도 해석',
            text: `종합 사고 위험도 ${(score * 100).toFixed(1)}%로 ${riskLevel}위험군에 해당합니다.`,
        });
        if (categoryData.increase.length > 0) {
            const top = categoryData.increase[0];
            result.push({ type: 'danger', badge: '주요 위험 요인', text: `${top.label} 결과가 사고 위험도를 가장 크게 높이고 있습니다. (사고 위험 영향도: +${(top.value * 100).toFixed(2)}%p)` });
        }
        if (categoryData.decrease.length > 0) {
            const top = categoryData.decrease[0];
            result.push({ type: 'info', badge: '주요 감소 요인', text: `${top.label} 결과가 사고 위험도를 낮추는 데 기여하고 있습니다. (사고 위험 영향도: ${(top.value * 100).toFixed(2)}%p)` });
        }
        return result;
    }, [shapValues, driver, score, riskLevel, categoryData]);

    if (!driver) return null;

    const renderShapTable = (items, maxVal, label, labelColor, fontSize = 12) => items.length > 0 && (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: fontSize + 1, fontWeight: 700, color: labelColor, marginBottom: 6 }}>{label} ({items.length}개)</div>
            <table style={{ width: '100%', fontSize, borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ background: '#f1f3f5' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '2px solid #dee2e6', width: '35%' }}>{fontSize >= 12 ? '검사 카테고리' : '검사 항목'}</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', borderBottom: '2px solid #dee2e6', width: '65%' }}>사고 위험 영향도</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, idx) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                            <td style={{ padding: `${fontSize >= 12 ? 8 : 5}px 10px`, fontWeight: 500, borderBottom: '1px solid #f1f3f5' }}>{item.label}</td>
                            <td style={{ padding: `${fontSize >= 12 ? 8 : 5}px 10px`, borderBottom: '1px solid #f1f3f5' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ height: fontSize >= 12 ? 8 : 6, width: `${Math.round((Math.abs(item.value) / maxVal) * 100)}%`, background: item.value > 0 ? '#ffa8a8' : '#a5d8ff', borderRadius: 4, minWidth: 4 }} />
                                    </div>
                                    <span style={{ fontWeight: 700, fontSize, color: item.value > 0 ? '#fa5252' : '#228be6', whiteSpace: 'nowrap', minWidth: 80, textAlign: 'right' }}>
                                        {item.value > 0 ? '+' : ''}{(item.value * 100).toFixed(2)}%p
                                    </span>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    const allCats = [...categoryData.increase, ...categoryData.decrease];
    const catMaxVal = Math.max(...allCats.map(d => Math.abs(d.value)), 0.0001);
    const featureMaxVal = testFeatureShap.length > 0 ? Math.max(...testFeatureShap.map(d => Math.abs(d.value)), 0.0001) : 1;

    return (
        <div ref={ref} style={{ width: '800px', background: '#fff', padding: '40px', fontFamily: 'Noto Sans KR, sans-serif' }}>
            {/* 1. 헤더 */}
            <div style={{ textAlign: 'center', marginBottom: 32, paddingBottom: 20, borderBottom: '3px solid #228be6' }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#212529' }}>사고 위험도 정밀 진단 보고서</h1>
                <p style={{ color: '#868e96', fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                    생성일시: {new Date().toLocaleString('ko-KR')}
                </p>
            </div>

            {/* 2. 프로필 */}
            <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>운전자 정보</h3>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr style={{ background: '#f8f9fa' }}>
                            <td style={{ padding: '8px 12px', color: '#868e96', width: '15%', fontWeight: 500 }}>이름</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600, width: '35%' }}>{driver.masked_name || '-'}</td>
                            <td style={{ padding: '8px 12px', color: '#868e96', width: '15%', fontWeight: 500 }}>생년월일</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600, width: '35%' }}>
                                {driver.masked_dob ? `${String(driver.masked_dob).substring(0,4)}년 **월 **일` : '-'}
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 12px', color: '#868e96', fontWeight: 500 }}>성별</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{driver.gender || '-'}</td>
                            <td style={{ padding: '8px 12px', color: '#868e96', fontWeight: 500 }}>검사일자</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{formatDate(driver.TestDate)}</td>
                        </tr>
                        <tr style={{ background: '#f8f9fa' }}>
                            <td style={{ padding: '8px 12px', color: '#868e96', fontWeight: 500 }}>연령</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                                {driver.current_age ? driver.current_age + '세' : '-'}
                                {driver.exam_age && driver.exam_age !== driver.current_age ? ` (수검 당시 ${driver.exam_age}세)` : ''}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#868e96', fontWeight: 500 }}>검사유형</td>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{driver.domain === 'A' ? '신규 검사' : '자격유지 검사'}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px 12px', color: '#868e96', fontWeight: 500 }}>업종</td>
                            <td colSpan={3} style={{ padding: '8px 12px', fontWeight: 600 }}>
                                {driver.industry ? `${driver.industry} (${driver.industry_detail || '-'})` : '-'}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 3. 종합 사고 위험도 */}
            <div style={{ marginBottom: 28, textAlign: 'center', padding: '24px', background: score >= RISK_THRESHOLDS.HIGH ? '#fff5f5' : score >= RISK_THRESHOLDS.MEDIUM ? '#fff9db' : '#ebfbee', borderRadius: 12, border: `2px solid ${score >= RISK_THRESHOLDS.HIGH ? '#ffc9c9' : score >= RISK_THRESHOLDS.MEDIUM ? '#ffec99' : '#b2f2bb'}` }}>
                <div style={{ fontSize: 42, fontWeight: 800, color: score >= RISK_THRESHOLDS.HIGH ? '#fa5252' : score >= RISK_THRESHOLDS.MEDIUM ? '#fd7e14' : '#40c057', letterSpacing: '-1px' }}>
                    {driver.result != null ? (score * 100).toFixed(1) + '%' : '-'}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#495057', marginTop: 6 }}>
                    종합 사고 위험도 — {getRiskLevel(score)}
                </div>
            </div>

            {/* 4. 검사 이력 (있을 때만) */}
            {history && history.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>검사 이력</h3>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#343a40' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'center', color: '#fff', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>일자</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center', color: '#fff', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>사고 위험도</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center', color: '#fff', fontWeight: 600, borderBottom: '1px solid #dee2e6' }}>등급</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((h, idx) => (
                                <tr key={idx}>
                                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5' }}>{h.testDate}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5' }}>{h.score != null ? (h.score * 100).toFixed(1) + '%' : '-'}</td>
                                    <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f1f3f5', color: h.riskGroup?.includes('고위험') ? '#fa5252' : h.riskGroup?.includes('중위험') ? '#fd7e14' : '#40c057' }}>
                                        {h.riskGroup}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* 5. AI 분석 요약 (카테고리별) */}
            <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>AI 분석 요약 (검사별 사고 위험 영향도)</h3>
                {renderShapTable(categoryData.increase, catMaxVal, '위험 증가 요인', '#c92a2a')}
                {renderShapTable(categoryData.decrease, catMaxVal, '위험 감소 요인', '#1864ab')}
            </div>

            {/* 6. AI 분석 상세 (개별 검사 항목) */}
            {testFeatureShap.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>AI 분석 상세 (개별 검사 항목)</h3>
                    {renderShapTable(testFeatureShap.filter(d => d.value > 0).sort((a, b) => b.value - a.value), featureMaxVal, '위험 증가 항목', '#c92a2a', 11)}
                    {renderShapTable(testFeatureShap.filter(d => d.value < 0).sort((a, b) => a.value - b.value), featureMaxVal, '위험 감소 항목', '#1864ab', 11)}
                </div>
            )}

            {/* 7. 주요 발견 사항 */}
            <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, paddingLeft: 12, paddingBottom: 8, borderLeft: '4px solid #228be6', borderBottom: '1px solid #e9ecef', color: '#212529' }}>주요 발견 사항</h3>
                {insightTexts.map((insight, i) => (
                    <div key={i} style={{ padding: '10px 14px', marginBottom: 8, borderRadius: 8, background: insight.type === 'danger' ? '#fff5f5' : insight.type === 'warning' ? '#fff9db' : insight.type === 'success' ? '#ebfbee' : '#e7f5ff', fontSize: 12, borderLeft: `3px solid ${insight.type === 'danger' ? '#fa5252' : insight.type === 'warning' ? '#fd7e14' : insight.type === 'success' ? '#40c057' : '#228be6'}` }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, marginRight: 8, color: '#fff', background: insight.type === 'danger' ? '#fa5252' : insight.type === 'warning' ? '#fd7e14' : insight.type === 'success' ? '#40c057' : '#228be6' }}>
                            {insight.badge}
                        </span>
                        {insight.text}
                    </div>
                ))}

                {categoryData.increase.length > 0 && (
                    <div style={{ padding: '12px 14px', marginTop: 12, background: '#fff5f5', borderRadius: 8, fontSize: 12, borderLeft: '3px solid #fa5252' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, color: '#c92a2a' }}>위험 증가 요인 상세</div>
                        {categoryData.increase.map((f, i) => (
                            <div key={i} style={{ padding: '2px 0', color: '#495057', display: 'flex', gap: 4 }}>
                                <span style={{ color: '#868e96', minWidth: 16 }}>{i + 1}.</span>
                                <span>{f.label}</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#fa5252' }}>+{(f.value * 100).toFixed(2)}%p</span>
                            </div>
                        ))}
                    </div>
                )}

                {categoryData.decrease.length > 0 && (
                    <div style={{ padding: '12px 14px', marginTop: 10, background: '#e7f5ff', borderRadius: 8, fontSize: 12, borderLeft: '3px solid #228be6' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8, color: '#1864ab' }}>위험 감소 요인 상세</div>
                        {categoryData.decrease.map((f, i) => (
                            <div key={i} style={{ padding: '2px 0', color: '#495057', display: 'flex', gap: 4 }}>
                                <span style={{ color: '#868e96', minWidth: 16 }}>{i + 1}.</span>
                                <span>{f.label}</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#228be6' }}>{(f.value * 100).toFixed(2)}%p</span>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ padding: '12px 14px', marginTop: 12, background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#495057', lineHeight: 1.7, borderLeft: '3px solid #495057' }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: '#212529' }}>종합 해석</div>
                    해당 운전자의 사고 위험도는 {(score * 100).toFixed(1)}%이며,
                    총 {categoryData.increase.length}개의 검사 카테고리가 사고 위험도를 높이고 {categoryData.decrease.length}개의 검사 카테고리가 사고 위험도를 낮추고 있습니다.
                    {categoryData.increase.length > 0 && ` 가장 주의가 필요한 영역은 "${categoryData.increase[0].label}"입니다.`}
                    {categoryData.decrease.length > 0 && ` "${categoryData.decrease[0].label}"는 긍정적 영향을 미치고 있습니다.`}
                </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: 10, color: '#adb5bd', marginTop: 30, borderTop: '1px solid #dee2e6', paddingTop: 10 }}>
                본 보고서는 AI 분석 결과를 기반으로 자동 생성되었으며, 참고 자료로만 활용하시기 바랍니다.
            </div>
        </div>
    );
});

DiagnosisReport.displayName = 'DiagnosisReport';
export default DiagnosisReport;
