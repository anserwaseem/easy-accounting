import { useNavigate } from 'react-router-dom';
import { useCmdOrCtrlShortcut } from './useCmdOrCtrlShortcut';

/** ⌘/Ctrl+<number> shortcuts:
 * 1 new journal,
 * 2 new purchase invoice,
 * 3 new sale invoice
 */
export const useAppNavigationShortcuts = (): void => {
  const navigate = useNavigate();

  useCmdOrCtrlShortcut('1', () => navigate('/journals/new'));
  useCmdOrCtrlShortcut('2', () => navigate('/purchase/invoices/new'));
  useCmdOrCtrlShortcut('3', () => navigate('/sale/invoices/new'));
};
