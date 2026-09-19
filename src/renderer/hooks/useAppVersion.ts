import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/appVersion';

/**
 * running app version. starts from root package.json so electron and web
 * both show a number on first paint. desktop then overlays `app.getVersion()`
 * when ipc is present (packaged binary).
 */
export const useAppVersion = (): string => {
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    let cancelled = false;
    const read = window.electron.getAppVersion;
    if (typeof read === 'function') {
      read()
        .then((next) => {
          if (!cancelled && next) setVersion(next);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
};
