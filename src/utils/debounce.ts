export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** 立即执行尚未触发的调用（用于退出前强制落库） */
  flush(): void;
  /** 丢弃尚未触发的调用 */
  cancel(): void;
  /** 是否有等待中的调用 */
  pending(): boolean;
}

/**
 * 尾部触发的防抖。带 flush()，因为退出前必须把待写入的内容强制落库。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const invoke = (): void => {
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args !== null) fn(...args);
  };

  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  }) as Debounced<A>;

  debounced.flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      invoke();
    }
  };

  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.pending = (): boolean => timer !== null;

  return debounced;
}
