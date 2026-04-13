export class AppError extends Error {
  public readonly code: string;

  public readonly statusCode: number;

  public readonly safeMessage: string;

  public constructor(code: string, safeMessage: string, statusCode = 400) {
    super(safeMessage);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.safeMessage = safeMessage;
  }
}

export class PermissionError extends AppError {
  public constructor(message = "You do not have permission to perform this action.") {
    super("PERMISSION_DENIED", message, 403);
  }
}

export class ValidationError extends AppError {
  public constructor(message: string) {
    super("VALIDATION_ERROR", message, 400);
  }
}

export class ConflictError extends AppError {
  public constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string) {
    super("NOT_FOUND", message, 404);
  }
}
