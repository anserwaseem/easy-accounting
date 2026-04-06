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
  const [leftRailIsQuotation, setLeftRailIsQuotation] = useState(false);

  const propInvoices = window.electron.store.get('generatedInvoices') as
    | InvoiceView[]
    | undefined;

  useEffect(() => {
    if (previewId != null || propInvoices) {
      setLeftRailIsQuotation(false);
      return;
    }
    const rawId = toNumber(id);
    if (!Number.isFinite(rawId) || rawId <= 0) {
      setLeftRailIsQuotation(false);
      return;
    }
    // do not clear leftRailIsQuotation before fetch — that swapped the mini rail
    // (e.g. quotations → invoices) and felt like a full refresh when switching quotes
    let cancelled = false;
    window.electron
      .getInvoice(rawId)
      .then((inv) => {
        if (!cancelled && inv && typeof inv === 'object') {
          setLeftRailIsQuotation(Boolean((inv as InvoiceView).isQuotation));
        }
      })
      .catch(() => {
        if (!cancelled) setLeftRailIsQuotation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, previewId, propInvoices]);

  return (
    <div className="flex flex-row h-screen">
      {propInvoices ? null : (
        <div className="w-1/4 overflow-y-scroll scrollbar">
          {leftRailIsQuotation ? (
            <QuotationsPage invoiceType={invoiceType} isMini />
          ) : (
            <InvoicesPage invoiceType={invoiceType} isMini />
          )}
        </div>
      )}
      <div
        className={`${
          propInvoices ? 'w-full mb-6' : 'w-3/4'
        } overflow-y-auto scrollbar justify-between items-center p-4 pl-8`}
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
