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
    <div className="flex justify-center items-center h-screen">
      <div className="p-6 rounded-xl shadow-md border-white border-dashed border-[1px]">
        <h1 className="text-xl font-semibold">Sign Up</h1>
        <form onSubmit={(e) => handleRegister(e)}>
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
        <p className="text-sm tracking-tight text-black">
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
