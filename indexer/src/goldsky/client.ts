/** Minimal GraphQL POST helper for Goldsky subgraph endpoints. */

export async function goldskyQuery<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Goldsky HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`
    );
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{message: string}>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Goldsky GraphQL: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  if (!json.data) {
    throw new Error("Goldsky GraphQL: empty data");
  }
  return json.data;
}
