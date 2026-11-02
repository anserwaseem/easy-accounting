import { toNumber } from 'lodash';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { InvoiceType, InvoiceView } from 'types';
// eslint-disable-next-line import/no-cycle
import InvoicesPage from '../Invoices';
import QuotationsPage from '../Quotations';
import { InvoiceDetails } from './invoiceDetails';

interface InvoiceProps {
  invoiceType: InvoiceType;
  previewId?: number;
}

const InvoicePage: React.FC<InvoiceProps> = ({
  invoiceType,
  previewId,
}: InvoiceProps) => {
  const { id } = useParams();
  const [leftRailKind, setLeftRailKind] = useState<
    'invoice' | 'quotation' | 'saleReturn'
  >('invoice');

  const propInvoices = window.electron.store.get('generatedInvoices') as
    | InvoiceView[]
    | undefined;

  useEffect(() => {
    if (previewId != null || propInvoices) {
      setLeftRailKind('invoice');
      return;
    }
    const rawId = toNumber(id);
    if (!Number.isFinite(rawId) || rawId <= 0) {
      setLeftRailKind('invoice');
      return;
    }
    // do not clear leftRailIsQuotation before fetch — that swapped the mini rail
    // (e.g. quotations → invoices) and felt like a full refresh when switching quotes
    let cancelled = false;
    window.electron
      .getInvoice(rawId)
      .then((inv) => {
        if (!cancelled && inv && typeof inv === 'object') {
          const view = inv as InvoiceView;
          if (view.isSaleReturn) setLeftRailKind('saleReturn');
          else if (view.isQuotation) setLeftRailKind('quotation');
          else setLeftRailKind('invoice');
        }
      })
      .catch(() => {
        if (!cancelled) setLeftRailKind('invoice');
      });
    return () => {
      cancelled = true;
    };
  }, [id, previewId, propInvoices]);

  return (
    <div className="flex flex-col md:flex-row h-[100dvh]">
      {propInvoices ? null : (
        // Invoice-switcher mini rail — desktop only, same rationale as the
        // Ledger view's account rail (see src/renderer/views/Ledger/
        // index.tsx): the sidebar's own list link covers switching on
        // mobile, and the space is better spent on the invoice itself.
        <div className="hidden md:block md:w-1/4 overflow-y-scroll scrollbar">
          {leftRailKind === 'quotation' ? (
            <QuotationsPage invoiceType={invoiceType} isMini />
          ) : (
            <InvoicesPage
              invoiceType={invoiceType}
              isMini
              saleReturns={leftRailKind === 'saleReturn'}
            />
          )}
        </div>
      )}
      <div
        // `data-detail-scroll` is an attribute, not a class name: it is
        // how ScrollToTopButton finds this pane as the screen's real
        // scroller. Written inside className it was a class that
        // nothing styled and nothing queried, so the button scrolled
        // the shell instead — a few pixels, on the invoice screen.
        data-detail-scroll
        className={`${
          propInvoices ? 'w-full mb-6' : 'w-full md:w-3/4'
        } overflow-y-auto scrollbar justify-between items-center p-3 md:p-4 md:pl-8`}
      >
        <InvoiceDetails
          invoiceType={invoiceType}
          invoiceId={toNumber(id)}
          invoice={
            previewId
              ? propInvoices?.find(
                  (i) => toNumber(i.invoiceNumber) === previewId,
                )
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default InvoicePage;
