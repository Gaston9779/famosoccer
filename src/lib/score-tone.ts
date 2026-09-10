export const scoreTone = (value: number | null | undefined) => value == null ? "none" : value >= 70 ? "high" : value >= 40 ? "medium" : "low";
