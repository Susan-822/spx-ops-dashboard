function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function convertSpxLevel(spxLevel, targetPrice, spxPrice) {
  const level = finiteNumber(spxLevel);
  const target = finiteNumber(targetPrice);
  const spx = finiteNumber(spxPrice);
  if (level == null || target == null || spx == null) return null;
  return Number((level * (target / spx)).toFixed(2));
}

export function convertSpxToEs(spxLevel, esPrice, spxPrice) {
  return convertSpxLevel(spxLevel, esPrice, spxPrice);
}

export function convertSpxToSpy(spxLevel, spyPrice, spxPrice) {
  return convertSpxLevel(spxLevel, spyPrice, spxPrice);
}

export function convertSpxToMes(spxLevel, esPrice, spxPrice) {
  return convertSpxLevel(spxLevel, esPrice, spxPrice);
}

export function ratio(targetPrice, spxPrice) {
  const target = finiteNumber(targetPrice);
  const spx = finiteNumber(spxPrice);
  if (target == null || spx == null) return null;
  return Number((target / spx).toFixed(6));
}
