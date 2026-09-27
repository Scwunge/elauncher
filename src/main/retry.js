export async function withRetries(fn, options = {}) {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2e3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      options.onRetry?.(err, attempt, attempts);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
