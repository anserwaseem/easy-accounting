import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account, Chart, InsertAccount } from 'types';
import { api, ready } from './api/client';

type DbStatus = 'loading' | 'ready' | 'error';

export const App = () => {
  const [status, setStatus] = useState<DbStatus>('loading');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [charts, setCharts] = useState<Chart[]>([]);

  const [name, setName] = useState('');
  const [headName, setHeadName] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextAccounts, nextCharts] = await Promise.all([
      api.getAccounts(),
      api.getCharts(),
    ]);
    setAccounts(nextAccounts as Account[]);
    setCharts(nextCharts as Chart[]);
  }, []);

  useEffect(() => {
    ready
      .then(async () => {
        await refresh();
        setStatus('ready');
      })
      .catch((error: Error) => {
        setStatusError(error.message);
        setStatus('error');
      });
  }, [refresh]);

  const headOptions = useMemo(
    () => [...new Map(charts.map((chart) => [chart.name, chart])).values()],
    [charts],
  );

  useEffect(() => {
    if (!headName && headOptions.length > 0) {
      setHeadName(headOptions[0].name);
    }
  }, [headName, headOptions]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!name.trim() || !headName) {
      setFormError('Name and head are required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: InsertAccount = {
        name: name.trim(),
        headName,
        code: code.trim() || undefined,
        // Present in the payload but unused by AccountService's insertAccount
        // SQL (isActive is hardcoded to 1 there) — deliberately included so
        // this form exercises the driver's "extra bind-object keys must not
        // throw" behavior (see SqliteWasmDriver's doc comment) end to end.
        isActive: true,
      };
      await api.insertAccount(payload);
      setName('');
      setCode('');
      await refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <header>
        <h1>Easy Accounting — Accounts</h1>
        <p className="status" data-testid="db-status">
          {status}
        </p>
        {status === 'error' && <p className="error">{statusError}</p>}
      </header>

      <section className="panel">
        <h2>New account</h2>
        <form onSubmit={onSubmit} className="account-form">
          <label htmlFor="account-name">
            Account name
            <input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={status !== 'ready' || submitting}
              required
            />
          </label>
          <label htmlFor="account-head">
            Head
            <select
              id="account-head"
              value={headName}
              onChange={(e) => setHeadName(e.target.value)}
              disabled={
                status !== 'ready' || submitting || headOptions.length === 0
              }
              required
            >
              {headOptions.map((chart) => (
                <option key={chart.id} value={chart.name}>
                  {chart.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="account-code">
            Code
            <input
              id="account-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={status !== 'ready' || submitting}
            />
          </label>
          <button type="submit" disabled={status !== 'ready' || submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
          {formError && <p className="error">{formError}</p>}
        </form>
      </section>

      <section className="panel">
        <h2>Accounts ({accounts.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Head</th>
              <th>Code</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td>{account.headName}</td>
                <td>{account.code ?? ''}</td>
                <td>{account.isActive ? 'Yes' : 'No'}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4}>No accounts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
};
