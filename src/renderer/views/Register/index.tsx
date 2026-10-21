import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { useAuth } from '@/renderer/hooks';

const RegisterPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  async function handleRegister(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    if (password !== confirmPassword) {
      toast({
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    const response = await register({ username, password });

    if (response) {
      toast({
        description: 'User registered successfully',
        variant: 'success',
      });
      navigate('/login');
      return;
    }

    toast({
      description: 'Error registering user',
      variant: 'destructive',
    });

    // eslint-disable-next-line no-console
    console.log(response);
  }

  return (
    <div className="flex justify-center items-center min-h-screen p-4">
      {/* The card had no width of its own, so it sized to its content
          and the submit button sat small under full-width inputs. */}
      <div className="w-full max-w-sm p-6 rounded-xl shadow-md border border-border bg-card text-card-foreground">
        <h1 className="title-new mb-4">Sign Up</h1>
        <form
          onSubmit={(e) => handleRegister(e)}
          className="flex flex-col gap-3"
        >
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
          <Input
            type="password"
            placeholder="Confirm Password"
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button
            variant="outline"
            type="submit"
            className="w-full"
            disabled={
              username.length < 4 ||
              password.length < 4 ||
              confirmPassword.length < 4 ||
              password !== confirmPassword
            }
          >
            Sign Up
          </Button>
        </form>
        <p className="mt-4 text-sm tracking-tight text-muted-foreground">
          Already have an account?
          <Button asChild variant="link">
            <Link to="/login">Login</Link>
          </Button>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
