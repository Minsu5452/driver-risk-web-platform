// 나눔고딕(OFL) 폰트를 jsPDF에 등록하기 위한 로더.
// vite가 해시 관리하는 에셋 URL을 런타임에 fetch → base64 변환 후 메모리 캐시.
// (앱의 JS/CSS 로딩과 동일한 /assets/ 메커니즘이라 오프라인 nginx 환경에서도 동작)
import regularUrl from '@/assets/fonts/NanumGothic-Regular.ttf?url';
import boldUrl from '@/assets/fonts/NanumGothic-Bold.ttf?url';

let _cache = null;
let _inflight = null;

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000; // 32KB씩 — 대용량 apply 인자수 초과 방지
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`폰트 로드 실패: ${url} (HTTP ${res.status})`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

/** 나눔고딕 Regular/Bold base64를 1회 로드 후 캐시. */
export async function loadNanumFonts() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const [regular, bold] = await Promise.all([fetchBase64(regularUrl), fetchBase64(boldUrl)]);
    _cache = { regular, bold };
    _inflight = null;
    return _cache;
  })();
  return _inflight;
}

/** jsPDF 문서에 나눔고딕 normal/bold를 등록한다. fonts는 loadNanumFonts() 결과. */
export function registerNanum(doc, fonts) {
  doc.addFileToVFS('NanumGothic-Regular.ttf', fonts.regular);
  doc.addFont('NanumGothic-Regular.ttf', 'Nanum', 'normal');
  doc.addFileToVFS('NanumGothic-Bold.ttf', fonts.bold);
  doc.addFont('NanumGothic-Bold.ttf', 'Nanum', 'bold');
  doc.setFont('Nanum', 'normal');
}
