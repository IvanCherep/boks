export function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: number[]) {
  const average = mean(values);
  if (!average) return 0;
  return standardDeviation(values) / Math.abs(average);
}

export function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}
