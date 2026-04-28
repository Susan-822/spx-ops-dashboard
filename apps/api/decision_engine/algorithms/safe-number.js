export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasNumber(value) {
  return numberOrNull(value) != null;
}

export function present(value) {
  return value !== null && value !== undefined && value !== '';
}

export function compact(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item !== null && item !== undefined && item !== '');
}
