export const isUnknownInteractionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && error.code === 10062;
};
