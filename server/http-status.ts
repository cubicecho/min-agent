/** The HTTP statuses this server answers with, by the names the protocol gives them. */
export const HttpStatus = {
  badRequest: 400,
  conflict: 409,
  internalServerError: 500,
  badGateway: 502,
} as const;
