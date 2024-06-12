import { store } from '../main';
import { connect } from './Database.service';
import type { Chart } from 'types';

export const getCharts = () => {
  const db = connect();

  const stm = db.prepare(
    'SELECT * FROM chart WHERE userId = (SELECT id FROM users WHERE username = @username)',
  );

  return stm.all({
    username: store.get('username'),
  }) as Chart[];
};
