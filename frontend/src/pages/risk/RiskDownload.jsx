import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container, Title, Text, Group, Stack, Table, Button, Paper,
  Box, Chip, Progress, Divider, Pagination, Center, NumberInput,
} from "@mantine/core";
import UrlConstants from "@/constants/url";
import { RISK_THRESHOLDS, getRiskLevel } from "@/constants/risk";
import useAnalysisStore from "@/store/useAnalysisStore";
import riskClient from "@/api/riskClient";
import { buildReportHtml } from "@/utils/htmlExport";
// PDF(벡터)·폰트 생성기는 PDF 선택 시에만 동적 import (초기 번들 경량화)

const formatDate = (raw) => {
  const s = String(raw || "").trim().replace(/\.0$/, "");
  const parts = s.split(/[.\-\/]/);
  if (parts.length === 3 && parts[0].length === 4) {
    const [y, m, d] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length >= 8)
    return `${digits.substring(0,4)}-${digits.substring(4,6)}-${digits.substring(6,8)}`;
  return s || "-";
};

const RiskDownload = () => {
  const navigate = useNavigate();
  const { isUploaded, analysisResults, setDownloading: setStoreDownloading } = useAnalysisStore();

  // 칩 필터 (각 카테고리별 선택된 값 배열)
  const [selRisk, setSelRisk] = useState([]);
  const [selDomain, setSelDomain] = useState([]);
  const [selGender, setSelGender] = useState([]);
  const [selAge, setSelAge] = useState([]);
  const [selBranch, setSelBranch] = useState([]);
  const [selIndustry, setSelIndustry] = useState([]);

  // 다운로드 형식
  const [wantCsv, setWantCsv] = useState(false);
  const [wantPdf, setWantPdf] = useState(false);
  const [wantHtml, setWantHtml] = useState(false);

  // 진행률 (형식별)
  const [downloading, setDownloading] = useState(false);
  const [progressMap, setProgressMap] = useState({});  // { csv: {done,label}, shap: {...}, html: {...}, pdf: {...} }

  // 다운로드 중 브라우저 닫기/새로고침 경고
  useEffect(() => {
    if (!downloading) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [downloading]);


  // 페이지네이션
  const PAGESIZE = 10;
  const [page, setPage] = useState(1);
  const [inputPage, setInputPage] = useState("");

  // ── PrimaryKey 기반 사람 단위 그룹핑 ──
  const personData = useMemo(() => {
    if (!analysisResults) return [];
    const byPK = {};
    for (const r of analysisResults) {
      const pk = r.PrimaryKey;
      if (!pk) continue;
      if (!byPK[pk] || String(r.TestDate || '') > String(byPK[pk].TestDate || ''))
        byPK[pk] = r;
    }
    return Object.values(byPK);
  }, [analysisResults]);

  // ── 각 카테고리 옵션 (데이터에서 추출) ──
  const chipOptions = useMemo(() => {
    if (!personData.length) return { risk: [], domain: [], gender: [], age: [], branch: [], industry: [] };

    const riskOrder = ['고위험', '중위험', '저위험'];
    const riskSet = new Set(personData.map(d => getRiskLevel(d.result || 0)));

    const domainLabels = { A: '신규검사', B: '자격유지검사' };
    const domains = Array.from(new Set(personData.map(d => d.domain).filter(Boolean))).sort();

    const genders = Array.from(new Set(personData.map(d => String(d.Gender || d.gender || '')).filter(Boolean))).sort();
    const branches = Array.from(new Set(personData.map(d => String(d.Branch || d.branch || '')).filter(Boolean))).sort();
    const industries = Array.from(new Set(personData.map(d => String(d.Industry || d.industry || '')).filter(Boolean))).sort();

    // 연령대
    const decadeSet = new Set();
    personData.forEach(d => {
      const age = parseInt(d.current_age, 10);
      if (age && !isNaN(age)) decadeSet.add(Math.floor(age / 10) * 10);
    });
    const ages = Array.from(decadeSet).sort((a, b) => a - b);

    return {
      risk: riskOrder.filter(r => riskSet.has(r)).map(r => ({ value: r, label: r })),
      domain: domains.map(d => ({ value: d, label: domainLabels[d] || d })),
      gender: genders.map(g => ({ value: g, label: g })),
      age: ages.map(a => ({ value: String(a), label: `${a}대` })),
      branch: branches.map(b => ({ value: b, label: b })),
      industry: industries.map(i => ({ value: i, label: i })),
    };
  }, [personData]);

  // ── 필터 적용 ──
  const filteredData = useMemo(() => {
    let items = personData;

    if (selRisk.length > 0)
      items = items.filter(d => selRisk.includes(getRiskLevel(d.result || 0)));
    if (selDomain.length > 0)
      items = items.filter(d => selDomain.includes(d.domain));
    if (selGender.length > 0)
      items = items.filter(d => selGender.includes(String(d.Gender || d.gender || '')));
    if (selAge.length > 0)
      items = items.filter(d => {
        const age = parseInt(d.current_age, 10);
        return age && selAge.includes(String(Math.floor(age / 10) * 10));
      });
    if (selBranch.length > 0)
      items = items.filter(d => selBranch.includes(String(d.Branch || d.branch || '')));
    if (selIndustry.length > 0)
      items = items.filter(d => selIndustry.includes(String(d.Industry || d.industry || '')));

    return items;
  }, [personData, selRisk, selDomain, selGender, selAge, selBranch, selIndustry]);

  const totalPages = Math.ceil(filteredData.length / PAGESIZE);
  const paginatedData = filteredData.slice((page - 1) * PAGESIZE, page * PAGESIZE);

  // 필터 변경 시 페이지 리셋 — Chip.Group onChange에서 호출
  const withReset = (setter) => (val) => { setter(val); setPage(1); };

  const handlePageJump = () => {
    const num = typeof inputPage === "number" ? inputPage : parseInt(inputPage, 10);
    if (num >= 1 && num <= totalPages) { setPage(num); setInputPage(""); }
  };

  const hasAnyFilter = selRisk.length + selDomain.length + selGender.length + selAge.length + selBranch.length + selIndustry.length > 0;
  const clearAllFilters = () => {
    setSelRisk([]); setSelDomain([]); setSelGender([]); setSelAge([]); setSelBranch([]); setSelIndustry([]);
    setPage(1);
  };

  // ── CSV 생성 ──
  const buildCsvBlob = useCallback((data) => {
    const headers = ["이름","주민번호","성별","검사일자","연령","지역본부","업종","검사유형","사고 위험도","위험등급"];
    const rows = data.map(item => {
      const date = formatDate(item.TestDate);
      const row = [
        item.masked_name, item.masked_rrn || item.masked_dob, item.gender,
        null, item.current_age ? `${item.current_age}세` : "", item.branch,
        item.industry, item.domain === "A" ? "신규 검사" : "자격유지 검사",
        item.result != null ? `${(item.result * 100).toFixed(1)}%` : "", item.riskGroup,
      ];
      const cells = row.map(s => `"${String(s || '').replace(/"/g, '""')}"`);
      cells[3] = date === "-" ? `"-"` : `"=""${date}"""`;
      return cells.join(",");
    });
    const content = [headers.join(","), ...rows].join("\n");
    return new Blob(["\uFEFF" + content], { type: 'text/csv;charset=utf-8;' });
  }, []);

  // ── 다운로드 실행 ──
  const handleDownload = useCallback(async () => {
    if (!filteredData.length) { alert("다운로드할 데이터가 없습니다."); return; }
    if (!wantCsv && !wantPdf && !wantHtml) { alert("형식을 1개 이상 선택해주세요."); return; }

    const EXPLAIN_CHUNK = 50;

    setDownloading(true);
    setStoreDownloading(true);
    const total = filteredData.length;

    // 초기 상태를 한 번에 설정 (이전 다운로드 잔여값 제거)
    const initProgress = {};
    if (wantCsv) initProgress.csv = { current: 0, total, done: false, error: null };
    if (wantHtml || wantPdf) initProgress.shap = { current: 0, total, done: false, error: null };
    if (wantHtml) initProgress.html = { current: 0, total, done: false, error: null };
    if (wantPdf) initProgress.pdf = { current: 0, total, done: false, error: null };
    setProgressMap(initProgress);

    const setP = (key, current, tot, done = false, error = null) =>
      setProgressMap(prev => ({ ...prev, [key]: { current, total: tot, done, error } }));

    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const downloadFile = (blob, name) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      };

      // CSV
      if (wantCsv) {
        try {
          downloadFile(buildCsvBlob(filteredData), `운전자목록_${dateStr}.csv`);
          setP('csv', total, total, true);
        } catch (e) {
          setP('csv', 0, total, true, e.message);
        }
      }

      // HTML/PDF는 SHAP 분석이 필요
      if (wantPdf || wantHtml) {
        const JSZip = (await import('jszip')).default;

        // SHAP 분석 (청크) — HTML/PDF 바 모두 같이 진행
        // 1차: test_ids만 전송 → 서버 캐시(업로드 시 사전계산) 조회. 재계산 없이 즉시.
        // 2차 fallback: 캐시 미스분만 features 직접 전송(실제 Age). 서버 재시작 등으로
        //   캐시/analysis_cache가 비었을 때만 동작. (Age는 코드 문자열 그대로 — Number()로 0 만들지 않음)
        const allShapMap = {};
        let explainDone = 0;
        for (let i = 0; i < total; i += EXPLAIN_CHUNK) {
          const chunk = filteredData.slice(i, i + EXPLAIN_CHUNK);

          // 1차: 캐시 조회
          try {
            const testIds = chunk.map(d => d.Test_id).filter(Boolean);
            if (testIds.length > 0) {
              const res = await riskClient.post('/analysis/explain/batch_by_ids', { test_ids: testIds });
              for (const r of (res.data?.results || []))
                allShapMap[r.PrimaryKey] = r.shap_values;
            }
          } catch {
            // 캐시 엔드포인트 실패 → 아래 fallback이 전량 처리
          }

          // 2차 fallback: 아직 SHAP을 못 받은 인원만 features 직접 계산
          const missed = chunk.filter(d => d.PrimaryKey && !allShapMap[d.PrimaryKey]);
          if (missed.length > 0) {
            const inputs = missed.map(d => ({
              Test_id: d.Test_id, TestDate: d.TestDate || "20230101",
              Age: String(d.Age ?? ""), PrimaryKey: d.PrimaryKey || "UNKNOWN",
              domain: d.domain || "A", features: d.features || {},
            }));
            const res2 = await riskClient.post('/analysis/explain/batch', inputs);
            for (const r of (res2.data?.results || []))
              allShapMap[r.PrimaryKey] = r.shap_values;
          }

          explainDone += chunk.length;
          setP('shap', explainDone, total);
        }
        setP('shap', total, total, true);

        const driversWithShap = filteredData.filter(d => allShapMap[d.PrimaryKey]);
        const mkFileName = (d) => {
          const name = (d.masked_name || 'driver').replace(/\*/g, '○');
          const dobYear = String(d.masked_dob || '').substring(0, 4);
          return `진단보고서_${dobYear}년생_${name}_${d.TestDate || ''}`;
        };

        // HTML 생성 — 보고서는 나눔고딕(PDF와 통일). 폰트는 zip에 1회만 포함하고
        // 각 HTML은 상대경로(fonts/…)로 참조한다. 로드 실패 시 시스템 폰트로 폴백.
        if (wantHtml) {
          try {
            const { loadNanumFonts } = await import('@/utils/pdfFonts');
            const fonts = await loadNanumFonts();
            const htmlZip = new JSZip();
            htmlZip.file('fonts/NanumGothic-Regular.ttf', fonts.regular, { base64: true });
            htmlZip.file('fonts/NanumGothic-Bold.ttf', fonts.bold, { base64: true });
            driversWithShap.forEach(d => {
              htmlZip.file(`${mkFileName(d)}.html`, buildReportHtml(d, allShapMap[d.PrimaryKey]));
            });
            const blob = await htmlZip.generateAsync({ type: 'blob' });
            downloadFile(blob, `진단보고서_HTML_${dateStr}.zip`);
            setP('html', driversWithShap.length, driversWithShap.length, true);
          } catch (e) {
            setP('html', 0, total, true, e.message);
          }
        }

        // PDF 생성 (벡터 — jsPDF 직접 그리기. html2canvas/숨은 DOM 렌더 미사용)
        // 글자가 선명하고 파일이 작으며, 대기시간(600ms/배치)·캡처 비용이 없어 매우 빠르다.
        if (wantPdf) {
          try {
            const [{ loadNanumFonts }, { driverToPdfBufferVector }] = await Promise.all([
              import('@/utils/pdfFonts'),
              import('@/utils/pdfReportVector'),
            ]);
            const fonts = await loadNanumFonts();
            const pdfZip = new JSZip();
            let pdfCount = 0;
            for (const d of driversWithShap) {
              const buf = driverToPdfBufferVector(d, allShapMap[d.PrimaryKey], fonts);
              pdfZip.file(`${mkFileName(d)}.pdf`, buf);
              pdfCount++;
              setP('pdf', pdfCount, driversWithShap.length);
              // 대량 시 UI 블로킹 방지: 25건마다 한 틱 양보
              if (pdfCount % 25 === 0) await new Promise(r => setTimeout(r, 0));
            }
            const blob = await pdfZip.generateAsync({ type: 'blob' });
            downloadFile(blob, `진단보고서_PDF_${dateStr}.zip`);
            setP('pdf', driversWithShap.length, driversWithShap.length, true);
          } catch (e) {
            setP('pdf', 0, total, true, e.message);
          }
        }
      }
    } catch (e) {
      alert(`다운로드 오류: ${e.response?.data?.detail || e.message}`);
    } finally {
      setDownloading(false);
      setStoreDownloading(false);
    }
  }, [filteredData, wantCsv, wantPdf, wantHtml, buildCsvBlob]);

  const getRiskBadge = (riskGroup) => {
    let color = "#868e96", bg = "#f1f3f5";
    const label = riskGroup || "-";
    if (label.includes("고위험")) { color = "#e03131"; bg = "#fff5f5"; }
    else if (label.includes("중위험")) { color = "#e8590c"; bg = "#fff4e6"; }
    else if (label.includes("저위험")) { color = "#2f9e44"; bg = "#ebfbee"; }
    return (
      <Group gap={6} wrap="nowrap" style={{ background: bg, borderRadius: 20, padding: "4px 12px 4px 8px", display: "inline-flex", width: "fit-content" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <Text size="xs" fw={600} style={{ color, whiteSpace: "nowrap" }}>{label}</Text>
      </Group>
    );
  };

  if (!isUploaded) { navigate(UrlConstants.MAIN); return null; }

  // ── 칩 그룹 렌더 헬퍼 ──
  const renderChipRow = (label, options, value, onChange) => {
    if (options.length === 0) return null;
    return (
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Text size="sm" fw={600} c="dimmed" w={80} style={{ flexShrink: 0, paddingTop: 6 }}>{label}</Text>
        <Chip.Group multiple value={value} onChange={onChange}>
          <Group gap={6} wrap="wrap">
            {options.map(o => (
              <Chip key={o.value} value={o.value} size="sm" variant="outline">{o.label}</Chip>
            ))}
          </Group>
        </Chip.Group>
      </Group>
    );
  };

  return (
    <>
      <Box style={{ backgroundColor: "#F8F9FA", minHeight: "100vh", padding: "2rem 0" }}>
        <Container size="xl">
          <Stack gap="lg">
            {/* 헤더 */}
            <div>
              <Title order={2} c="dark.8">다운로드</Title>
              <Text c="dimmed">조건을 선택하고 데이터를 다운로드합니다.</Text>
            </div>

            {/* 조건 선택 + 형식 + 다운로드 통합 패널 */}
            <Paper p="lg" shadow="sm" radius="md" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={700} size="lg">조건 선택</Text>
                  {hasAnyFilter && (
                    <Button variant="subtle" color="gray" size="compact-sm" onClick={clearAllFilters}>초기화</Button>
                  )}
                </Group>

                <Stack gap={8}>
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <Text size="sm" fw={600} c="dimmed" w={80} style={{ flexShrink: 0, paddingTop: 6 }}>대상</Text>
                    <Chip checked={!hasAnyFilter} onChange={clearAllFilters} size="sm" color="blue" variant="outline">전체</Chip>
                  </Group>
                  {renderChipRow("위험등급", chipOptions.risk, selRisk, withReset(setSelRisk))}
                  {renderChipRow("검사유형", chipOptions.domain, selDomain, withReset(setSelDomain))}
                  {renderChipRow("성별", chipOptions.gender, selGender, withReset(setSelGender))}
                  {renderChipRow("연령대", chipOptions.age, selAge, withReset(setSelAge))}
                  {renderChipRow("지역본부", chipOptions.branch, selBranch, withReset(setSelBranch))}
                  {renderChipRow("업종", chipOptions.industry, selIndustry, withReset(setSelIndustry))}
                </Stack>

                <Divider />

                <Stack gap="sm">
                  <Text size="sm" fw={700} c="dimmed">다운로드 형식</Text>
                  <Chip.Group multiple value={[...(wantCsv ? ['csv'] : []), ...(wantPdf ? ['pdf'] : []), ...(wantHtml ? ['html'] : [])]} onChange={(vals) => { setWantCsv(vals.includes('csv')); setWantPdf(vals.includes('pdf')); setWantHtml(vals.includes('html')); }}>
                    <Group gap={10}>
                      <Chip value="csv" size="sm" color="green" variant="outline">CSV (운전자 목록)</Chip>
                      <Chip value="pdf" size="sm" color="red" variant="outline">PDF (AI 진단보고서)</Chip>
                      <Chip value="html" size="sm" color="blue" variant="outline">HTML (AI 진단보고서)</Chip>
                    </Group>
                  </Chip.Group>
                  <Button
                    onClick={handleDownload}
                    loading={downloading}
                    disabled={(!wantCsv && !wantPdf && !wantHtml) || filteredData.length === 0}
                    color="red"
                    size="md"
                    fullWidth
                    styles={{ label: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 } }}
                  >
                    <span>다운로드</span>
                    <span style={{ opacity: 0.8, fontSize: 13, fontWeight: 400 }}>{filteredData.length}명</span>
                  </Button>
                </Stack>

                {/* 진행률 (형식별) */}
                {Object.keys(progressMap).length > 0 && (
                  <>
                    <Divider />
                    <Stack gap="sm">
                      {['csv', 'shap', 'html', 'pdf'].map(key => {
                        const p = progressMap[key];
                        if (!p) return null;
                        const colors = { csv: 'green', shap: 'violet', html: 'blue', pdf: 'red' };
                        const labels = { csv: 'CSV', shap: 'AI 분석', html: 'HTML', pdf: 'PDF' };
                        const pct = p.total > 0 ? (p.current / p.total) * 100 : 0;
                        const status = p.error ? p.error : p.done ? '완료' : `${p.current}/${p.total}`;
                        return (
                          <Group key={key} justify="space-between" align="center">
                            <Text size="sm" fw={500} w={60}>{labels[key]}</Text>
                            <Progress value={p.error ? 100 : pct} size="sm" color={p.error ? 'gray' : colors[key]} animated={!p.done && !p.error} style={{ flex: 1 }} />
                            <Text size="xs" c={p.error ? 'red' : 'dimmed'} w={80} ta="right">{status}</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  </>
                )}
              </Stack>
            </Paper>

            {/* 테이블 */}
            <Paper shadow="sm" radius="md" withBorder pos="relative">
              <Table striped highlightOnHover verticalSpacing="sm" withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>이름</Table.Th>
                    <Table.Th>주민번호</Table.Th>
                    <Table.Th>성별</Table.Th>
                    <Table.Th>검사일자</Table.Th>
                    <Table.Th>연령</Table.Th>
                    <Table.Th>지역본부</Table.Th>
                    <Table.Th>업종</Table.Th>
                    <Table.Th>검사유형</Table.Th>
                    <Table.Th style={{ width: '15%' }}>사고 위험도</Table.Th>
                    <Table.Th>위험등급</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedData.length > 0 ? paginatedData.map(d => (
                    <Table.Tr key={d.PrimaryKey}>
                      <Table.Td fw={500}>{d.masked_name || '-'}</Table.Td>
                      <Table.Td><Text size="sm">{d.masked_rrn || d.masked_dob || '-'}</Text></Table.Td>
                      <Table.Td>{d.gender || '-'}</Table.Td>
                      <Table.Td>{formatDate(d.TestDate)}</Table.Td>
                      <Table.Td>{d.current_age ? `${d.current_age}세` : '-'}</Table.Td>
                      <Table.Td>{d.branch || '-'}</Table.Td>
                      <Table.Td><Text size="sm">{d.industry || '-'}</Text></Table.Td>
                      <Table.Td>{d.domain === 'A' ? '신규 검사' : '자격유지 검사'}</Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <Text size="sm" w={50}>{d.result != null ? (d.result * 100).toFixed(1) + '%' : '-'}</Text>
                          <Progress value={d.result != null ? d.result * 100 : 0} color={d.result >= RISK_THRESHOLDS.HIGH ? "red" : d.result >= RISK_THRESHOLDS.MEDIUM ? "orange" : "teal"} size="sm" style={{ flex: 1 }} />
                        </Group>
                      </Table.Td>
                      <Table.Td>{getRiskBadge(d.riskGroup)}</Table.Td>
                    </Table.Tr>
                  )) : (
                    <Table.Tr>
                      <Table.Td colSpan={10}>
                        <Text ta="center" py="xl" c="dimmed">데이터가 없습니다.</Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
              {totalPages > 0 && (
                <Center py="md">
                  <Group>
                    <Pagination total={totalPages} value={page} onChange={setPage} color="red" />
                    <Group gap={6} align="center">
                      <NumberInput value={inputPage} onChange={(val) => setInputPage(val)} min={1} max={totalPages} allowNegative={false} decimalScale={0} hideControls size="sm" w={50} styles={{ input: { textAlign: 'center' } }} onKeyDown={(e) => e.key === "Enter" && handlePageJump()} />
                      <Text size="sm" c="dimmed">/ {totalPages}</Text>
                      <Button variant="default" onClick={handlePageJump} size="sm">이동</Button>
                    </Group>
                  </Group>
                </Center>
              )}
            </Paper>

            <Text size="sm" c="dimmed" ta="right">총 {filteredData.length}명</Text>
          </Stack>
        </Container>
      </Box>
    </>
  );
};

export default RiskDownload;
