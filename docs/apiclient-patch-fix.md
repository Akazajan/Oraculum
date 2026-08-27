# Fix: `apiClient.patch` missing `credentials: "include"`

## Issue

`apiClient.patch` did not send `credentials: "include"` unlike `apiClient.post`,
causing session cookies to be omitted on PATCH requests.

## Fix

`credentials: "include"` has been added to the `patch` method in
`frontend/lib/apiClient.ts`:

```ts
async patch<T, D = unknown>(endpoint: string, data?: D): Promise<T> {
  return this.request<T>(endpoint, {
    method: "PATCH",
    credentials: "include",
    body: data ? JSON.stringify(data) : undefined,
  });
}
```

This ensures session cookies are forwarded on all mutating requests
(`POST`, `PATCH`, `PUT`, `DELETE`) consistently.

## Affected methods

| Method | Had `credentials: "include"` | After fix |
|--------|------------------------------|-----------|
| `post` | ✅ Yes | ✅ Yes |
| `patch` | ❌ No | ✅ Yes |
| `delete` | ❌ No | unchanged |
| `get` | ❌ No | unchanged |