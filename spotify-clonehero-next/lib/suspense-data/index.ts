import {use} from 'react';

const dataCache = new Map<string, Promise<any>>();

type UseDataResult<T> = {
  data: T;
};

export function useData<T>({
  key,
  fn,
}: {
  key: string | string[];
  fn: () => Promise<T>;
}): UseDataResult<T> {
  const keyStr = Array.isArray(key) ? key.join('-') : key;
  if (!dataCache.has(keyStr)) {
    dataCache.set(keyStr, fn());
  }

  const promise = dataCache.get(keyStr) as Promise<T>;

  const data = use(promise);
  return {data: data};
}
