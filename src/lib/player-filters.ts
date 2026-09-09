/**
 * Numeric filters are opt-in. A missing optional value is visible until a
 * user supplies at least one bound, at which point it cannot match a range.
 */
export function numericRangeIncludes(
  value: number | null,
  min: string,
  max: string,
) {
  if (!min && !max) return true;
  return value !== null && (!min || value >= Number(min)) && (!max || value <= Number(max));
}
