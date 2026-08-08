type ReloadOptions<Input, Output> = {
  delayMs?: number;
  load: (input: Input) => Promise<Output>;
  onError: (error: unknown, input: Input) => void;
  onResult: (output: Output, input: Input) => void;
};

export const createCoalescedReload = <Input, Output>({
  delayMs = 1200,
  load,
  onError,
  onResult,
}: ReloadOptions<Input, Output>) => {
  let disposed = false;
  let pending: Input | undefined;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    timer = undefined;
    if (disposed || running || pending === undefined) {
      return;
    }
    const input = pending;
    pending = undefined;
    running = true;
    try {
      const output = await load(input);
      if (!disposed && pending === undefined) {
        onResult(output, input);
      }
    } catch (error) {
      if (!disposed && pending === undefined) {
        onError(error, input);
      }
    } finally {
      running = false;
      if (!disposed && pending !== undefined) {
        timer = setTimeout(() => void run(), 0);
      }
    }
  };

  return {
    cancelPending: () => {
      pending = undefined;
      if (timer) {
        clearTimeout(timer);
      }
      timer = undefined;
    },
    dispose: () => {
      disposed = true;
      pending = undefined;
      if (timer) {
        clearTimeout(timer);
      }
    },
    schedule: (input: Input) => {
      if (disposed) {
        return;
      }
      pending = input;
      if (timer) {
        clearTimeout(timer);
      }
      if (!running) {
        timer = setTimeout(() => void run(), delayMs);
      }
    },
  };
};
