import { useLocation, useParams } from 'react-router-dom';

export const InvalidRoute: React.FC = () => {
  const { id } = useParams();
  const location = useLocation();

  return (
    <p>
      Invalid route at location: {JSON.stringify(location)} with {id}
    </p>
  );
};
