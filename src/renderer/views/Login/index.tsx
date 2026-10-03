import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from 'renderer/hooks';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { clearStashedJoinInvite } from 'renderer/lib/joinLink';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [canJoinSync, setCanJoinSync] = useState(false);

  const { signin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const state = location.state as {
      syncJoined?: boolean;
      pulled?: number;
    } | null;
    if (state?.syncJoined) {
      toast({
        description: 'Data synced — sign in with your existing account.',
        variant: 'success',
      });
    }
  }, [location.state]);

  useEffect(() => {
    if (!window.electron.supportsSync) return;
    Promise.all([window.electron.getAccounts(), window.electron.getJournals()])
      .then(([accounts, journals]) =>
        setCanJoinSync(accounts.length === 0 && journals.length === 0),
      )
      .catch(() => setCanJoinSync(false));
  }, []);

  async function login(
    formEvent: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) {
    formEvent.preventDefault();
    const response = await signin({ username, password });

    if (response) {
      clearStashedJoinInvite();
      navigate('/');
      return;
    }

    toast({
      description: 'Username or Password is incorrect',
      variant: 'destructive',
    });
  }

  return (
    <div className="flex justify-center items-center h-screen">
      <div className="p-6 rounded-xl shadow-md border-white border-dashed border-[1px]">
        <h1 className="title-new">Login</h1>
        <form>
          <Input
            type="text"
            placeholder="Username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={(e) => login(e)}
            disabled={username.length < 4 || password.length < 4}
          >
            Login
          </Button>
        </form>
        <p className="text-sm tracking-tight text-black">
          Already have an account?
          <Button asChild variant="link">
            <Link to="/register">Sign Up</Link>
          </Button>
        </p>
        {window.electron.supportsDbImport && (
          <p className="text-sm tracking-tight text-black">
            New here?
            <Button asChild variant="link">
              <Link to="/import">Import from desktop app</Link>
            </Button>
          </p>
        )}
        {canJoinSync && (
          <p className="text-sm tracking-tight text-black">
            Setting up a second device?
            <Button asChild variant="link">
              <Link to="/join-sync">Join existing sync</Link>
            </Button>
          </p>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
