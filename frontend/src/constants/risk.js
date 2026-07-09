export const RISK_THRESHOLDS = { HIGH: 0.7, MEDIUM: 0.5 };

const RISK_LABELS = { HIGH: '고위험', MEDIUM: '중위험', LOW: '저위험' };

export const RISK_COLORS = {
  '고위험': '#fa5252',
  '중위험': '#fcc419',
  '저위험': '#0ca678',
};

export const getRiskLevel = (score) =>
  score >= RISK_THRESHOLDS.HIGH ? RISK_LABELS.HIGH
    : score >= RISK_THRESHOLDS.MEDIUM ? RISK_LABELS.MEDIUM
    : RISK_LABELS.LOW;
