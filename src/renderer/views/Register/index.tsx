import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from './Register.module.css';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { useToast } from 'renderer/shad/ui/use-toast';

const RegisterPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { toast } = useToast();

  const navigate = useNavigate();

  async function register(formEvent: any) {
    formEvent.preventDefault();

    if (password !== confirmPassword) {
      toast({
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    const response = await window.electron.register({ username, password });

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

    console.log(response);
  }

  return (
    <>
      <div className={styles.container}>
        <div className={styles.signupBox}>
          <h1 className="text-xl font-semibold">Sign Up</h1>
          <form onSubmit={register}>
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
              onClick={register}
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
          <p className={'text-sm tracking-tight text-black'}>
            Already have an account?
            <Button asChild variant="link">
              <Link to="/login">Login</Link>
            </Button>
          </p>
        </div>
      </div>
    </>
  );
};

export default RegisterPage;
