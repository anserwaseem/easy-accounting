import type { Chart } from 'types';
import { isEmpty } from 'lodash';
import { store } from '../store';
import { connect } from './Database.service';

export const getCharts = () => {
  const db = connect();

  const stm = db.prepare(
    'SELECT * FROM chart WHERE userId = (SELECT id FROM users WHERE username = @username)',
  );

  return stm.all({
    username: store.get('username'),
  }) as Chart[];
};

export const insertCharts = (username: string, charts: Omit<Chart, 'id'>[]) => {
  if (isEmpty(username) || charts.length === 0) {
    return false;
  }

  const db = connect();

  const placeholders = charts
    .map(() => '(?, ?, ?, (SELECT id FROM users WHERE username = ?))')
    .join(', ');
  const sql = `INSERT INTO chart (date, name, type, userId) VALUES ${placeholders}`;

  const stmChart = db.prepare(sql);

  const values = charts.flatMap((chart) => [
    chart.date,
    chart.name,
    chart.type,
    username,
  ]);

  return Boolean(stmChart.run(values).changes);
};
