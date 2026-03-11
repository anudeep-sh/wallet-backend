/**
 * Base class for all application-specific errors.
 * Carries an HTTP status code so the error handler can set it on the response.
 */
export class AppError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — the request body / params are invalid */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

/** 401 — missing or invalid credentials */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/** 403 — authenticated but lacks permission */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/** 404 — resource does not exist */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

/** 409 — resource already exists or state conflict */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

/** 422 — request understood but semantically invalid (e.g. insufficient balance) */
export class UnprocessableError extends AppError {
  constructor(message = 'Unprocessable entity') {
    super(message, 422);
  }
}

/** 429 — too many requests (rate limit) */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}
