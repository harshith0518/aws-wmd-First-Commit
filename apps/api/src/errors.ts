export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    public code: string,
    message: string,
    public latestVersion?: number,
  ) {
    super(message);
  }
}
export const unavailable = () => new ApiError(404, 'NOT_FOUND', 'This item is unavailable.');
