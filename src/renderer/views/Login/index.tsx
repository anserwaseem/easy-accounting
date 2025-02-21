import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from 'renderer/hooks';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { signin } = useAuth();
  const navigate = useNavigate();

  async function login(
    formEvent: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) {
    formEvent.preventDefault();
    const response = await signin({ username, password });

    if (response) {
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
        <h1 className="text-xl font-semibold">Login</h1>
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
      </div>
    </div>
  );
};

export default LoginPage;
