import type { PropsWithChildren } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks';

export const AuthCheck: React.FC<PropsWithChildren> = ({
  children,
}: PropsWithChildren) => {
  const { authed } = useAuth();

  // if (authed) {
  if (authed || process.env.NODE_ENV === 'development') {
    return (
      <>
        {children}
        <Outlet />
      </>
    );
  }

  return <Navigate to="/login" replace />;
};
