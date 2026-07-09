import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * DOM 요소 → PDF 다운로드 (섹션 단위 페이지 분할)
 *
 * element의 직계 자식(div)을 각각 캡처하여 PDF에 배치합니다.
 * 한 섹션이 현재 페이지의 남은 공간에 들어가지 않으면 새 페이지에서 시작하므로
 * 섹션 중간이 잘리는 현상이 방지됩니다.
 * (단, 개별 섹션이 페이지 전체보다 크면 불가피하게 잘립니다.)
 */
export async function exportElementToPdf(element, filename, options = {}) {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const sections = Array.from(element.children);
    let cursorY = margin;
    const sectionGap = 4; // 섹션 간 여백 (mm)

    for (let i = 0; i < sections.length; i++) {
        const canvas = await html2canvas(sections[i], {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            ...options,
        });

        const sectionHeight = (canvas.height * contentWidth) / canvas.width;

        // 섹션 간 여백 추가 (첫 섹션 제외)
        if (i > 0) cursorY += sectionGap;

        // 현재 페이지 남은 공간에 안 들어가면 새 페이지
        if (cursorY > margin && cursorY + sectionHeight > pageHeight - margin) {
            pdf.addPage();
            cursorY = margin;
        }

        if (sectionHeight <= usableHeight) {
            // 섹션이 한 페이지에 들어감
            const imgData = canvas.toDataURL('image/png');
            pdf.addImage(imgData, 'PNG', margin, cursorY, contentWidth, sectionHeight);
            cursorY += sectionHeight;
        } else {
            // 섹션이 페이지보다 큼 — 슬라이스 (불가피)
            let srcY = 0;
            while (srcY < canvas.height) {
                if (srcY > 0) {
                    pdf.addPage();
                    cursorY = margin;
                }
                const availH = usableHeight;
                const srcH = Math.min(
                    (availH / sectionHeight) * canvas.height,
                    canvas.height - srcY
                );
                const destH = (srcH / canvas.height) * sectionHeight;

                const slice = document.createElement('canvas');
                slice.width = canvas.width;
                slice.height = srcH;
                slice.getContext('2d').drawImage(
                    canvas, 0, srcY, canvas.width, srcH,
                    0, 0, canvas.width, srcH
                );

                pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, cursorY, contentWidth, destH);
                srcY += srcH;
                cursorY = margin + destH;
            }
        }
    }

    pdf.save(filename);
}

/**
 * 단일 DOM 요소를 PDF ArrayBuffer로 변환 (메모리 즉시 해제용).
 */
export async function elementToPdfBuffer(element) {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210, pageHeight = 297, margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const sections = Array.from(element.children);
    let cursorY = margin;
    const sectionGap = 4;

    for (let i = 0; i < sections.length; i++) {
        const canvas = await html2canvas(sections[i], {
            scale: 1.5,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });

        const sectionHeight = (canvas.height * contentWidth) / canvas.width;

        if (i > 0) cursorY += sectionGap;

        if (cursorY > margin && cursorY + sectionHeight > pageHeight - margin) {
            pdf.addPage();
            cursorY = margin;
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.85);

        if (sectionHeight <= usableHeight) {
            pdf.addImage(imgData, 'JPEG', margin, cursorY, contentWidth, sectionHeight);
            cursorY += sectionHeight;
        } else {
            let srcY = 0;
            while (srcY < canvas.height) {
                if (srcY > 0) { pdf.addPage(); cursorY = margin; }
                const srcH = Math.min((usableHeight / sectionHeight) * canvas.height, canvas.height - srcY);
                const destH = (srcH / canvas.height) * sectionHeight;
                const slice = document.createElement('canvas');
                slice.width = canvas.width;
                slice.height = srcH;
                slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
                pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', margin, cursorY, contentWidth, destH);
                srcY += srcH;
                cursorY = margin + destH;
            }
        }
    }

    return pdf.output('arraybuffer');
}
