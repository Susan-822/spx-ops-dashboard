function normalizeNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw || raw === "--" || /^n\/a$/i.test(raw) || /^unavailable$/i.test(raw)) {
    return null;
  }

  const cleaned = raw
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .replace(/\u2212/g, "-")
    .trim();

  const multiplierMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])$/i);
  if (multiplierMatch) {
    const base = Number(multiplierMatch[1]);
    const suffix = multiplierMatch[2].toLowerCase();
    const factor = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1e9;
    return Number.isFinite(base) ? base * factor : null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function cleanNumeric(value, options = {}) {
  const parsed = normalizeNumber(value);
  if (parsed !== null) {
    return parsed;
  }
  if (options.keepStrings) {
    return cleanText(value);
  }
  return null;
}

function deriveDealerBehavior(netGamma) {
  if (netGamma === null) {
    return "unknown";
  }

  if (netGamma > 0) {
    return "pin";
  }

  if (netGamma < 0) {
    return "expand";
  }

  return "mixed";
}

function deriveGammaRegime(netGamma) {
  if (netGamma === null) {
    return "unknown";
  }

  if (netGamma > 0) {
    return "positive";
  }

  if (netGamma < 0) {
    return "negative";
  }

  return "neutral";
}

function sumNullable(...values) {
  const normalized = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  if (normalized.some((value) => value === null || value === undefined)) {
    return null;
  }

  return normalized.reduce((total, value) => total + value, 0);
}

function buildMissingFields(fieldMap) {
  return Object.entries(fieldMap)
    .filter(([, value]) => value === null || value === undefined || value === "")
    .map(([key]) => key);
}

module.exports = {
  normalizeNumber,
  parseNumericLike: normalizeNumber,
  cleanNumeric,
  cleanText,
  deriveDealerBehavior,
  inferDealerBehavior: deriveDealerBehavior,
  deriveGammaRegime,
  inferGammaRegime: deriveGammaRegime,
  sumNullable,
  buildMissingFields,
  deriveActivationLight(score) {
    if (score === null || score === undefined || Number.isNaN(score)) {
      return "unknown";
    }
    if (score >= 60) {
      return "green";
    }
    if (score >= 30) {
      return "yellow";
    }
    return "red";
  },
};
