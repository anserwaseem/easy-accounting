import { useState } from 'react';
import { PenBox } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import { toast } from '../shad/ui/use-toast';

interface EditNarrationDialogProps {
  journalId: number;
  narration: string;
  onSave: (journalId: number, newNarration: string) => Promise<void>;
}

export const EditNarrationDialog: React.FC<EditNarrationDialogProps> = ({
  journalId,
  narration,
  onSave,
}: EditNarrationDialogProps) => {
  const [open, setOpen] = useState(false);
  const [editedNarration, setEditedNarration] = useState(narration);
  const [originalNarration, setOriginalNarration] = useState(narration);
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setEditedNarration(narration);
      setOriginalNarration(narration);
    }
    setOpen(newOpen);
  };

  const handleReset = () => {
    setEditedNarration(originalNarration);
  };

  const handleSave = async () => {
    if (editedNarration === originalNarration) {
      setOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      await onSave(journalId, editedNarration);
      toast({
        title: 'Success',
        description: 'Journal narration updated successfully',
      });
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update journal narration',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && editedNarration !== originalNarration) {
        handleSave();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <PenBox size={16} cursor="pointer" className="py-0" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Journal Narration</DialogTitle>
          <DialogDescription>
            Make changes to the journal narration below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="narration" className="text-right">
              Narration
            </Label>
            <Input
              id="narration"
              value={editedNarration}
              onChange={(e) => setEditedNarration(e.target.value)}
              onKeyDown={handleKeyDown}
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReset} disabled={isLoading}>
            Reset
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || editedNarration === originalNarration}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
