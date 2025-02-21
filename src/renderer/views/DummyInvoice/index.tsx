/* eslint-disable no-await-in-loop */
import { format } from 'date-fns';
import { sum, toString } from 'lodash';
import { toWords } from 'number-to-words';
import { useEffect } from 'react';
import { Button } from '../../shad/ui/button';

const DummyInvoicePage = () => {
  const items = [
    {
      inventoryItemName: 'S-23',
      inventoryItemDescription: 'The Holy Quran',
      quantity: 138,
      price: 640,
    },
    {
      inventoryItemName: '101-AK',
      inventoryItemDescription: 'The Holy Quran',
      quantity: 3,
      price: 2400,
    },
    {
      inventoryItemName: '101-AK-Golden',
      inventoryItemDescription: 'The Holy Quran',
      quantity: 3,
      price: 2750,
    },
    {
      inventoryItemName: '101-Art',
      inventoryItemDescription: 'The Holy Quran',
      quantity: 15,
      price: 1650,
    },
    {
      inventoryItemName: '101-Art-Golden',
      inventoryItemDescription: 'The Holy Quran',
      quantity: 10,
      price: 2000,
    },
  ];
  const total = sum(items.map((item) => item.quantity * item.price));
  const invoiceNumber = 9329;
  const party = 'Siddiqi Khushbu Mahal';
  const city = 'Hazro'; // Rawalpindi, Hazro
  const bilty = 'New Karachi Hazara'; // Pak International Goods, The Waheed Mushtarka
  const cartons = 3;

  useEffect(() => {
    window.onbeforeprint = () => {
      document.title = toString(invoiceNumber);
    };

    window.onafterprint = () => {
      document.title = 'Easy Invoicing';
    };
  }, [invoiceNumber]);

  return (
    <div className="min-h-screen bg-white p-8 print:p-0">
      <div className="print:hidden mb-4">
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            <Button onClick={() => window.print()} className="w-[150px]">
              Print Invoice
            </Button>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center">
          <div className="w-full">
            <h1 className="text-3xl font-bold text-center font-mono">
              ALIF ZAFAR SONS
            </h1>
            <p className="text-sm text-center font-mono">
              Head Office: Iqra Center, Ghazni Street, Urdu Bazar, Lahore Phone:
              37120115, 37245149
            </p>
          </div>
        </div>

        <div className="grid grid-rows-2">
          <div className="flex justify-between">
            <div className="flex gap-4">
              <p>INVOICE NO.</p>
              <p>{invoiceNumber}</p>
            </div>
            <div className="flex gap-4 pr-4">
              <p>DATE</p>
              <p>{format('02/18/2025', 'PP')}</p>
              <p>{bilty}</p>
            </div>
            <div className="flex gap-4">
              <p>BILTY&nbsp;</p>
              <p>({cartons})&nbsp;CARTONS</p>
            </div>
          </div>
          <div className="flex gap-12">
            <p>BILL TO:</p>
            <p>{party}</p>
            <p>{city}</p>
          </div>
        </div>

        <table className="w-full mt-2">
          <thead>
            <tr className="border-y-2 border-black">
              <th className="text-left py-2">S.No. </th>
              <th className="py-2">Item Code</th>
              <th className="text-left py-2">Item Description</th>
              <th className="text-right py-2">Issue Qty</th>
              <th className="text-right py-2">Price</th>
              <th className="text-right py-2 pr-4">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index} className="border-b border-gray-300">
                <td>{index + 1}</td>
                <td className="text-center">{item.inventoryItemName}</td>
                <td>{item.inventoryItemDescription}</td>
                <td className="text-right">{item.quantity}</td>
                <td className="text-right">{item.price.toFixed(0)}</td>
                <td className="text-right pr-4">
                  {(item.quantity * item.price).toFixed(0)}
                </td>
              </tr>
            ))}
            <tr>
              <td />
              <td />
              <td className="py-2 flex justify-end">
                <p className="underline">Total No. of Quran Sold:</p>
                &nbsp;&nbsp;
              </td>
              <td className="py-2">
                {sum(items.map((item) => item.quantity))}
              </td>
              <td />
              <td className="py-2 pr-4 text-right">{total}</td>
            </tr>
            <tr>
              <td />
              <td />
              <td className="py-2 text-right">
                Total After 0% Discount:&nbsp;&nbsp;
              </td>
              <td />
              <td />
              <td className="py-2 pr-4 font-bold text-right">{total}</td>
            </tr>
          </tbody>
        </table>

        <div>
          <div className="flex flex-col gap-2">
            <h3>
              Total Rs.{' '}
              {toWords(total)
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')}
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DummyInvoicePage;
