import { Link, useNavigate } from 'react-router-dom';
import styles from './Login.module.css';
import { useContext, useState } from 'react';
import { AuthContext } from 'renderer/context/Auth';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { useToast } from 'renderer/shad/ui/use-toast';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { toast } = useToast();

  const { signin } = useContext(AuthContext);
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
    <div className={styles.container}>
      <div className={styles.loginBox}>
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
            onClick={login}
            disabled={username.length < 4 || password.length < 4}
          >
            Login
          </Button>
        </form>
        <p className={'text-sm tracking-tight text-black'}>
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
