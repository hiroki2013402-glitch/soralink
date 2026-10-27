export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
  } catch (error) {
    // A fetch rejection means no usable HTTP response was received.
    // Avoid logging request bodies, cookies, or other potentially sensitive data.
    console.error("[API] network failure", {
      path,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw new Error("サーバーに接続できません。通信環境を確認してください。");
  }

  const responseText = await response.text();
  let data: { error?: string; code?: string } = {};

  if (responseText) {
    try {
      data = JSON.parse(responseText) as { error?: string; code?: string };
    } catch {
      // Non-JSON responses can occur when a proxy or hosting layer returns an error page.
    }
  }

  if (!response.ok) {
    console.error("[API] HTTP failure", {
      path,
      status: response.status,
      code: data.code
    });
    throw new Error(data.error || `サーバーエラー（HTTP ${response.status}）`);
  }

  if (!responseText) {
    throw new Error("サーバーから空の応答が返されました。");
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    console.error("[API] invalid JSON response", {
      path,
      status: response.status
    });
    throw new Error("サーバーの応答形式が正しくありません。");
  }
}

// Rejects if the promise has not settled in time. A request that hangs (common after iOS suspends the app) must not block later ones.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error); }
    );
  });
}
