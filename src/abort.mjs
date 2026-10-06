// Filesystem operations such as readdir/stat cannot cancel their OS request.
// Stop awaiting them on cancellation, and check the signal before every next step.
export async function abortable(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return await operation();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([operation(), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
