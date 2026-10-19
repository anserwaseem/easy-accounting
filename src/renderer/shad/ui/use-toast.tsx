import { useEffect, useState } from 'react';
import type { ToastActionElement, ToastProps } from './toast';

const TOAST_LIMIT = 1;
const TOAST_REMOVE_DELAY = 1000;
const DEFAULT_DURATION = 3500; // ms
const ERROR_DURATION = 6000; // ms for error/warning so users have time to read

const cleanToastMessage = (message: unknown): string => {
  if (message instanceof Error) {
    return cleanToastMessage(message.message);
  }
  if (typeof message !== 'string') return '';
  let s = message.trim();
  const ipc = s.match(/^Error invoking remote method '[^']+':\s*([\s\S]+)$/i);
  if (ipc) {
    s = ipc[1].trim();
  }
  while (s.startsWith('Error: ')) {
    s = s.slice(7).trim();
  }
  return s;
};

type ToasterToast = Omit<ToastProps, 'title'> & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  UPDATE_TOAST: 'UPDATE_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType['ADD_TOAST'];
      toast: ToasterToast;
    }
  | {
      type: ActionType['UPDATE_TOAST'];
      toast: Partial<ToasterToast>;
    }
  | {
      type: ActionType['DISMISS_TOAST'];
      toastId?: ToasterToast['id'];
    }
  | {
      type: ActionType['REMOVE_TOAST'];
      toastId?: ToasterToast['id'];
    };

interface State {
  toasts: ToasterToast[];
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: 'REMOVE_TOAST',
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case 'UPDATE_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t,
        ),
      };

    case 'DISMISS_TOAST': {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toastToBeRemoved) => {
          addToRemoveQueue(toastToBeRemoved.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) {
        toastTimeouts.forEach((timeout) => clearTimeout(timeout));
        toastTimeouts.clear();
        return {
          ...state,
          toasts: [],
        };
      }
      {
        const existing = toastTimeouts.get(action.toastId);
        if (existing) {
          clearTimeout(existing);
          toastTimeouts.delete(action.toastId);
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
    default:
      return state;
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { toasts: [] };

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

/** closes every toast (e.g. before printToPDF so fixed toasts are not captured) */
export function dismissAllToasts(): void {
  toastTimeouts.forEach((timeout) => clearTimeout(timeout));
  toastTimeouts.clear();
  dispatch({ type: 'REMOVE_TOAST' });
}

type Toast = Omit<ToasterToast, 'id' | 'title' | 'description'> & {
  title?: React.ReactNode | Error;
  description?: React.ReactNode | Error;
};

function toast({ ...props }: Toast) {
  const id = genId();

  let { title, description, duration } = props;
  if (typeof description === 'string' || description instanceof Error) {
    description = cleanToastMessage(description);
  }
  if (typeof title === 'string' || title instanceof Error) {
    title = cleanToastMessage(title);
  }

  if (duration === undefined) {
    duration =
      props.variant === 'destructive' || props.variant === 'warning'
        ? ERROR_DURATION
        : DEFAULT_DURATION;
  }

  const update = (toastToUpdate: ToasterToast) =>
    dispatch({
      type: 'UPDATE_TOAST',
      toast: { ...toastToUpdate, id },
    });
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id });

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...props,
      duration,
      title,
      description,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = useState<State>(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}

type ToastVariant = ToastProps['variant'];

export { useToast, toast, type ToastProps, type ToastVariant };
