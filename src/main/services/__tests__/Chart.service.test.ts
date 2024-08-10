import { INITIAL_CHARTS } from '../../utils/constants';
import { store } from '../../store';
import { getCharts, insertCharts } from '../Chart.service';
import { connect } from '../Database.service';

jest.mock('../Database.service');
jest.mock('../../store');

describe('Chart Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an array of charts', () => {
    const expectedCharts = [
      {
        id: 1,
        name: 'Cash',
        type: 'Asset',
        date: '2024-02-28',
        createdAt: '2024-03-02',
        updatedAt: '2024-03-02',
      },
      {
        id: 2,
        name: 'Current Liability',
        type: 'Liability',
        date: '2024-02-28',
        createdAt: '2024-03-02',
        updatedAt: '2024-03-02',
      },
    ];
    const mockAll = jest.fn().mockReturnValue(expectedCharts);
    const mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
    (store.get as jest.Mock).mockReturnValue('testUser');

    const charts = getCharts();

    expect(store.get).toHaveBeenCalledWith('username');
    expect(mockAll).toHaveBeenCalledWith({ username: 'testUser' });
    expect(charts).toEqual(expectedCharts);
  });

  it('should return true on successful insertion', () => {
    const username = 'testuser';
    const mockRun = jest
      .fn()
      .mockReturnValue({ changes: INITIAL_CHARTS.length });
    const mockPrepare = jest.fn().mockReturnValue({ run: mockRun });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });

    const result = insertCharts(username, INITIAL_CHARTS);

    expect(mockRun).toHaveBeenCalledWith(
      INITIAL_CHARTS.flatMap((c) => [c.date, c.name, c.type, username]),
    );
    expect(result).toBe(true);
  });
});
