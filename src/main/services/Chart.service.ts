import { connect } from './Database.service';

export const getCharts = (token?: string | null) => {
  const db = connect();

  const stm = db.prepare(
    'SELECT * FROM chart where userId = (SELECT id FROM users WHERE username = @username)',
  );

  return stm.all({ username: token }) as Chart[];
};
