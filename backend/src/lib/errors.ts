export class HttpError extends Error {
  // extra: more fields for the answer beside { error } (a restore whose photos failed: { restored: true })
  constructor(public statusCode: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);
