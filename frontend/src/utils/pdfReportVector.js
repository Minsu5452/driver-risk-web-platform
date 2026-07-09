// 진단 보고서 → 벡터 PDF (jsPDF 프리미티브). html2canvas 래스터화 대비 매우 빠르고
// 글자가 선명하며 파일이 작다. buildReportHtml / DiagnosisReport.jsx 와 동일한 구조·색상·문구.
import { jsPDF } from 'jspdf';
import { FEATURE_MAPPINGS, aggregateShapByCategory } from '@/pages/risk/featureMappings';
import { RISK_THRESHOLDS, getRiskLevel } from '@/constants/risk';

// ── 색상 (hex → [r,g,b]) ──
const C = {
  text: [33, 37, 41],       // #212529
  body: [73, 80, 87],       // #495057
  dim: [134, 142, 150],     // #868e96
  faint: [173, 181, 189],   // #adb5bd
  blue: [34, 139, 230],     // #228be6
  rule: [233, 236, 239],    // #e9ecef
  rowAlt: [248, 249, 250],  // #f8f9fa
  thBg: [241, 243, 245],    // #f1f3f5
  red: [250, 82, 82],       // #fa5252
  redText: [201, 42, 42],   // #c92a2a
  blueText: [24, 100, 171], // #1864ab
  barPos: [255, 168, 168],  // #ffa8a8
  barNeg: [165, 216, 255],  // #a5d8ff
  valPos: [250, 82, 82],    // #fa5252
  valNeg: [34, 139, 230],   // #228be6
};

const riskPalette = (score) => {
  if (score >= RISK_THRESHOLDS.HIGH)
    return { color: [250, 82, 82], bg: [255, 245, 245], border: [255, 201, 201] };
  if (score >= RISK_THRESHOLDS.MEDIUM)
    return { color: [253, 126, 20], bg: [255, 249, 219], border: [255, 236, 153] };
  return { color: [64, 192, 87], bg: [235, 251, 238], border: [178, 242, 187] };
};

const insightPalette = {
  danger: { bg: [255, 245, 245], border: [250, 82, 82] },
  warning: { bg: [255, 249, 219], border: [253, 126, 20] },
  success: { bg: [235, 251, 238], border: [64, 192, 87] },
  info: { bg: [231, 245, 255], border: [34, 139, 230] },
};

const fmtDate = (d) => {
  if (!d) return '-';
  const s = String(d).replace(/[^0-9]/g, '');
  if (s.length >= 8) return `${s.substring(0, 4)}년 ${s.substring(4, 6)}월 ${s.substring(6, 8)}일`;
  return String(d);
};

// A4
const PAGE_W = 210, PAGE_H = 297, M = 15, CW = PAGE_W - M * 2;

/** 단일 운전자 → jsPDF 문서. history(선택): [{testDate, score, riskGroup}] */
function buildDoc(driver, shapValues, fonts, history) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
  // 나눔고딕 등록 (fonts: { regular, bold } base64 — pdfFonts.loadNanumFonts() 결과)
  doc.addFileToVFS('NanumGothic-Regular.ttf', fonts.regular);
  doc.addFont('NanumGothic-Regular.ttf', 'Nanum', 'normal');
  doc.addFileToVFS('NanumGothic-Bold.ttf', fonts.bold);
  doc.addFont('NanumGothic-Bold.ttf', 'Nanum', 'bold');
  doc.setFont('Nanum', 'normal');

  let y = M;
  const bottom = PAGE_H - M;

  // 페이지 잔여공간 확보 (필요 시 새 페이지)
  const ensure = (h) => {
    if (y + h > bottom) { doc.addPage(); y = M; }
  };
  const setText = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setFill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const font = (style, size) => { doc.setFont('Nanum', style); doc.setFontSize(size); };

  const score = driver?.result || 0;
  const riskLevel = score >= RISK_THRESHOLDS.HIGH ? '고' : score >= RISK_THRESHOLDS.MEDIUM ? '중' : '저';

  // ── 1. 헤더 ──
  font('bold', 20); setText(C.text);
  doc.text('사고 위험도 정밀 진단 보고서', PAGE_W / 2, y + 6, { align: 'center' });
  y += 11;
  font('normal', 9); setText(C.dim);
  doc.text(`생성일시: ${new Date().toLocaleString('ko-KR')}`, PAGE_W / 2, y, { align: 'center' });
  y += 3;
  setDraw(C.blue); doc.setLineWidth(0.8); doc.line(M, y, PAGE_W - M, y);
  doc.setLineWidth(0.2);
  y += 8;

  // ── 섹션 타이틀 ──
  const sectionTitle = (text) => {
    ensure(12);
    setFill(C.blue); doc.rect(M, y - 3.5, 1.3, 5.5, 'F'); // 좌측 파란 바
    font('bold', 12); setText(C.text);
    doc.text(text, M + 3.5, y + 1);
    y += 4;
    setDraw(C.rule); doc.line(M, y, PAGE_W - M, y);
    y += 5;
  };

  // ── 2. 운전자 정보 ──
  sectionTitle('운전자 정보');
  {
    const rowH = 8;
    const c1 = M, c2 = M + 27, c3 = M + 90, c4 = M + 117; // label/value/label/value x
    const dobStr = driver.masked_dob ? `${String(driver.masked_dob).substring(0, 4)}년 **월 **일` : '-';
    const ageStr = driver.current_age
      ? `${driver.current_age}세${driver.exam_age && driver.exam_age !== driver.current_age ? ` (수검 당시 ${driver.exam_age}세)` : ''}`
      : '-';
    const rows = [
      ['이름', driver.masked_name || '-', '생년월일', dobStr],
      ['성별', driver.gender || '-', '검사일자', fmtDate(driver.TestDate)],
      ['연령', ageStr, '검사유형', driver.domain === 'A' ? '신규 검사' : '자격유지 검사'],
    ];
    rows.forEach((r, i) => {
      ensure(rowH);
      if (i % 2 === 0) { setFill(C.rowAlt); doc.rect(M, y - 4, CW, rowH, 'F'); }
      font('normal', 9.5); setText(C.dim); doc.text(r[0], c1 + 2, y + 1);
      font('bold', 9.5); setText(C.text); doc.text(String(r[1]), c2 + 2, y + 1);
      font('normal', 9.5); setText(C.dim); doc.text(r[2], c3 + 2, y + 1);
      font('bold', 9.5); setText(C.text); doc.text(String(r[3]), c4 + 2, y + 1);
      y += rowH;
    });
    // 업종 행 (전체 폭) — 줄무늬상 4번째 행이므로 배경 없음(HTML 보고서와 동일)
    ensure(rowH);
    font('normal', 9.5); setText(C.dim); doc.text('업종', c1 + 2, y + 1);
    const ind = driver.industry ? `${driver.industry} (${driver.industry_detail || '-'})` : '-';
    font('bold', 9.5); setText(C.text); doc.text(String(ind), c2 + 2, y + 1);
    y += rowH + 4;
  }

  // ── 3. 종합 위험도 ──
  {
    const boxH = 26;
    ensure(boxH + 4);
    const p = riskPalette(score);
    setFill(p.bg); setDraw(p.border); doc.setLineWidth(0.5);
    doc.roundedRect(M, y, CW, boxH, 3, 3, 'FD');
    doc.setLineWidth(0.2);
    font('bold', 26); setText(p.color);
    doc.text(driver.result != null ? `${(score * 100).toFixed(1)}%` : '-', PAGE_W / 2, y + 13, { align: 'center' });
    font('bold', 12); setText(C.body);
    doc.text(`종합 사고 위험도 — ${getRiskLevel(score)}`, PAGE_W / 2, y + 21, { align: 'center' });
    y += boxH + 8;
  }

  // ── 4. 검사 이력 (있을 때만 — 단건 진단에서 전달) ──
  if (Array.isArray(history) && history.length > 0) {
    sectionTitle('검사 이력');
    const rowH = 7;
    const mid1 = M + CW * 0.2, mid2 = M + CW * 0.55, mid3 = M + CW * 0.85; // 일자/위험도/등급 중앙 정렬 기준
    // 헤더 (어두운 배경 + 흰 글씨)
    ensure(rowH);
    setFill([52, 58, 64]); doc.rect(M, y - 3.5, CW, rowH, 'F');
    font('bold', 9.5); setText([255, 255, 255]);
    doc.text('일자', mid1, y + 1, { align: 'center' });
    doc.text('사고 위험도', mid2, y + 1, { align: 'center' });
    doc.text('등급', mid3, y + 1, { align: 'center' });
    y += rowH;
    history.forEach((h, i) => {
      ensure(rowH);
      if (i % 2 === 1) { setFill(C.rowAlt); doc.rect(M, y - 3.5, CW, rowH, 'F'); }
      font('normal', 9.5); setText(C.body);
      doc.text(String(h.testDate || '-'), mid1, y + 1, { align: 'center' });
      doc.text(h.score != null ? `${(h.score * 100).toFixed(1)}%` : '-', mid2, y + 1, { align: 'center' });
      const rg = h.riskGroup || '-';
      const rgColor = rg.includes('고위험') ? C.red : rg.includes('중위험') ? [253, 126, 20] : [64, 192, 87];
      font('bold', 9.5); setText(rgColor);
      doc.text(rg, mid3, y + 1, { align: 'center' });
      y += rowH;
    });
    y += 4;
  }

  // ── SHAP 데이터 가공 (htmlExport와 동일) ──
  const aggregated = aggregateShapByCategory(shapValues || []);
  const catInc = aggregated.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const catDec = aggregated.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
  const catMax = Math.max(...[...catInc, ...catDec].map(d => Math.abs(d.value)), 0.0001);

  const testFeatures = (shapValues || [])
    .filter(({ feature }) => /^[AB]\d+/.test(feature) && FEATURE_MAPPINGS[feature])
    .map(({ feature, value }) => ({ label: FEATURE_MAPPINGS[feature], value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const featInc = testFeatures.filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const featDec = testFeatures.filter(d => d.value < 0).sort((a, b) => a.value - b.value);
  const featMax = testFeatures.length > 0 ? Math.max(...testFeatures.map(d => Math.abs(d.value)), 0.0001) : 1;

  // ── SHAP 막대 표 (shapTableHtml 대응) ──
  const drawShapTable = (items, maxVal, title, titleColor, thLabel, fontSize) => {
    if (!items.length) return;
    const labelW = CW * 0.35;
    const barX = M + labelW + 2;
    const barAreaW = CW - labelW - 2;
    const valW = 22;            // 값 텍스트 폭
    const trackW = barAreaW - valW - 2;
    const rowH = fontSize >= 12 ? 7 : 6;

    // 소제목 — 소제목·헤더·첫 행이 페이지 경계에서 분리(고아)되지 않도록 함께 확보
    ensure(6.5 + rowH * 2);
    font('bold', fontSize + 1); setText(titleColor);
    doc.text(`${title} (${items.length}개)`, M, y + 1);
    y += 6.5; // 소제목 디센더(괄호)가 아래 회색 헤더 막대와 겹치지 않도록 여백 확보

    // 헤더
    ensure(rowH);
    setFill(C.thBg); doc.rect(M, y - 3.5, CW, rowH, 'F');
    font('normal', fontSize - 1); setText(C.body);
    doc.text(thLabel, M + 2, y + 1);
    doc.text('사고 위험 영향도', PAGE_W - M - 2, y + 1, { align: 'right' });
    y += rowH;

    items.forEach((it, i) => {
      ensure(rowH);
      if (i % 2 === 1) { setFill(C.rowAlt); doc.rect(M, y - 3.5, CW, rowH, 'F'); }
      // 라벨 (길면 잘림 방지: 폭에 맞게 자름)
      font('normal', fontSize); setText(C.text);
      const label = doc.splitTextToSize(String(it.label), labelW - 2)[0];
      doc.text(label, M + 2, y + 1);
      // 막대
      const barW = Math.max((Math.abs(it.value) / maxVal) * trackW, 0.8);
      setFill(it.value > 0 ? C.barPos : C.barNeg);
      doc.roundedRect(barX, y - 2.2, barW, 2.6, 0.6, 0.6, 'F');
      // 값
      font('bold', fontSize); setText(it.value > 0 ? C.valPos : C.valNeg);
      const sign = it.value > 0 ? '+' : '';
      doc.text(`${sign}${(it.value * 100).toFixed(2)}%p`, PAGE_W - M - 2, y + 1, { align: 'right' });
      y += rowH;
    });
    y += 3;
  };

  // ── 4. AI 분석 요약 ──
  sectionTitle('AI 분석 요약 (검사별 사고 위험 영향도)');
  if (catInc.length || catDec.length) {
    drawShapTable(catInc, catMax, '위험 증가 요인', C.redText, '검사 카테고리', 11);
    drawShapTable(catDec, catMax, '위험 감소 요인', C.blueText, '검사 카테고리', 11);
  } else {
    font('normal', 10); setText(C.dim); doc.text('분석 가능한 데이터가 없습니다.', M, y); y += 6;
  }

  // ── 5. AI 분석 상세 ──
  if (testFeatures.length > 0) {
    sectionTitle('AI 분석 상세 (개별 검사 항목)');
    drawShapTable(featInc, featMax, '위험 증가 항목', C.redText, '검사 항목', 10);
    drawShapTable(featDec, featMax, '위험 감소 항목', C.blueText, '검사 항목', 10);
  }

  // ── 6. 주요 발견 사항 ──
  sectionTitle('주요 발견 사항');
  {
    const insights = [];
    insights.push({
      type: riskLevel === '고' ? 'danger' : riskLevel === '중' ? 'warning' : 'success',
      badge: '사고 위험도 해석',
      text: `종합 사고 위험도 ${(score * 100).toFixed(1)}%로 ${riskLevel}위험군에 해당합니다.`,
    });
    if (catInc.length > 0)
      insights.push({ type: 'danger', badge: '주요 위험 요인', text: `${catInc[0].label} 결과가 사고 위험도를 가장 크게 높이고 있습니다. (사고 위험 영향도: +${(catInc[0].value * 100).toFixed(2)}%p)` });
    if (catDec.length > 0)
      insights.push({ type: 'info', badge: '주요 감소 요인', text: `${catDec[0].label} 결과가 사고 위험도를 낮추는 데 기여하고 있습니다. (사고 위험 영향도: ${(catDec[0].value * 100).toFixed(2)}%p)` });

    insights.forEach((ins) => {
      const pal = insightPalette[ins.type];
      const fullText = `[${ins.badge}] ${ins.text}`;
      font('normal', 9.5);
      const lines = doc.splitTextToSize(fullText, CW - 8);
      const boxH = lines.length * 4.6 + 4;
      ensure(boxH + 2);
      setFill(pal.bg); doc.rect(M, y, CW, boxH, 'F');
      setFill(pal.border); doc.rect(M, y, 1.2, boxH, 'F'); // 좌측 보더
      setText(C.body);
      doc.text(lines, M + 4, y + 5);
      y += boxH + 2;
    });

    // 요인 상세 목록
    const factorList = (items, title, titleColor, borderColor, bgColor, valColor) => {
      if (!items.length) return;
      font('normal', 9.5);
      const lineH = 4.6;
      const headH = 6;
      const boxH = headH + items.length * lineH + 4;
      ensure(boxH + 2);
      setFill(bgColor); doc.rect(M, y, CW, boxH, 'F');
      setFill(borderColor); doc.rect(M, y, 1.2, boxH, 'F');
      font('bold', 9.5); setText(titleColor);
      doc.text(title, M + 4, y + 5);
      let yy = y + 5 + headH - 1;
      items.forEach((f, i) => {
        font('normal', 9.5); setText(C.body);
        doc.text(`${i + 1}. ${f.label}`, M + 4, yy);
        font('bold', 9.5); setText(valColor);
        doc.text(`${f.value > 0 ? '+' : ''}${(f.value * 100).toFixed(2)}%p`, PAGE_W - M - 3, yy, { align: 'right' });
        yy += lineH;
      });
      y += boxH + 2;
    };
    factorList(catInc, '위험 증가 요인 상세', C.redText, C.red, [255, 245, 245], C.valPos);
    factorList(catDec, '위험 감소 요인 상세', C.blueText, C.blue, [231, 245, 255], C.valNeg);

    // 종합 해석
    {
      const txt = `해당 운전자의 사고 위험도는 ${(score * 100).toFixed(1)}%이며, 총 ${catInc.length}개의 검사 카테고리가 사고 위험도를 높이고 ${catDec.length}개의 검사 카테고리가 사고 위험도를 낮추고 있습니다.`
        + (catInc.length > 0 ? ` 가장 주의가 필요한 영역은 "${catInc[0].label}"입니다.` : '')
        + (catDec.length > 0 ? ` "${catDec[0].label}"는 긍정적 영향을 미치고 있습니다.` : '');
      font('normal', 9.5);
      const lines = doc.splitTextToSize(txt, CW - 8);
      const boxH = 6 + lines.length * 4.6 + 4;
      ensure(boxH + 2);
      setFill(C.rowAlt); doc.rect(M, y, CW, boxH, 'F');
      setFill(C.body); doc.rect(M, y, 1.2, boxH, 'F');
      font('bold', 9.5); setText(C.text); doc.text('종합 해석', M + 4, y + 5);
      font('normal', 9.5); setText(C.body); doc.text(lines, M + 4, y + 10);
      y += boxH + 2;
    }
  }

  // ── 7. 푸터 (마지막 페이지 하단) ──
  font('normal', 8); setText(C.faint);
  doc.text('본 보고서는 AI 분석 결과를 기반으로 자동 생성되었으며, 참고 자료로만 활용하시기 바랍니다.',
    PAGE_W / 2, PAGE_H - 8, { align: 'center' });

  return doc;
}

/** 단일 운전자 → PDF ArrayBuffer (ZIP 적재용). history는 선택(단건 진단용). */
export function driverToPdfBufferVector(driver, shapValues, fonts, history) {
  return buildDoc(driver, shapValues, fonts, history).output('arraybuffer');
}

/** 단일 운전자 → 즉시 저장(단건 진단 다운로드용). */
export function saveDriverPdfVector(driver, shapValues, fonts, filename, history) {
  buildDoc(driver, shapValues, fonts, history).save(filename);
}

export default driverToPdfBufferVector;
