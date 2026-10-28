export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have access to this.") {
    super(message, "forbidden", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Item") {
    super(`${what} not found.`, "not_found", 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = "invalid", details?: unknown) {
    super(message, code, 422, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict", details?: unknown) {
    super(message, code, 409, details);
  }
}
