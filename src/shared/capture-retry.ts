/** Retry Chromium's transient screenshot failure once. */
export async function captureWithTransientRetry<T>(
  capture: () => Promise<T>,
  beforeRetry: () => Promise<void>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  try {
    return await capture();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/^Internal error\.?$/i.test(error.message.trim())
    )
      throw error;
  }

  await wait(650);
  await beforeRetry();
  try {
    return await capture();
  } catch (error) {
    if (
      error instanceof Error &&
      /^Internal error\.?$/i.test(error.message.trim())
    )
      throw new Error(
        "Your browser could not capture this page after retry. Switch back to the page, wait for it to finish loading, and try again.",
        { cause: error },
      );
    throw error;
  }
}
