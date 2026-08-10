const pendingRequests = new Map<string, Promise<unknown>>();

export const coalesceCimmichRequest = <T>(key: string, create: () => Promise<T>): Promise<T> => {
  const existing = pendingRequests.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const pending = create();
  pendingRequests.set(key, pending);
  const release = () => {
    if (pendingRequests.get(key) === pending) {
      pendingRequests.delete(key);
    }
  };
  void pending.then(release, release);
  return pending;
};
