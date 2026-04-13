export class DomainError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class DomainValidationError extends DomainError {
  public constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export class DomainConflictError extends DomainError {
  public constructor(message: string) {
    super(message);
    this.name = "DomainConflictError";
  }
}
