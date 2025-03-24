import { useEffect, useCallback } from 'react';
import type {
  BackupOperationStatusEvent,
  BackupOperationProgressEvent,
} from '@/types';
import { toast, type ToastVariant } from '../shad/ui/use-toast';

// toast configuration by status type
const toastConfig = {
  success: {
    variant: 'success' as ToastVariant,
    duration: 3000,
  },
  error: {
    variant: 'destructive' as ToastVariant,
    duration: 5000,
  },
  progress: {
    variant: 'default' as ToastVariant,
    duration: 2000,
  },
};

// component to listen for backup operation events and display toast notifications
const BackupToastListener = () => {
  // handle backup operation status events
  const handleBackupStatus = useCallback((...args: unknown[]) => {
    const data = args[0] as BackupOperationStatusEvent;
    const { status, message } = data;

    let title = '';
    const { variant: defaultVariant, duration: defaultDuration } =
      toastConfig.progress;
    let variant: ToastVariant = defaultVariant;
    let duration = defaultDuration;

    // destructure outside switch to avoid lexical declaration errors
    const { variant: errorVariant, duration: errorDuration } =
      toastConfig.error;
    const { variant: successVariant, duration: successDuration } =
      toastConfig.success;

    switch (status) {
      case 'in-progress':
        title = 'Backup Operation Started';
        break;
      case 'error':
        title = 'Backup Operation Failed';
        variant = errorVariant;
        duration = errorDuration;
        break;
      case 'success':
        title = 'Backup Operation Successful';
        variant = successVariant;
        duration = successDuration;
        break;
      default:
        title = 'Backup Operation';
        break;
    }

    toast({
      title,
      description: message,
      variant,
      duration,
    });
  }, []);

  // handle backup operation progress events
  const handleBackupProgress = useCallback((...args: unknown[]) => {
    const data = args[0] as BackupOperationProgressEvent;
    const { status, message, type } = data;

    const operationText = type === 'upload' ? 'Upload' : 'Download';
    let title = '';
    const { variant: defaultVariant, duration: defaultDuration } =
      toastConfig.progress;
    let variant: ToastVariant = defaultVariant;
    let duration = defaultDuration;

    // destructure outside switch to avoid lexical declaration errors
    const { variant: errorVariant, duration: errorDuration } =
      toastConfig.error;
    const { variant: successVariant, duration: successDuration } =
      toastConfig.success;

    switch (status) {
      case 'started':
        title = `${operationText} Started`;
        break;
      case 'processing':
      case 'uploading':
        title = `${operationText} In Progress`;
        break;
      case 'completed':
        title = `${operationText} Completed`;
        variant = successVariant;
        duration = successDuration;
        break;
      case 'failed':
        title = `${operationText} Failed`;
        variant = errorVariant;
        duration = errorDuration;
        break;
      default:
        title = `${operationText} Operation`;
        break;
    }

    toast({
      title,
      description: message,
      variant,
      duration,
    });
  }, []);

  useEffect(() => {
    // add IPC listeners
    const unsubscribeStatus = window.electron.ipcRenderer.on(
      'backup-operation-status',
      handleBackupStatus,
    );

    const unsubscribeProgress = window.electron.ipcRenderer.on(
      'backup-operation-progress',
      handleBackupProgress,
    );

    // cleanup
    return () => {
      unsubscribeStatus();
      unsubscribeProgress();
    };
  }, [handleBackupStatus, handleBackupProgress]);

  // this component doesn't render anything
  return null;
};

export default BackupToastListener;
