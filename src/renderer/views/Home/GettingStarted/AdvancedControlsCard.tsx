import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'renderer/shad/ui/card';
import { Button } from 'renderer/shad/ui/button';
import { useAdvancedCapabilities } from '@/renderer/hooks/useAdvancedCapabilities';

/**
 * What is on right now, in words.
 *
 * "Hidden" and "hidden because someone turned it off" are different
 * problems for whoever is looking, so the card reports the count
 * rather than leaving the owner to guess.
 */
const describeEnabled = (onCount: number): string => {
  if (onCount === 0) {
    return 'All advanced controls are off, so those actions are hidden for whoever uses this device. Turn on only the ones you need.';
  }

  const noun = onCount === 1 ? 'control is' : 'controls are';
  return `${onCount} advanced ${noun} turned on for whoever uses this device. The rest are hidden.`;
};

/**
 * Tells the owner that advanced controls exist, and what turning them on
 * means.
 *
 * Without this, a new owner has no way to learn the concept exists: the
 * controls are hidden by default, so the app looks like it simply cannot
 * reverse a journal or delete an account. The Settings list is the only
 * place they are listed, and nothing in the app points there.
 *
 * The card says which of them are on right now, because "hidden" and
 * "hidden because someone turned it off" are different problems for
 * whoever is looking.
 */
export const AdvancedControlsCard: React.FC = () => {
  const navigate = useNavigate();
  const { enabled, loaded } = useAdvancedCapabilities();

  const onCount = loaded ? enabled.size : 0;

  const status = loaded
    ? describeEnabled(onCount)
    : 'Checking which advanced controls are turned on for this device.';

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Advanced controls
        </CardTitle>
        <CardDescription>
          Actions that change or remove records that already exist, such as
          reversing a journal, returning a posted invoice, deleting an account
          or an item, and restating opening stock. Also the reports the owner
          may not want on every device. They are turned off by default, so
          nobody stumbles into one by accident. Each one is switched on
          individually, and the setting is remembered on this device only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {status}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => navigate('/settings?tab=rules')}
        >
          Review advanced controls
        </Button>
      </CardFooter>
    </Card>
  );
};

export default AdvancedControlsCard;
