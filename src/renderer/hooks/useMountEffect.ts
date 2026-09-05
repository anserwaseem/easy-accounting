import { useEffect } from 'react';

/** run external setup once when component mounts */
export const useMountEffect = (effect: () => void | (() => void)): void => {
  // mount semantics are intentional; callers must not depend on changing values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
};
