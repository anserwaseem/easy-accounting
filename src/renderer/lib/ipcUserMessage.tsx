import type { ReactNode } from 'react';

const stripElectronIpcWrappers = (raw: string): string => {
  let s = raw.trim();
  // use [\s\S] instead of .+ with /s so we stay compatible with compiler target below ES2018
  const ipc = s.match(/^Error invoking remote method '[^']+':\s*([\s\S]+)$/i);
  if (ipc) {
    s = ipc[1].trim();
  }
  while (s.startsWith('Error: ')) {
    s = s.slice(7).trim();
  }
  return s;
};

const parseStockShortageLines = (afterPrefix: string): string[] => {
  const body = afterPrefix.trim();
  if (!body) return [];
  // server joins items with ", " but each item contains "need X, have Y" — split only between entries
  const segments = body.split('), ');
  return segments
    .map((segment, index) => {
      const t = segment.trim();
      if (!t) return '';
      return index < segments.length - 1 ? `${t})` : t;
    })
    .filter(Boolean);
};

interface ConvertQuotationToastContent {
  title: string;
  description: ReactNode;
}

/** turns raw IPC/rejection messages into concise toast title + description */
export const toastContentFromConvertQuotationError = (
  raw: string,
): ConvertQuotationToastContent => {
  const message = stripElectronIpcWrappers(raw);
  const stockPrefix = 'Not enough stock for:';
  if (message.startsWith(stockPrefix)) {
    const rest = message.slice(stockPrefix.length).trim();
    const items = parseStockShortageLines(rest);
    return {
      title: 'Not enough stock to convert',
      description: (
        <div className="space-y-2 text-sm">
          <p>
            Increase on-hand quantities or reduce line quantities on the
            quotation, then try again.
          </p>
          {items.length > 0 ? (
            <ul className="list-disc pl-4 space-y-1">
              {items.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ),
    };
  }
  return {
    title: 'Could not convert quotation',
    description: message,
  };
};
