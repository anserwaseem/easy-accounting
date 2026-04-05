import { toNumber } from 'lodash';
import { Plus, X } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import VirtualSelect from '@/renderer/components/VirtualSelect';

export interface CustomerSection {
  id: string;
  accountId?: number;
}

interface CustomerSectionsBlockProps {
  sections: CustomerSection[];
  activeSectionId: string | null;
  parties: Array<{ id: number; name?: string; code?: string | number }>;
  getSectionLabel: (section: CustomerSection, index: number) => string;
  onAddSection: () => void;
  onRemoveSection: (sectionId: string) => void;
  onSetActiveSection: (sectionId: string) => void;
  onSetSectionCustomer: (sectionId: string, accountId: number) => void;
  sectionAutoDiscountOffCount: number;
}

export const CustomerSectionsBlock: React.FC<CustomerSectionsBlockProps> = ({
  sections,
  activeSectionId,
  parties,
  getSectionLabel,
  onAddSection,
  onRemoveSection,
  onSetActiveSection,
  onSetSectionCustomer,
  sectionAutoDiscountOffCount,
}: CustomerSectionsBlockProps) => (
  <div className="col-span-2 space-y-2 rounded-md border p-3">
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Group invoice rows by customer sections.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onAddSection}>
        <Plus size={14} className="mr-1.5" />
        Add Section
      </Button>
    </div>
    <div className="space-y-2">
      {sections.map((section, index) => (
        <div
          key={section.id}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
        >
          <VirtualSelect
            options={parties || []}
            value={section.accountId}
            onChange={(value) =>
              onSetSectionCustomer(section.id, toNumber(value))
            }
            placeholder={`Select customer for ${getSectionLabel(
              section,
              index,
            )}`}
            searchPlaceholder="Search customers..."
          />
          <Button
            type="button"
            size="sm"
            variant={activeSectionId === section.id ? 'default' : 'outline'}
            onClick={() => onSetActiveSection(section.id)}
          >
            Use For New Rows
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onRemoveSection(section.id)}
            disabled={sections.length <= 1}
          >
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
    {sectionAutoDiscountOffCount > 0 && (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
        Auto discount off for {sectionAutoDiscountOffCount} selected customer
        {sectionAutoDiscountOffCount === 1 ? '' : 's'}.
      </div>
    )}
  </div>
);
