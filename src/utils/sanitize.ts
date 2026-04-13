const MASS_MENTION_PATTERN = /@(?:everyone|here)/gi;

export const sanitizeUserText = (input: string, maxLength = 250): string =>
  input.replace(MASS_MENTION_PATTERN, "[mention removed]").slice(0, maxLength).trim();
