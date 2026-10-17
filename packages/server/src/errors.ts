import { ApiError, type ApiErrorCode } from "@rr/core";

export { ApiError };
export const fail = (code: ApiErrorCode, message: string, status = 400): never => { throw new ApiError(code, message, status); };
export const notFound = (what = "That"): never => fail("not_found", `${what} was not found.`, 404);
export const forbidden = (message = "You do not have permission to do that."): never => fail("forbidden", message, 403);
export const conflict = (code: ApiErrorCode, message: string): never => fail(code, message, 409);
