export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const NotFoundError = (message = "Not found") => new HttpError(404, message, "NOT_FOUND");
export const BadRequestError = (message = "Bad request") => new HttpError(400, message, "BAD_REQUEST");
export const UnauthorizedError = (message = "Unauthorized") => new HttpError(401, message, "UNAUTHORIZED");
export const ForbiddenError = (message = "Forbidden") => new HttpError(403, message, "FORBIDDEN");
export const ConflictError = (message = "Conflict") => new HttpError(409, message, "CONFLICT");
