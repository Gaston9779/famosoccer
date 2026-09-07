export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export class BudgetError extends ProviderError {
  constructor() {
    super(
      "BUDGET_EXHAUSTED",
      "Request budget exhausted; resume with the same command.",
    );
  }
}
