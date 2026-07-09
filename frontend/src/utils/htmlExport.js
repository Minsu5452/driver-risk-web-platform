import { FEATURE_MAPPINGS, aggregateShapByCategory } from '@/pages/risk/featureMappings';
import { RISK_THRESHOLDS, getRiskLevel } from '@/constants/risk';

const fmtDate = (d) => {
    if (!d) return '-';
    const s = String(d).replace(/[^0-9]/g, '');
    if (s.length >= 8) return `${s.substring(0,4)}년 ${s.substring(4,6)}월 ${s.substring(6,8)}일`;
    return d;
};

const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function shapTableHtml(items, maxVal, title, titleColor, thLabel, fontSize = 12) {
    if (!items.length) return '';
    const pad = fontSize >= 12 ? 8 : 5;
    const barH = fontSize >= 12 ? 8 : 6;
    const rows = items.map((it, i) => {
        const bg = i % 2 === 0 ? '#fff' : '#f8f9fa';
        const barW = Math.round((Math.abs(it.value) / maxVal) * 100);
        const barColor = it.value > 0 ? '#ffa8a8' : '#a5d8ff';
        const valColor = it.value > 0 ? '#fa5252' : '#228be6';
        const sign = it.value > 0 ? '+' : '';
        return `<tr style="background:${bg}">
            <td style="padding:${pad}px 10px;font-weight:500;border-bottom:1px solid #f1f3f5">${esc(it.label)}</td>
            <td style="padding:${pad}px 10px;border-bottom:1px solid #f1f3f5">
                <div style="display:flex;align-items:center;gap:10px">
                    <div style="flex:1"><div style="height:${barH}px;width:${barW}%;background:${barColor};border-radius:4px;min-width:4px"></div></div>
                    <span style="font-weight:700;font-size:${fontSize}px;color:${valColor};white-space:nowrap;min-width:80px;text-align:right">${sign}${(it.value * 100).toFixed(2)}%p</span>
                </div>
            </td>
        </tr>`;
    }).join('');
    return `<div style="margin-bottom:14px">
        <div style="font-size:${fontSize+1}px;font-weight:700;color:${titleColor};margin-bottom:6px">${esc(title)} (${items.length}개)</div>
        <table style="width:100%;font-size:${fontSize}px;border-collapse:collapse">
            <thead><tr style="background:#f1f3f5">
                <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #dee2e6;width:35%">${thLabel}</th>
                <th style="padding:6px 10px;text-align:right;border-bottom:2px solid #dee2e6;width:65%">사고 위험 영향도</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

/**
 * 운전자 데이터 + SHAP 값으로 독립 실행 가능한 HTML 파일 문자열 생성.
 * DiagnosisReport.jsx와 동일한 구조/스타일.
 */
export function buildReportHtml(driver, shapValues) {
    const score = driver.result || 0;
    const riskLevel = score >= RISK_THRESHOLDS.HIGH ? '고' : score >= RISK_THRESHOLDS.MEDIUM ? '중' : '저';

    // SHAP 집계
    const aggregated = aggregateShapByCategory(shapValues);
    const catInc = aggregated.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
    const catDec = aggregated.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
    const allCats = [...catInc, ...catDec];
    const catMax = Math.max(...allCats.map(d => Math.abs(d.value)), 0.0001);

    const testFeatures = shapValues
        .filter(({ feature }) => /^[AB]\d+/.test(feature) && FEATURE_MAPPINGS[feature])
        .map(({ feature, value }) => ({ label: FEATURE_MAPPINGS[feature], value }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const featInc = testFeatures.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
    const featDec = testFeatures.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
    const featMax = testFeatures.length > 0 ? Math.max(...testFeatures.map(d => Math.abs(d.value)), 0.0001) : 1;

    // 색상
    const riskColor = score >= RISK_THRESHOLDS.HIGH ? '#fa5252' : score >= RISK_THRESHOLDS.MEDIUM ? '#fd7e14' : '#40c057';
    const riskBg = score >= RISK_THRESHOLDS.HIGH ? '#fff5f5' : score >= RISK_THRESHOLDS.MEDIUM ? '#fff9db' : '#ebfbee';
    const riskBorder = score >= RISK_THRESHOLDS.HIGH ? '#ffc9c9' : score >= RISK_THRESHOLDS.MEDIUM ? '#ffec99' : '#b2f2bb';

    const sectionTitle = (text) =>
        `<h3 style="font-size:15px;font-weight:700;margin:0 0 14px 0;padding-left:12px;padding-bottom:8px;border-left:4px solid #228be6;border-bottom:1px solid #e9ecef;color:#212529">${esc(text)}</h3>`;

    // 인사이트
    const insights = [];
    insights.push({ type: riskLevel === '고' ? 'danger' : riskLevel === '중' ? 'warning' : 'success', badge: '사고 위험도 해석', text: `종합 사고 위험도 ${(score*100).toFixed(1)}%로 ${riskLevel}위험군에 해당합니다.` });
    if (catInc.length > 0) insights.push({ type: 'danger', badge: '주요 위험 요인', text: `${catInc[0].label} 결과가 사고 위험도를 가장 크게 높이고 있습니다. (사고 위험 영향도: +${(catInc[0].value*100).toFixed(2)}%p)` });
    if (catDec.length > 0) insights.push({ type: 'info', badge: '주요 감소 요인', text: `${catDec[0].label} 결과가 사고 위험도를 낮추는 데 기여하고 있습니다. (사고 위험 영향도: ${(catDec[0].value*100).toFixed(2)}%p)` });

    const insightColors = { danger: { bg: '#fff5f5', border: '#fa5252', badge: '#fa5252' }, warning: { bg: '#fff9db', border: '#fd7e14', badge: '#fd7e14' }, success: { bg: '#ebfbee', border: '#40c057', badge: '#40c057' }, info: { bg: '#e7f5ff', border: '#228be6', badge: '#228be6' } };
    const insightHtml = insights.map(ins => {
        const c = insightColors[ins.type];
        return `<div style="padding:10px 14px;margin-bottom:8px;border-radius:8px;background:${c.bg};font-size:12px;border-left:3px solid ${c.border}">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;margin-right:8px;color:#fff;background:${c.badge}">${esc(ins.badge)}</span>${esc(ins.text)}
        </div>`;
    }).join('');

    // 위험 요인 상세 목록
    const factorList = (items, title, titleColor, borderColor, bgColor, valColor) => {
        if (!items.length) return '';
        const rows = items.map((f, i) => `<div style="padding:2px 0;color:#495057;display:flex;gap:4px">
            <span style="color:#868e96;min-width:16px">${i+1}.</span><span>${esc(f.label)}</span>
            <span style="margin-left:auto;font-weight:600;color:${valColor}">${f.value > 0 ? '+' : ''}${(f.value*100).toFixed(2)}%p</span>
        </div>`).join('');
        return `<div style="padding:12px 14px;margin-top:10px;background:${bgColor};border-radius:8px;font-size:12px;border-left:3px solid ${borderColor}">
            <div style="font-weight:700;margin-bottom:8px;color:${titleColor}">${esc(title)}</div>${rows}
        </div>`;
    };

    const body = `
    <div style="width:800px;margin:0 auto;background:#fff;padding:40px;font-family:'NanumGothic','Malgun Gothic',sans-serif">
        <!-- 헤더 -->
        <div style="text-align:center;margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #228be6">
            <h1 style="font-size:24px;font-weight:800;margin:0;color:#212529">사고 위험도 정밀 진단 보고서</h1>
            <p style="color:#868e96;font-size:12px;margin-top:8px;margin-bottom:0">생성일시: ${new Date().toLocaleString('ko-KR')}</p>
        </div>

        <!-- 프로필 -->
        <div style="margin-bottom:24px">
            ${sectionTitle('운전자 정보')}
            <table style="width:100%;font-size:13px;border-collapse:collapse">
                <tr style="background:#f8f9fa">
                    <td style="padding:8px 12px;color:#868e96;width:15%;font-weight:500">이름</td>
                    <td style="padding:8px 12px;font-weight:600;width:35%">${esc(driver.masked_name || '-')}</td>
                    <td style="padding:8px 12px;color:#868e96;width:15%;font-weight:500">생년월일</td>
                    <td style="padding:8px 12px;font-weight:600;width:35%">${driver.masked_dob ? esc(String(driver.masked_dob).substring(0,4))+'년 **월 **일' : '-'}</td>
                </tr>
                <tr>
                    <td style="padding:8px 12px;color:#868e96;font-weight:500">성별</td>
                    <td style="padding:8px 12px;font-weight:600">${esc(driver.gender || '-')}</td>
                    <td style="padding:8px 12px;color:#868e96;font-weight:500">검사일자</td>
                    <td style="padding:8px 12px;font-weight:600">${fmtDate(driver.TestDate)}</td>
                </tr>
                <tr style="background:#f8f9fa">
                    <td style="padding:8px 12px;color:#868e96;font-weight:500">연령</td>
                    <td style="padding:8px 12px;font-weight:600">${driver.current_age ? driver.current_age+'세' : '-'}${driver.exam_age && driver.exam_age !== driver.current_age ? ' (수검 당시 '+driver.exam_age+'세)' : ''}</td>
                    <td style="padding:8px 12px;color:#868e96;font-weight:500">검사유형</td>
                    <td style="padding:8px 12px;font-weight:600">${driver.domain === 'A' ? '신규 검사' : '자격유지 검사'}</td>
                </tr>
                <tr>
                    <td style="padding:8px 12px;color:#868e96;font-weight:500">업종</td>
                    <td colspan="3" style="padding:8px 12px;font-weight:600">${driver.industry ? esc(driver.industry)+' ('+esc(driver.industry_detail || '-')+')' : '-'}</td>
                </tr>
            </table>
        </div>

        <!-- 종합 위험도 -->
        <div style="margin-bottom:28px;text-align:center;padding:24px;background:${riskBg};border-radius:12px;border:2px solid ${riskBorder}">
            <div style="font-size:42px;font-weight:800;color:${riskColor};letter-spacing:-1px">${(score*100).toFixed(1)}%</div>
            <div style="font-size:16px;font-weight:700;color:#495057;margin-top:6px">종합 사고 위험도 — ${getRiskLevel(score)}</div>
        </div>

        <!-- AI 분석 요약 -->
        <div style="margin-bottom:24px">
            ${sectionTitle('AI 분석 요약 (검사별 사고 위험 영향도)')}
            ${shapTableHtml(catInc, catMax, '위험 증가 요인', '#c92a2a', '검사 카테고리')}
            ${shapTableHtml(catDec, catMax, '위험 감소 요인', '#1864ab', '검사 카테고리')}
        </div>

        <!-- AI 분석 상세 -->
        ${testFeatures.length > 0 ? `<div style="margin-bottom:24px">
            ${sectionTitle('AI 분석 상세 (개별 검사 항목)')}
            ${shapTableHtml(featInc, featMax, '위험 증가 항목', '#c92a2a', '검사 항목', 11)}
            ${shapTableHtml(featDec, featMax, '위험 감소 항목', '#1864ab', '검사 항목', 11)}
        </div>` : ''}

        <!-- 주요 발견 사항 -->
        <div style="margin-bottom:24px">
            ${sectionTitle('주요 발견 사항')}
            ${insightHtml}
            ${factorList(catInc, '위험 증가 요인 상세', '#c92a2a', '#fa5252', '#fff5f5', '#fa5252')}
            ${factorList(catDec, '위험 감소 요인 상세', '#1864ab', '#228be6', '#e7f5ff', '#228be6')}
            <div style="padding:12px 14px;margin-top:12px;background:#f8f9fa;border-radius:8px;font-size:12px;color:#495057;line-height:1.7;border-left:3px solid #495057">
                <div style="font-weight:700;margin-bottom:6px;color:#212529">종합 해석</div>
                해당 운전자의 사고 위험도는 ${(score*100).toFixed(1)}%이며,
                총 ${catInc.length}개의 검사 카테고리가 사고 위험도를 높이고 ${catDec.length}개의 검사 카테고리가 사고 위험도를 낮추고 있습니다.${catInc.length > 0 ? ` 가장 주의가 필요한 영역은 "${catInc[0].label}"입니다.` : ''}${catDec.length > 0 ? ` "${catDec[0].label}"는 긍정적 영향을 미치고 있습니다.` : ''}
            </div>
        </div>

        <div style="text-align:center;font-size:10px;color:#adb5bd;margin-top:30px;border-top:1px solid #dee2e6;padding-top:10px">
            본 보고서는 AI 분석 결과를 기반으로 자동 생성되었으며, 참고 자료로만 활용하시기 바랍니다.
        </div>
    </div>`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>진단보고서 - ${esc(driver.masked_name || '')}</title>
<style>
@font-face{font-family:'NanumGothic';font-weight:400;font-style:normal;src:url('fonts/NanumGothic-Regular.ttf') format('truetype');}
@font-face{font-family:'NanumGothic';font-weight:700;font-style:normal;src:url('fonts/NanumGothic-Bold.ttf') format('truetype');}
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f8f9fa;font-family:'NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif}
@media print{body{background:#fff}}
</style>
</head>
<body>${body}</body>
</html>`;
}
