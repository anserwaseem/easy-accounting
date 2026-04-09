import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** ⌘/Ctrl+<number> shortcuts:
 * 1 new journal,
 * 2 new purchase invoice,
 * 3 new sale invoice
 */
export const useAppNavigationShortcuts = (): void => {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) {
        return;
      }
      if (e.altKey || e.shiftKey) {
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        navigate('/journals/new');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        navigate('/purchase/invoices/new');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        navigate('/sale/invoices/new');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);
};
