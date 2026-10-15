import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shad/ui/dialog';
import { BookOpen } from 'lucide-react';
import { type CollectionSheetLanguage } from './buildCollectionSheetRows';

interface CollectionSheetGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: CollectionSheetLanguage;
}

export const CollectionSheetGuideDialog: React.FC<
  CollectionSheetGuideDialogProps
> = ({ open, onOpenChange, language }: CollectionSheetGuideDialogProps) => {
  const urdu = language === 'ur';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto space-y-4"
        dir={urdu ? 'rtl' : 'ltr'}
      >
        <DialogHeader className={urdu ? 'text-right' : 'text-left'}>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            {urdu
              ? 'وصولی شیٹ سمجھنے کی مکمل گائیڈ'
              : 'How to Read the Collection Sheet'}
          </DialogTitle>
          <DialogDescription>
            {urdu
              ? 'فعال واجب الادا بلوں، دورہ وار تاریخ اور کالموں کو سمجھنے کا طریقہ کار۔'
              : 'A complete guide to active due bills, tour collections, and audit columns.'}
          </DialogDescription>
        </DialogHeader>

        {/* 1. The Core Formula */}
        <div className="rounded-lg border bg-muted/40 p-3.5 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {urdu ? 'بنیادی اصول (The Core Formula)' : 'The Core Formula'}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-medium">
            <span className="bg-background px-2.5 py-1.5 rounded border shadow-sm">
              {urdu ? 'کل خریداریاں' : 'Total Historical Orders'}
            </span>
            <span className="text-muted-foreground font-bold">−</span>
            <span className="bg-background px-2.5 py-1.5 rounded border shadow-sm text-emerald-600 dark:text-emerald-400 font-semibold">
              {urdu
                ? 'کل وصولی (ماضی کے دورے)'
                : 'Total Collected (Past Tours)'}
            </span>
            <span className="text-muted-foreground font-bold">=</span>
            <span className="bg-primary/10 text-primary px-2.5 py-1.5 rounded border border-primary/20 font-bold">
              {urdu
                ? 'واجب الادا رقم (آج کا بقایا)'
                : 'Due Amount (Remaining Debt Today)'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed pt-1">
            {urdu
              ? 'کل وصولی وہ رقم ہے جو گاہک نے ماضی کے منتخب دوروں میں ادا کی تھی۔ واجب الادا رقم وہ موجودہ بقایا ہے جو ایجنٹ کو اگلے دورے میں وصول کرنا ہے۔ گاہک کی پرانی ادائیگیاں موجودہ بلوں سے زیادہ ہو سکتی ہیں کیونکہ وہ پرانے بلوں کی مد میں ادا ہوئی تھیں۔'
              : 'Total Collected reflects payments received across the selected past tours. Due Amount reflects what the customer owes today that the agent must collect. Total Collected can be higher than Due Amount because active customers consistently pay down older bills as they receive new goods.'}
          </p>
        </div>

        {/* 2. Due Bills Only */}
        <div className="space-y-1.5 border-t pt-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            {urdu
              ? 'صرف فعال واجب الادا بل (Due Bills Only — FIFO)'
              : 'Active Due Bills Only (FIFO Settlement)'}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {urdu
              ? 'گاہک کی ادائیگیاں خودکار طور پر پہلے پرانے بلوں کو ختم کرتی ہیں (FIFO)۔ اس لیے مکمل ادا شدہ پرانے بل شیٹ پر نہیں دکھائے جاتے تاکہ ایجنٹ صرف غیر ادا شدہ بلوں پر توجہ دے سکے۔ ایک سے زائد بلوں والے گاہکوں کے سامنے بل نمبر کے ساتھ نمبر شمار (1/3، 2/3، 3/3) اور کل واجب الادا رقم لکھی ہوتی ہے۔'
              : 'Customer payments automatically clear older debt first (FIFO). Fully paid bills are omitted so the agent focuses solely on active unpaid bills (indexed 1/3, 2/3, 3/3 with Total Due summary). Any older balance predating invoices in the system is labeled Opening Bal.'}
          </p>
        </div>

        {/* 3. Tour History & Red 0 */}
        <div className="space-y-1.5 border-t pt-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {urdu
              ? 'دورہ وار وصولی اور سرخ 0 (Tour History & Red 0)'
              : 'Tour Columns & Skipped Visits (Red 0)'}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {urdu
              ? 'ہر کالم ایک مخصوص دورے کی تاریخوں میں وصول شدہ رقم کو ظاہر کرتا ہے۔ سرخ 0 ان دوروں کو نمایاں کرتا ہے جن میں گاہک سے کوئی رقم موصول نہیں ہوئی، تاکہ مسلسل ادائیگی نہ کرنے والے گاہکوں کی فوری نشاندہی ہو سکے۔'
              : 'Each tour column shows receipts collected during that dated trip window. A red cell (0) highlights tours where the customer was visited but made Rs. 0 payment, allowing you to instantly spot non-paying or delaying customers.'}
          </p>
        </div>

        {/* 4. Not in a Tour */}
        <div className="space-y-1.5 border-t pt-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {urdu
              ? 'بغیر دورہ وصولی (Not in a Tour) اور اس کی درستگی'
              : '"Not in a Tour" (Audit Column & Date Adjustment)'}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {urdu
              ? 'اگر کسی تاریخ پر گاہک کی ادائیگی درج ہو لیکن وہ دن کسی دورے کے شیڈول میں شامل نہ ہو (مثلاً دورہ 30 تاریخ کو ختم ہوا اور بینک میں رقم 31 کو موصول ہوئی)، تو یہ رقم بغیر دورہ کالم میں آ جاتی ہے تاکہ کوئی وصولی گم نہ ہو۔ تاریخ درست کرنے کے لیے اوپر "Tours" کے بٹن پر کلک کر کے دورے کی آخری تاریخ بڑھا دیں؛ رقم فوری طور پر متعلقہ دورے میں منتقل ہو جائے گی۔'
              : 'Flags receipts received on dates between tours (e.g. tour ended on the 30th, but bank payment was posted on the 31st). To fold it into the tour column, simply click the "Tours" button above and extend the tour’s end date by 1 day; the amount will instantly roll into that tour column.'}
          </p>
        </div>

        {/* 5. Field Trip Columns */}
        <div className="space-y-1.5 border-t pt-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {urdu
              ? 'فیلڈ کالم (وصولی، فرق، نیا بقایا)'
              : 'Field Trip Logging (Collection, Difference, Remaining)'}
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {urdu
              ? 'یہ کالم پرنٹ اور ایکسل پر جان بوجھ کر خالی رکھے جاتے ہیں تاکہ ایجنٹ دورے کے دوران موصول ہونے والی نئی رقم اور نیا بقایا قلم سے درج کر سکے۔'
              : 'Intentionally blank on printouts and Excel exports for the agent to write newly collected cash/cheques and calculate the updated remaining balance during their field visit.'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
