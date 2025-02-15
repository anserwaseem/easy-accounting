import { toNumber } from 'lodash';
import { useParams } from 'react-router-dom';
import { InvoiceType, InvoiceView } from 'types';
// eslint-disable-next-line import/no-cycle
import InvoicesPage from '../Invoices';
import { InvoiceTable } from './invoiceTable';

interface InvoiceProps {
  invoiceType: InvoiceType;
  previewId?: number;
}

const InvoicePage: React.FC<InvoiceProps> = ({
  invoiceType,
  previewId,
}: InvoiceProps) => {
  const { id } = useParams();

  const propInvoices = window.electron.store.get('generatedInvoices') as
    | InvoiceView[]
    | undefined;

  return (
    <div className="flex flex-row h-screen">
      {propInvoices ? null : (
        <div className="w-1/4 overflow-y-scroll scrollbar">
          <InvoicesPage invoiceType={invoiceType} isMini />
        </div>
      )}
      <div
        className={`${
          propInvoices ? 'w-full mb-6' : 'w-3/4'
        } overflow-y-auto scrollbar justify-between items-center p-4 pl-8`}
      >
        <InvoiceTable
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
