const PUBLIC_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export function jsonResponse(
  body: unknown,
  options: { status?: number; requestId: string; cache?: boolean },
): Response {
  return Response.json(body, {
    status: options.status,
    headers: {
      "Cache-Control": options.cache ? PUBLIC_CACHE : "no-store",
      ...(options.cache ? {} : { "X-Request-Id": options.requestId }),
    },
  });
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[\w.-]{1,100}$/.test(supplied) ? supplied : crypto.randomUUID();
}
