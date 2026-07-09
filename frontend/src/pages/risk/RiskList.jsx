import { useEffect, useState, useMemo } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Eye, EyeOff } from "lucide-react";
import {
  Container,
  Title,
  Text,
  Group,
  Stack,
  Table,
  Pagination,
  TextInput,
  Select,
  Button,
  Paper,
  Progress,
  Box,
  rem,
  UnstyledButton,
  Center,
  NumberInput,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import UrlConstants from "@/constants/url";
import { RISK_THRESHOLDS, getRiskLevel } from "@/constants/risk";
import useAnalysisStore from "@/store/useAnalysisStore";
import useAdminStore from "@/store/useAdminStore";

// ── 필터 적용 헬퍼 (연령은 current_age 기준 — 테이블 표시와 일치) ──
const filterBySelection = (items, type, val) => {
  if (!val) return items;
  if (type === 'age') {
    const [decadeStr, sub] = val.split('_');
    const decade = parseInt(decadeStr, 10);
    return items.filter(d => {
      const age = parseInt(d.current_age, 10);
      if (!age || isNaN(age)) return false;
      const d10 = Math.floor(age / 10) * 10;
      if (d10 !== decade) return false;
      if (!sub) return true;
      return sub === 'early' ? (age % 10) < 5 : (age % 10) >= 5;
    });
  }
  if (type === 'risk') return items.filter(d => getRiskLevel(d.result || 0) === val);
  if (type === 'domain') return items.filter(d => d.domain === val);
  if (type === 'gender') return items.filter(d => String(d.Gender || d.gender || '') === val);
  if (type === 'branch') return items.filter(d => String(d.Branch || d.branch || '') === val);
  if (type === 'industry') return items.filter(d => String(d.Industry || d.industry || '') === val);
  return items;
};

// ── 필터 기준 목록 ──
const FILTER_TYPES = [
  { value: "all", label: "전체" },
  { value: "risk", label: "위험등급" },
  { value: "domain", label: "검사유형" },
  { value: "gender", label: "성별" },
  { value: "age", label: "연령대" },
  { value: "branch", label: "지역본부" },
  { value: "industry", label: "업종" },
];

const SortableTh = ({ children, reversed, sorted, onSort, style, action }) => {
  const Icon = sorted ? (reversed ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <Table.Th style={{ ...style, padding: 0 }}>
      <UnstyledButton
        onClick={onSort}
        style={{
          width: "100%",
          padding: "var(--mantine-spacing-xs) var(--mantine-spacing-sm)",
          transition: "background-color 150ms ease",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor =
            "var(--mantine-color-gray-0)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "transparent")
        }
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap={2} wrap="nowrap">
            <Text fw={700} size="sm" style={{ whiteSpace: "nowrap" }}>
              {children}
            </Text>
            {action}
          </Group>
          <Center style={{ width: rem(21), height: rem(21) }}>
            <Icon
              size={16}
              strokeWidth={1.5}
              color={
                sorted
                  ? "var(--mantine-color-dark-9)"
                  : "var(--mantine-color-gray-5)"
              }
            />
          </Center>
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
};

const RiskList = () => {

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(
    parseInt(searchParams.get("page") || "1", 10),
  );
  const [searchTerm, setSearchTerm] = useState(
    searchParams.get("driverId") || "",
  );
  const [filterType, setFilterType] = useState(
    searchParams.get("filterType") || "all",
  );
  const [filterValue, setFilterValue] = useState(
    searchParams.get("filterValue") || "",
  );

  // 정렬 상태 — URL에서 직접 파생 (뒤로가기 시 브라우저가 URL 복원 → 자동 유지)
  const sortField = searchParams.get("sort") || "result";
  const sortDirection = searchParams.get("dir") || "desc";

  const [inputPage, setInputPage] = useState("");

  const PAGESIZE = 20;

  const { isUploaded, analysisResults } =
    useAnalysisStore();
  const { isAdmin } = useAdminStore();

  const [nameUnmasked, setNameUnmasked] = useState(false);
  const [rrnUnmasked, setRrnUnmasked] = useState(false);






  useEffect(() => {
    if (!isUploaded) {
      navigate(UrlConstants.MAIN);
    }
  }, [isUploaded, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const syncParam = (key, value, defaultVal) => {
      if (value && value !== defaultVal) params.set(key, value);
      else params.delete(key);
    };
    syncParam("page", page > 1 ? String(page) : "", "");
    syncParam("driverId", searchTerm, "");
    syncParam("filterType", filterType, "all");
    syncParam("filterValue", filterValue, "");
    setSearchParams(params, { replace: true });
  }, [page, searchTerm, filterType, filterValue, setSearchParams]);

  // PrimaryKey 기반 사람 단위 그룹핑 (최근 검사 대표)
  const personData = useMemo(() => {
    if (!analysisResults) return [];
    const byPK = {};
    for (const r of analysisResults) {
      const pk = r.PrimaryKey;
      if (!pk) continue;
      if (!byPK[pk] || String(r.TestDate || '') > String(byPK[pk].TestDate || '')) {
        byPK[pk] = r;
      }
    }
    return Object.values(byPK);
  }, [analysisResults]);

  // ── 필터 소분류 옵션 (데이터에서 동적 생성) ──
  const filterOptions = useMemo(() => {
    if (!personData || personData.length === 0) return [];
    if (filterType === 'all') return [];

    if (filterType === 'age') {
      const decadeSet = new Set(), earlySet = new Set(), lateSet = new Set();
      personData.forEach(d => {
        const age = parseInt(d.current_age, 10);
        if (!age || isNaN(age)) return;
        const dec = Math.floor(age / 10) * 10;
        decadeSet.add(dec);
        if ((age % 10) >= 5) lateSet.add(dec); else earlySet.add(dec);
      });
      const opts = [];
      Array.from(decadeSet).sort((a, b) => a - b).forEach(dec => {
        opts.push({ value: String(dec), label: `${dec}대 전체` });
        if (earlySet.has(dec)) opts.push({ value: `${dec}_early`, label: `${dec}대 초반` });
        if (lateSet.has(dec)) opts.push({ value: `${dec}_late`, label: `${dec}대 후반` });
      });
      return opts;
    }
    if (filterType === 'risk') {
      const order = ['고위험', '중위험', '저위험'];
      const present = new Set(personData.map(d => getRiskLevel(d.result || 0)));
      return order.filter(r => present.has(r)).map(r => ({ value: r, label: r }));
    }
    if (filterType === 'domain') {
      const labels = { A: '신규검사', B: '자격유지검사' };
      return Array.from(new Set(personData.map(d => d.domain).filter(Boolean))).sort()
        .map(d => ({ value: d, label: labels[d] || d }));
    }
    if (filterType === 'gender')
      return Array.from(new Set(personData.map(d => String(d.Gender || d.gender || '')).filter(Boolean))).sort()
        .map(v => ({ value: v, label: v }));
    if (filterType === 'branch')
      return Array.from(new Set(personData.map(d => String(d.Branch || d.branch || '')).filter(Boolean))).sort()
        .map(v => ({ value: v, label: v }));
    if (filterType === 'industry')
      return Array.from(new Set(personData.map(d => String(d.Industry || d.industry || '')).filter(Boolean))).sort()
        .map(v => ({ value: v, label: v }));
    return [];
  }, [personData, filterType]);

  const filteredData = useMemo(() => {
    if (!personData) return [];

    let items = [...personData];

    if (filterType !== "all" && filterValue) {
      items = filterBySelection(items, filterType, filterValue);
    }

    if (searchTerm) {
      const rawTerm = searchTerm.toLowerCase();
      const spaceFreeTerm = rawTerm.replace(/\s+/g, '');

      items = items.filter((item) => {
        if (item.original_name) {
            const rawName = item.original_name.toLowerCase();
            const spaceFreeName = rawName.replace(/\s+/g, '');
            if (spaceFreeName.includes(spaceFreeTerm)) return true;
        }

        if (item.masked_name) {
             const rawMasked = item.masked_name.toLowerCase();
             if (rawMasked.replace(/\s+/g, '').includes(spaceFreeTerm)) return true;
        }

        return false;
      });
    }

    items.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === "driverId") {
        valA = a.original_name || a.masked_name || a.PrimaryKey;
        valB = b.original_name || b.masked_name || b.PrimaryKey;
      }
      if (sortField === "testDate") {
        valA = a.TestDate;
        valB = b.TestDate;
      }
      if (sortField === "exam_age") {
        valA = Number(a.exam_age) || 0;
        valB = Number(b.exam_age) || 0;
      }
      if (sortField === "current_age") {
        valA = Number(a.current_age) || 0;
        valB = Number(b.current_age) || 0;
      }
      if (sortField === "dob") {
        valA = a.original_dob || a.masked_dob;
        valB = b.original_dob || b.masked_dob;
      }
      if (sortField === "gender") {
        valA = a.gender;
        valB = b.gender;
      }
      if (sortField === "branch") {
        valA = a.branch;
        valB = b.branch;
      }
      if (sortField === "domain") {
        valA = a.domain;
        valB = b.domain;
      }
      if (sortField === "industry") {
          valA = a.industry;
          valB = b.industry;
      }
      if (sortField === "riskGroup") {
          // 한글 사전순(고→저→중) 대신 심각도순(저1<중2<고3)으로 정렬
          const rank = (g) => { const s = String(g || ''); return s.includes('고위험') ? 3 : s.includes('중위험') ? 2 : s.includes('저위험') ? 1 : 0; };
          valA = rank(a.riskGroup);
          valB = rank(b.riskGroup);
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return items;
  }, [personData, filterType, filterValue, searchTerm, sortField, sortDirection]);

  const totalElements = filteredData.length;
  const totalPages = Math.ceil(totalElements / PAGESIZE);
  const paginatedData = filteredData.slice(
    (page - 1) * PAGESIZE,
    page * PAGESIZE,
  );

  const handleSearchClick = () => {
    setPage(1);
  };

  const handleSort = (field) => {
    const params = new URLSearchParams(searchParams);
    const newDir = (field === sortField)
      ? (sortDirection === "asc" ? "desc" : "asc")
      : "desc";
    if (field !== "result") params.set("sort", field);
    else params.delete("sort");
    if (newDir !== "desc") params.set("dir", newDir);
    else params.delete("dir");
    setSearchParams(params, { replace: true });
  };

  const handlePageJump = () => {
    const pageNum =
      typeof inputPage === "number" ? inputPage : parseInt(inputPage, 10);
    if (pageNum >= 1 && pageNum <= totalPages) {
      setPage(pageNum);
      setInputPage("");
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleSearchClick();
    }
  };

  const getRiskBadge = (riskGroup) => {
    let color = "#868e96";
    let bg = "#f1f3f5";
    let label = riskGroup || "-";
    if (label.includes("고위험")) { color = "#e03131"; bg = "#fff5f5"; }
    else if (label.includes("중위험")) { color = "#e8590c"; bg = "#fff4e6"; }
    else if (label.includes("저위험")) { color = "#2f9e44"; bg = "#ebfbee"; }

    return (
      <Group gap={6} wrap="nowrap" style={{
        background: bg, borderRadius: 20, padding: "4px 12px 4px 8px",
        display: "inline-flex", width: "fit-content",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <Text size="xs" fw={600} style={{ color, whiteSpace: "nowrap" }}>{label}</Text>
      </Group>
    );
  };

    const formatDate = (raw) => {
        const s = String(raw || "").trim().replace(/\.0$/, "");
        const parts = s.split(/[.\-\/]/);
        if (parts.length === 3 && parts[0].length === 4) {
            const [y, m, d] = parts;
            return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        }
        const digits = s.replace(/[^0-9]/g, "");
        if (digits.length >= 8) {
            return `${digits.substring(0,4)}-${digits.substring(4,6)}-${digits.substring(6,8)}`;
        }
        return s || "-";
    };

  return (
      <Box
        style={{
          backgroundColor: "#F8F9FA",
          minHeight: "100vh",
          padding: "2rem 0",
        }}
      >
        <Container size="xl">
          <Stack gap="xl">
            {/* 헤더 */}
            <Group justify="space-between" align="flex-end">
              <div>
                <Title order={2} c="dark.8">
                  운전자 목록
                </Title>
                <Text c="dimmed">
                  운전자별 사고 위험도 및 검사 정보를 조회합니다.
                </Text>
              </div>
            </Group>

            {/* 검색 및 필터 */}
            <Paper p="md" shadow="sm" radius="md" withBorder>
              <Group align="flex-end">
                <TextInput
                  label="운전자 이름 검색"
                  placeholder="이름으로 검색"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  style={{ flex: 1 }}
                  leftSection={<Search size={16} color="var(--mantine-color-gray-5)" />}
                />
                <Select
                  label="조건"
                  data={FILTER_TYPES}
                  value={filterType}
                  allowDeselect={false}
                  onChange={(val) => {
                    setFilterType(val || "all");
                    setFilterValue("");
                    setPage(1);
                  }}
                  style={{ width: 160 }}
                />
                {filterType !== "all" && (
                  <Select
                    label="선택"
                    placeholder="선택하세요"
                    data={filterOptions}
                    value={filterValue || null}
                    allowDeselect={false}
                    onChange={(val) => {
                      setFilterValue(val || "");
                      setPage(1);
                    }}
                    style={{ width: 180 }}
                  />
                )}
                <Button onClick={handleSearchClick} color="blue">
                  검색
                </Button>
              </Group>
            </Paper>

            {/* 데이터 테이블 */}
            <Paper shadow="sm" radius="md" withBorder pos="relative">
              <Table
                striped
                highlightOnHover
                verticalSpacing="sm"
                withTableBorder
              >
                <Table.Thead>
                  <Table.Tr>
                    <SortableTh
                      sorted={sortField === "driverId"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("driverId")}
                      style={{ width: "8%" }}
                      action={isAdmin ? (
                        <Tooltip label={nameUnmasked ? "이름 마스킹" : "이름 마스킹 해제"} withArrow>
                          <ActionIcon variant="subtle" color="gray" size="xs"
                            onClick={(e) => { e.stopPropagation(); setNameUnmasked(v => !v); }}>
                            {nameUnmasked ? <EyeOff size={14} /> : <Eye size={14} />}
                          </ActionIcon>
                        </Tooltip>
                      ) : null}
                    >
                      운전자
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "dob"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("dob")}
                      style={{ width: "13%" }}
                      action={isAdmin ? (
                        <Tooltip label={rrnUnmasked ? "주민번호 마스킹" : "주민번호 마스킹 해제"} withArrow>
                          <ActionIcon variant="subtle" color="gray" size="xs"
                            onClick={(e) => { e.stopPropagation(); setRrnUnmasked(v => !v); }}>
                            {rrnUnmasked ? <EyeOff size={14} /> : <Eye size={14} />}
                          </ActionIcon>
                        </Tooltip>
                      ) : null}
                    >
                      주민번호
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "gender"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("gender")}
                    >
                      성별
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "testDate"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("testDate")}
                    >
                      검사 일자
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "current_age"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("current_age")}
                    >
                      연령
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "branch"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("branch")}
                    >
                      지역본부
                    </SortableTh>
                     <SortableTh
                      sorted={sortField === "industry"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("industry")}
                    >
                      업종
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "domain"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("domain")}
                    >
                      검사 유형
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "result"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("result")}
                      style={{ width: "15%" }}
                    >
                      사고 위험도
                    </SortableTh>
                    <SortableTh
                      sorted={sortField === "riskGroup"}
                      reversed={sortDirection === "asc"}
                      onSort={() => handleSort("riskGroup")}
                    >
                      위험 등급
                    </SortableTh>
                    <Table.Th style={{ width: 80, textAlign: "center" }}>
                      상세
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedData.length > 0 ? (
                    paginatedData.map((driver) => (
                      <Table.Tr key={driver.PrimaryKey}>
                        <Table.Td style={{ fontWeight: 500 }}>
                          {nameUnmasked && driver.original_name ? driver.original_name : (driver.masked_name || '-')}
                        </Table.Td>
                        <Table.Td>
                            <Text size="sm">{rrnUnmasked && driver.original_rrn ? driver.original_rrn : (driver.masked_rrn || driver.masked_dob || "-")}</Text>
                        </Table.Td>
                        <Table.Td>{driver.gender || "-"}</Table.Td>
                        <Table.Td>{formatDate(driver.TestDate)}</Table.Td>
                        <Table.Td>{driver.current_age ? `${driver.current_age}세` : "-"}</Table.Td>
                        <Table.Td>{driver.branch || "-"}</Table.Td>
                        <Table.Td>
                            <Text size="sm">{driver.industry || "-"}</Text>
                        </Table.Td>
                        <Table.Td>
                          {driver.domain === "A" ? "신규 검사" : "자격유지 검사"}
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Text size="sm" w={50}>
                              {driver.result != null ? (driver.result * 100).toFixed(1) + '%' : '-'}
                            </Text>
                            <Progress
                              value={driver.result != null ? driver.result * 100 : 0}
                              color={
                                driver.result >= RISK_THRESHOLDS.HIGH
                                  ? "red"
                                  : driver.result >= RISK_THRESHOLDS.MEDIUM
                                    ? "orange"
                                    : "teal"
                              }
                              size="sm"
                              style={{ flex: 1 }}
                            />
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {getRiskBadge(driver.riskGroup)}
                        </Table.Td>
                        <Table.Td style={{ textAlign: "center" }}>
                          <Button
                            component={Link}
                            to={UrlConstants.RISK_DIAGNOSIS.replace(
                              ":primaryKey",
                              driver.PrimaryKey,
                            )}
                            state={{ listSearch: searchParams.toString() }}
                            variant="subtle"
                            color="gray"
                            size="compact-xs"
                          >
                            상세보기
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))
                  ) : (
                    <Table.Tr>
                      <Table.Td colSpan={11}>
                        <Text ta="center" py="xl" c="dimmed">
                          검색 결과가 없습니다.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>

              {/* 페이지네이션 */}
              {totalPages > 0 && (
                <Center py="md">
                  <Group>
                    <Pagination
                      total={totalPages}
                      value={page}
                      onChange={setPage}
                      color="red"
                    />
                    <Group gap={6} align="center">
                      <NumberInput
                        value={inputPage}
                        onChange={(val) => setInputPage(val)}
                        min={1}
                        max={totalPages}
                        allowNegative={false}
                        decimalScale={0}
                        hideControls
                        size="sm"
                        w={50}
                        styles={{ input: { textAlign: 'center' } }}
                        onKeyDown={(e) => e.key === "Enter" && handlePageJump()}
                      />
                      <Text size="sm" c="dimmed">/ {totalPages}</Text>
                      <Button
                        variant="default"
                        onClick={handlePageJump}
                        size="sm"
                      >
                        이동
                      </Button>
                    </Group>
                  </Group>
                </Center>
              )}
            </Paper>

            <Text size="sm" c="dimmed" ta="right">
              총 {totalElements}명
            </Text>
          </Stack>
        </Container>
      </Box>
  );
};

export default RiskList;
